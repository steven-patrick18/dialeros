import { NextRequest, NextResponse } from 'next/server';
import { personaTextTurn } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 189 — Persona text-mode sandbox. One LLM round-trip:
// system prompt + greeting + history + the operator's customer
// line → the AI's next reply. Lets the operator tune the prompt
// against the real model before any call is wired. Gracefully
// returns reason:'llm_offline' when Ollama isn't installed.

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const o = body as {
    system_prompt?: unknown;
    greeting?: unknown;
    agent_name?: unknown;
    agent_title?: unknown;
    model?: unknown;
    history?: unknown;
    customer_line?: unknown;
  };
  if (
    typeof o.system_prompt !== 'string' ||
    typeof o.greeting !== 'string' ||
    typeof o.customer_line !== 'string' ||
    o.customer_line.trim().length === 0
  ) {
    return NextResponse.json(
      { error: 'system_prompt, greeting, customer_line required' },
      { status: 400 },
    );
  }
  const history = Array.isArray(o.history)
    ? (o.history as Array<{ role: string; content: string }>)
        .filter(
          (h) =>
            (h.role === 'assistant' || h.role === 'user') &&
            typeof h.content === 'string',
        )
        .slice(-20)
        .map((h) => ({
          role: h.role as 'assistant' | 'user',
          content: h.content,
        }))
    : [];
  const result = await personaTextTurn({
    systemPrompt: o.system_prompt,
    greeting: o.greeting,
    agentName:
      typeof o.agent_name === 'string' ? o.agent_name : null,
    agentTitle:
      typeof o.agent_title === 'string' ? o.agent_title : null,
    model: typeof o.model === 'string' && o.model ? o.model : 'qwen2.5:3b',
    history,
    customerLine: o.customer_line,
  });
  return NextResponse.json(result);
}
