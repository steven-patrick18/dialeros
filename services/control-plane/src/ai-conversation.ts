// Iter 194 — Pure conversation assembly for the AI loop. Builds
// the Ollama /api/chat message array from a persona + the
// recorded turn history + the latest caller utterance.
//
// Extracted as a pure function so the live call loop
// (ai-session respond endpoint) and the iter-189 text sandbox
// produce *identical* prompts — drift between "what I tuned in
// the sandbox" and "what the agent actually says on a call" is
// the worst possible bug class for a conversational system.
//
// Turn role mapping: ai_call_turns stores 'caller' | 'ai'.
// Ollama wants 'user' | 'assistant'. The persona greeting is
// injected as the FIRST assistant message (the AI "opened" with
// it on the call) so the model has the same context the sandbox
// gave it.

export interface ConversationTurn {
  role: string; // 'caller' | 'ai' (from ai_call_turns)
  text: string;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Max history turns kept in the prompt. A 3B model on CPU
 * degrades fast past a few KB of context; voice calls rarely
 * need deep memory. The OLDEST turns are dropped (keep recency)
 * but the system prompt + greeting are always retained. */
export const MAX_HISTORY_TURNS = 16;

import { applyIdentity } from './ai-identity';

export function buildOllamaMessages(
  persona: {
    system_prompt: string;
    greeting: string;
    agent_name?: string | null;
    agent_title?: string | null;
  },
  history: ConversationTurn[],
  callerText: string,
  maxHistory: number = MAX_HISTORY_TURNS,
): OllamaMessage[] {
  const mapped: OllamaMessage[] = [];
  for (const t of history) {
    if (typeof t.text !== 'string' || t.text.trim() === '') continue;
    if (t.role === 'caller') {
      mapped.push({ role: 'user', content: t.text });
    } else if (t.role === 'ai') {
      mapped.push({ role: 'assistant', content: t.text });
    }
    // any other role (defensive) is skipped
  }
  // Keep only the most recent `maxHistory` mapped turns.
  const tail =
    mapped.length > maxHistory ? mapped.slice(-maxHistory) : mapped;

  return [
    {
      role: 'system',
      content: applyIdentity(
        persona.system_prompt,
        persona.agent_name ?? '',
        persona.agent_title ?? null,
      ),
    },
    { role: 'assistant', content: persona.greeting },
    ...tail,
    { role: 'user', content: callerText },
  ];
}

/** Count of caller turns in the recorded history INCLUDING the
 * one about to be processed. The session guard's max_turns is
 * evaluated against this. */
export function callerTurnCount(
  history: ConversationTurn[],
  includingCurrent = true,
): number {
  const prior = history.filter((t) => t.role === 'caller').length;
  return includingCurrent ? prior + 1 : prior;
}
