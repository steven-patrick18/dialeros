import { NextResponse } from 'next/server';
import { probeAiStack } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 189 — AI-stack health: Ollama (LLM) reachability + model
// list, Coqui TTS daemon reachability. Drives the banner on the
// AI personas page so an operator knows what's missing before
// enabling AI agents.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  return NextResponse.json(await probeAiStack());
}
