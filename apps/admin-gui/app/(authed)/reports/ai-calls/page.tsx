import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { userHasPermission } from '@dialeros/control-plane';
import { AiCallsClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 195 — AI call review. Lists ai_call_sessions (iter 190)
// with drill-down to the per-turn transcript + STT/LLM/TTS
// latency (iter 194). Also hosts the master live-enable switch
// since this is the AI operations surface.

export default async function AiCallsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (!userHasPermission(me, 'ai.manage')) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">AI calls</h1>
        <p className="text-error text-sm">
          ai.manage permission required.
        </p>
      </div>
    );
  }
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">
        AI calls <span className="text-fg-subtle text-base">· Phase K</span>
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        Every AI-handled call leg + its turn-by-turn transcript
        and per-stage latency. The live switch below is the
        master gate: with it off (default) the pacer never routes
        a call into the AI loop regardless of persona bindings.
      </p>
      <AiCallsClient />
    </div>
  );
}
