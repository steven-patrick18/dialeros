'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

// Iter 45 — ViciDial-style carrier dial-plan rules editor.
//
// On-screen format (one rule per line):
//
//   0805:310,311,312,313,314
//   0806:415
//   1900:DROP        (TODO: not implemented; use a non-matching rule)
//
// Each line parses to { match_prefix, replacements[] }. The pacer +
// test-call + agent-dial all consult the parsed rules and rotate
// across the replacement list on each call.

interface DialPlanRule {
  match_prefix: string;
  replacements: string[];
}

const PREFIX_RE = /^[0-9*#+]+$/;

export function DialPlanPanel({
  carrierId,
  initialRules,
}: {
  carrierId: string;
  initialRules: DialPlanRule[];
}) {
  const router = useRouter();
  const initialText = useMemo(
    () => stringifyRules(initialRules),
    [initialRules],
  );
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const dirty = text !== initialText;

  async function save() {
    setMsg(null);
    let parsed: DialPlanRule[];
    try {
      parsed = parseRules(text);
    } catch (e) {
      setMsg({ tone: 'err', text: (e as Error).message });
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/carriers/${carrierId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dial_plan_rules: parsed.length === 0 ? null : parsed,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Dial-plan rules (rewrite)
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        Each line: <span className="font-mono">match:r1,r2,r3</span>. When a
        destination starts with <span className="font-mono">match</span>,
        the carrier strips that prefix and prepends one of{' '}
        <span className="font-mono">r1/r2/r3/…</span>, rotating across the
        list on each call. Mirrors ViciDial&apos;s carrier dial-plan
        (e.g. <span className="font-mono">_0805XXXXXXXX</span> →{' '}
        <span className="font-mono">SIP/310${'$'}{'{'}EXTEN:4{'}'}</span>).
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setMsg(null);
        }}
        className="input w-full h-32 font-mono text-sm"
        placeholder={'0805:310,311,312,313,314\n0806:415'}
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => {
              setText(initialText);
              setMsg(null);
            }}
            className="text-xs text-fg-muted hover:text-fg"
          >
            Reset
          </button>
        )}
        {msg && (
          <span
            className={`text-xs ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}

function stringifyRules(rules: DialPlanRule[]): string {
  return rules
    .map((r) => `${r.match_prefix}:${r.replacements.join(',')}`)
    .join('\n');
}

function parseRules(text: string): DialPlanRule[] {
  const out: DialPlanRule[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw.length === 0) continue;
    const colon = raw.indexOf(':');
    if (colon === -1) {
      throw new Error(
        `Line ${i + 1}: expected "match:replacement1,replacement2,…"`,
      );
    }
    const match_prefix = raw.slice(0, colon).trim();
    const rhs = raw.slice(colon + 1).trim();
    if (!PREFIX_RE.test(match_prefix)) {
      throw new Error(
        `Line ${i + 1}: invalid match prefix "${match_prefix}" (digits / *, # / leading + only).`,
      );
    }
    const replacements = rhs
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (replacements.length === 0) {
      throw new Error(
        `Line ${i + 1}: at least one replacement required.`,
      );
    }
    for (const r of replacements) {
      if (!PREFIX_RE.test(r)) {
        throw new Error(
          `Line ${i + 1}: invalid replacement "${r}" (digits / *, # / leading + only).`,
        );
      }
    }
    out.push({ match_prefix, replacements });
  }
  return out;
}
