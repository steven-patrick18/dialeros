import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import {
  getCampaign,
  getCampaignSurvey,
  getSurveyResponseStats,
  parseSurveyOptions,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 159 — Per-survey response distribution + CSV export entry.
// Server-renders the distribution data directly from
// getSurveyResponseStats — no client fetch round-trip. CSV
// export is a separate endpoint (link below; the browser
// downloads the file via Content-Disposition: attachment).

interface QuestionBucket {
  question_id: number;
  question_text: string;
  question_type: string;
  options: string[];
  is_required: boolean;
  total: number;
  answers: Array<{ answer_text: string | null; count: number }>;
}

export default async function SurveyResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Survey responses</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  const { id } = await params;
  const campaign = getCampaign(id);
  if (!campaign) notFound();

  const bundle = getCampaignSurvey(id);
  if (!bundle) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Survey responses</h1>
        <p className="text-fg-subtle text-sm">
          No survey defined for this campaign.{' '}
          <Link
            href={`/campaigns/${id}/survey`}
            className="text-link hover:underline"
          >
            Create one
          </Link>
          .
        </p>
      </div>
    );
  }

  // Aggregate stats per question. The DB returns one row per
  // (question, answer_text) tuple; group into a per-question
  // bucket here so the renderer doesn't repeat the question
  // metadata.
  const rows = getSurveyResponseStats(bundle.survey.id);
  const byQuestion = new Map<number, QuestionBucket>();
  for (const q of bundle.questions) {
    byQuestion.set(q.id, {
      question_id: q.id,
      question_text: q.question_text,
      question_type: q.question_type,
      options: parseSurveyOptions(q),
      is_required: q.is_required === 1,
      total: 0,
      answers: [],
    });
  }
  for (const r of rows) {
    const b = byQuestion.get(r.question_id);
    if (!b) continue;
    b.total += r.answer_count;
    b.answers.push({ answer_text: r.answer_text, count: r.answer_count });
  }

  const totalQuestionEntries = [...byQuestion.values()].reduce(
    (a, b) => a + b.total,
    0,
  );

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-fg-subtle mb-1">
        <Link
          href={`/campaigns/${id}/survey`}
          className="text-link hover:underline"
        >
          ← back to survey definition
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">
        Survey responses — {campaign.name}
      </h1>
      <p className="text-fg-subtle text-sm mb-4 max-w-3xl">
        Distribution across all collected answers. Each agent
        wrap-up insert lands here. Empty rows mean no agent has
        answered that question yet.
      </p>

      <div className="flex items-center gap-3 mb-6">
        <a
          href={`/api/campaigns/${id}/survey/export`}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm"
        >
          ⬇ Download CSV (all-time)
        </a>
        <a
          href={`/api/campaigns/${id}/survey/export?since=${encodeURIComponent(
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          )}`}
          className="text-link hover:underline text-sm"
        >
          Last 7 days only
        </a>
        <span className="text-xs text-fg-subtle ml-auto">
          {totalQuestionEntries.toLocaleString()} total answers across{' '}
          {byQuestion.size} questions
        </span>
      </div>

      <div className="space-y-4">
        {[...byQuestion.values()].map((q) => (
          <QuestionResponseCard key={q.question_id} bucket={q} />
        ))}
      </div>
    </div>
  );
}

function QuestionResponseCard({ bucket }: { bucket: QuestionBucket }) {
  // For choice questions, zero-fill the defined options so the
  // operator sees "Option X: 0" rather than the option just
  // missing from the table.
  let rows = bucket.answers;
  if (
    bucket.question_type === 'single_choice' ||
    bucket.question_type === 'multi_choice' ||
    bucket.question_type === 'yes_no'
  ) {
    const present = new Set(
      bucket.answers.map((a) => a.answer_text ?? ''),
    );
    const definedOptions =
      bucket.question_type === 'yes_no' ? ['Yes', 'No'] : bucket.options;
    for (const opt of definedOptions) {
      if (!present.has(opt)) {
        rows = [...rows, { answer_text: opt, count: 0 }];
      }
    }
    rows = [...rows].sort((a, b) => b.count - a.count);
  }

  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 1);

  return (
    <div className="border border-border rounded p-4 bg-card">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="font-medium">
            {bucket.question_text}
            {bucket.is_required ? (
              <span className="text-error ml-1">*</span>
            ) : null}
          </h2>
          <div className="text-xs text-fg-subtle">
            {bucket.question_type}
            {' · '}
            {bucket.total.toLocaleString()} answers
          </div>
        </div>
      </div>

      {bucket.question_type === 'text' ? (
        rows.length === 0 ? (
          <p className="text-fg-subtle text-sm">No answers yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.slice(0, 50).map((r, i) => (
              <li
                key={i}
                className="border-l-2 border-border pl-3 break-words"
              >
                <span className="text-fg">{r.answer_text}</span>
                {r.count > 1 ? (
                  <span className="text-fg-subtle ml-2">
                    ×{r.count}
                  </span>
                ) : null}
              </li>
            ))}
            {rows.length > 50 ? (
              <li className="text-fg-subtle text-xs">
                … {rows.length - 50} more (export CSV for the full set)
              </li>
            ) : null}
          </ul>
        )
      ) : bucket.question_type === 'numeric' ? (
        <NumericSummary rows={rows} />
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-3 w-40 truncate">
                  {bucket.question_type === 'multi_choice' &&
                  r.answer_text &&
                  r.answer_text.startsWith('[')
                    ? formatMulti(r.answer_text)
                    : (r.answer_text ?? '—')}
                </td>
                <td className="py-1.5">
                  <div className="bg-card-hover/30 rounded h-3">
                    <div
                      className="bg-accent rounded h-3"
                      style={{
                        width: `${maxCount > 0 ? (r.count / maxCount) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums w-16">
                  {r.count.toLocaleString()}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums w-14 text-fg-subtle">
                  {bucket.total > 0
                    ? `${((r.count / bucket.total) * 100).toFixed(1)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NumericSummary({
  rows,
}: {
  rows: Array<{ answer_text: string | null; count: number }>;
}) {
  const nums: number[] = [];
  for (const r of rows) {
    if (!r.answer_text) continue;
    const n = Number(r.answer_text);
    if (!Number.isFinite(n)) continue;
    for (let i = 0; i < r.count; i++) nums.push(n);
  }
  if (nums.length === 0) {
    return <p className="text-fg-subtle text-sm">No numeric answers yet.</p>;
  }
  nums.sort((a, b) => a - b);
  const min = nums[0]!;
  const max = nums[nums.length - 1]!;
  const sum = nums.reduce((a, b) => a + b, 0);
  const avg = sum / nums.length;
  const median = nums[Math.floor(nums.length / 2)]!;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
      <Stat label="Count" value={nums.length.toLocaleString()} />
      <Stat label="Avg" value={avg.toFixed(2)} />
      <Stat label="Median" value={median.toFixed(2)} />
      <Stat label="Range" value={`${min} — ${max}`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// multi_choice answers are stored as JSON-stringified arrays. Render
// them readably while preserving the raw JSON for CSV export
// (operators who want individual options can split themselves).
function formatMulti(s: string): string {
  try {
    const arr = JSON.parse(s) as unknown;
    if (Array.isArray(arr)) return (arr as string[]).join(', ');
  } catch {
    /* fallthrough */
  }
  return s;
}
