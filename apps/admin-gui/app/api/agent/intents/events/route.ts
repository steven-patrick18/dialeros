import type { NextRequest } from 'next/server';
import {
  getCampaign,
  listDialIntentsForUser,
  subscribeToAllIntents,
  type DialIntentRecord,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE feed of dial intents assigned to the current user, across every
// campaign. Replays the last N from DB on connect (already enriched with
// campaign + lead names), then streams live ones filtered server-side.

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Capture the username so the live filter doesn't have to re-read auth.
  const myId = user.id;
  const myUsername = user.username;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: hb\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      // Replay last 20 intents for this user (chronological)
      const recent = [...listDialIntentsForUser(myId, 20)].reverse();
      for (const intent of recent) {
        send({ type: 'intent', intent });
      }
      send({ type: 'replay-done' });

      // Live: pacing emits raw DialIntentRecord without campaign_name; we
      // resolve the campaign name on the fly so the client doesn't have to.
      const campaignNameCache = new Map<string, string>();
      const unsubscribe = subscribeToAllIntents((intent: DialIntentRecord) => {
        if (intent.assigned_user_id !== myId) return;
        let campaign_name =
          campaignNameCache.get(intent.campaign_id) ?? null;
        if (!campaign_name) {
          campaign_name = getCampaign(intent.campaign_id)?.name ?? null;
          if (campaign_name) {
            campaignNameCache.set(intent.campaign_id, campaign_name);
          }
        }
        send({
          type: 'intent',
          intent: {
            ...intent,
            campaign_name: campaign_name ?? '(unknown)',
            // lead_name not joined live — minor cost, skip for now
            lead_name: null,
            assigned_username: myUsername,
          },
        });
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
