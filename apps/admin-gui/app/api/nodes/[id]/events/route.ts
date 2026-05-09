import type { NextRequest } from 'next/server';
import {
  getNodeFromDb,
  getProvisioningLogs,
  subscribeToNode,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SSE endpoint streaming provisioning_log events for a single node.
//
// Protocol (each line is one JSON message in the SSE `data:` field):
//   { type: "log", ts, level, phase, message }
//   { type: "replay-done" }   — sentinel after history replay completes
//   { type: "status", status, error_message }   — fired on terminal states
//
// The endpoint replays the on-disk history first, then subscribes to live
// events. Heartbeat every 15s keeps proxies from closing the connection.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { id } = await ctx.params;
  const node = getNodeFromDb(id);
  if (!node) {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (payload: unknown): void => {
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

      // Replay history.
      for (const row of getProvisioningLogs(id)) {
        send({
          type: 'log',
          ts: row.ts,
          level: row.level,
          phase: row.phase,
          message: row.message,
        });
      }
      send({ type: 'replay-done' });

      // Subscribe to live events.
      const unsubscribe = subscribeToNode(id, (ev) => {
        send({
          type: 'log',
          ts: ev.ts,
          level: ev.level,
          phase: ev.phase,
          message: ev.message,
        });
        // When provisioning finishes, the provisioner emits a 'finalize'
        // event. Surface a status update so the client can stop polling.
        if (ev.phase === 'finalize') {
          const fresh = getNodeFromDb(id);
          if (fresh) {
            send({
              type: 'status',
              status: fresh.status,
              error_message: fresh.error_message,
            });
          }
        }
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
