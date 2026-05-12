import Link from 'next/link';
import { redirect } from 'next/navigation';
import { searchTranscripts } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 138 — full-text search across every recorded call's
// transcript + AI summary. Admin / supervisor only. The search
// is FTS5-backed (sub-millisecond on million-row tables); each
// hit shows a 12-token snippet with the match highlighted via
// <mark>. Click-through lands on the lead detail page where the
// full transcript + summary live.

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'text-success',
  neutral: 'text-fg-muted',
  negative: 'text-error',
  mixed: 'text-warn',
};

const FLAG_TONE: Record<string, string> = {
  DNC_REQUESTED: 'text-error',
  HOSTILE: 'text-error',
  WRONG_NUMBER: 'text-warn',
  RECORDING_OBJECTION: 'text-warn',
  CALLBACK_PROMISED: 'text-info',
  SALE_CONFIRMED: 'text-success',
  VOICEMAIL_DROPPED: 'text-info',
};

export default async function TranscriptsSearch({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Search transcripts</h1>
        <p className="text-error text-sm">Admin or supervisor role required.</p>
      </div>
    );
  }

  const { q: rawQ } = await searchParams;
  const q = (rawQ ?? '').trim();
  const hits = q ? searchTranscripts(q, 100) : [];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Search transcripts</h1>
      <p className="text-fg-muted text-sm mb-6 max-w-3xl">
        Full-text search across every recorded call&apos;s transcript and
        AI summary. Tokens are AND-joined; quote phrases for exact
        match. Backed by sqlite FTS5 + the iter-138 sync triggers.
      </p>

      <form
        method="GET"
        action="/search/transcripts"
        className="flex gap-2 max-w-2xl mb-6"
      >
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="e.g. credit card  OR  remove me from your list"
          className="input flex-1"
          autoFocus
        />
        <button
          type="submit"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          Search
        </button>
      </form>

      {q && (
        <p className="text-xs text-fg-subtle mb-3">
          {hits.length === 0
            ? `No matches for "${q}".`
            : `${hits.length} hit${hits.length === 1 ? '' : 's'} for "${q}"`}
        </p>
      )}

      {hits.length > 0 && (
        <div className="space-y-3 max-w-5xl">
          {hits.map((h) => {
            const flags = (() => {
              if (!h.ai_flags) return [];
              try {
                const arr = JSON.parse(h.ai_flags) as unknown;
                return Array.isArray(arr) ? (arr as string[]) : [];
              } catch {
                return [];
              }
            })();
            return (
              <div
                key={h.id}
                className="border border-border rounded p-3 hover:bg-card-hover/30"
              >
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <div className="flex items-baseline gap-3">
                    <Link
                      href={`/leads/lead/${h.lead_id}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {h.lead_phone}
                    </Link>
                    {/* Iter 143 — deep-link to the specific call,
                       not just the lead. The call detail page
                       holds the recording + transcript + AI fields
                       for THIS hit's row. */}
                    <Link
                      href={`/calls/${h.id}`}
                      className="text-xs text-link hover:underline"
                    >
                      open call →
                    </Link>
                  </div>
                  <span className="text-fg-subtle text-xs">
                    {new Date(h.ts).toLocaleString()} ·{' '}
                    {h.campaign_name ?? '—'}
                  </span>
                </div>
                <div
                  className="text-sm text-fg-muted leading-snug"
                  dangerouslySetInnerHTML={{
                    __html: highlightSnippet(h.snippet),
                  }}
                />
                <div className="flex items-center gap-2 mt-2 flex-wrap text-[10px] uppercase tracking-wide">
                  {h.ai_sentiment && (
                    <span
                      className={`px-2 py-0.5 rounded border border-border ${
                        SENTIMENT_TONE[h.ai_sentiment] ?? 'text-fg-muted'
                      }`}
                    >
                      {h.ai_sentiment}
                    </span>
                  )}
                  {flags.map((f) => (
                    <span
                      key={f}
                      className={`px-2 py-0.5 rounded border border-border ${
                        FLAG_TONE[f] ?? 'text-fg-muted'
                      }`}
                    >
                      {f.replace(/_/g, ' ')}
                    </span>
                  ))}
                  {h.duration_ms && (
                    <span className="text-fg-subtle">
                      {Math.round((h.duration_ms ?? 0) / 1000)}s
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// snippet() returns "<mark>foo</mark>" literally; the rest is
// already plain text from the transcript. Allowlist mark+/mark
// only — no other HTML can sneak through.
function highlightSnippet(s: string): string {
  const esc = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/&lt;mark&gt;/g, '<mark style="background:#fef08a;color:#000">')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}
