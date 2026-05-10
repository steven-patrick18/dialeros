import type { NextRequest } from 'next/server';
import {
  getCampaign,
  getUser,
  listIntentsForCampaign,
  subscribeToIntents,
  type DialIntentRecord,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

function enrich(intent: DialIntentRecord) {
  let assigned_username: string | null = null;
  if (intent.assigned_user_id) {
    assigned_username = getUser(intent.assigned_user_id)?.username ?? null;
  }
  return { ...intent, assigned_username };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE feed of dial intents for a single campaign.
// Replays the most recent N intents on connect, then streams live ones.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return new Response('Not found', { status: 404 });
  }

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

      // Replay last 20 intents (most recent first → reverse for chronological)
      const recent = [...listIntentsForCampaign(id, 20)].reverse();
      for (const intent of recent) {
        send({ type: 'intent', intent: enrich(intent) });
      }
      send({ type: 'replay-done' });

      const unsubscribe = subscribeToIntents(id, (intent: DialIntentRecord) => {
        send({ type: 'intent', intent: enrich(intent) });
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
