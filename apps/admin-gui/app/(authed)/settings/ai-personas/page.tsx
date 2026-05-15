import { redirect } from 'next/navigation';
import { listAiPersonas } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { AiPersonasClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 189 — Phase K opens. AI persona designer + text-mode
// sandbox. The real-time STT→LLM→TTS conversational loop +
// FreeSWITCH media bridge land in iter 190+. This iter is the
// configuration surface + a sandbox to tune the system prompt
// against the live local LLM.

export default async function AiPersonasPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">AI personas</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const rows = JSON.parse(
    JSON.stringify(listAiPersonas(me.org_id)),
  ) as ReturnType<typeof listAiPersonas>;
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">
        AI personas <span className="text-fg-subtle text-base">· Phase K</span>
      </h1>
      <p className="text-fg-subtle text-sm mb-6">
        Design the AI agent&apos;s role, voice, and guardrails.
        iter 189 ships configuration + a text-mode sandbox to tune
        the prompt against the live local LLM. The real-time
        voice loop (STT → LLM → TTS over a FreeSWITCH media
        bridge) lands in the next iters. Everything runs on the
        local stack — zero external API calls.
      </p>
      <AiPersonasClient initialRows={rows} />
    </div>
  );
}
