'use client';

import { CrmLookupButton } from './crm-lookup';

import { useEffect, useRef, useState } from 'react';

interface AgentIntent {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  lead_name: string | null;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
  disposition: string | null;
  dispositioned_at: string | null;
  callback_at: string | null;
  recording_path: string | null;
}

const DISPOSITIONS: Array<{ code: string; label: string; tone: string }> = [
  { code: 'SALE', label: 'Sale', tone: 'text-success' },
  { code: 'CALLBACK', label: 'Callback', tone: 'text-warn' },
  { code: 'SURVEYED', label: 'Surveyed', tone: 'text-success' },
  { code: 'VOICEMAIL_DROPPED', label: 'VM dropped', tone: 'text-warn' },
  { code: 'NO_INTEREST', label: 'No interest', tone: 'text-fg-muted' },
  { code: 'ANSWERING_MACHINE', label: 'Hit AM', tone: 'text-fg-muted' },
  { code: 'WRONG_NUMBER', label: 'Wrong #', tone: 'text-fg-muted' },
  { code: 'BAD_NUMBER', label: 'Bad #', tone: 'text-fg-muted' },
  { code: 'DNC', label: 'DNC', tone: 'text-error' },
];

export function AgentFeed({ initial }: { initial: AgentIntent[] }) {
  const [intents, setIntents] = useState<AgentIntent[]>(initial);
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const es = new EventSource('/api/agent/intents/events');
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'intent') {
          setIntents((prev) => {
            if (prev.some((p) => p.id === data.intent.id)) return prev;
            return [...prev, data.intent].slice(-200);
          });
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [intents]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    userScrolledRef.current = !atBottom;
  };

  // Iter 158 — clicking a disposition opens the wrap-up dialog
  // which lazily fetches the campaign survey. If the campaign has
  // no active survey, the dialog auto-submits the disposition and
  // closes (one tap = one dispose, same as before). If a survey
  // exists, the agent fills it in + clicks Submit to finalize.
  const [wrapUpFor, setWrapUpFor] = useState<{
    intent: AgentIntent;
    initialCode: string;
  } | null>(null);

  function openWrapUp(intent: AgentIntent, code: string) {
    setError(null);
    setWrapUpFor({ intent, initialCode: code });
  }

  async function submitDispose(args: {
    intentId: number;
    code: string;
    callbackAt?: string;
    surveyAnswers?: Array<{ question_id: number; answer_text: string | null }>;
  }) {
    setBusyId(args.intentId);
    setError(null);
    const body: Record<string, unknown> = { disposition: args.code };
    if (args.code === 'CALLBACK') {
      body.callback_at =
        args.callbackAt ??
        new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
    if (args.surveyAnswers && args.surveyAnswers.length > 0) {
      body.survey_answers = args.surveyAnswers;
    }
    try {
      const res = await fetch(
        `/api/agent/intents/${args.intentId}/dispose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `dispose failed (${res.status})`);
        return false;
      }
      const j = (await res.json()) as { intent: AgentIntent };
      setIntents((prev) =>
        prev.map((p) => (p.id === args.intentId ? j.intent : p)),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 text-xs">
        {connected ? (
          <span className="text-success">● live</span>
        ) : (
          <span className="text-fg-subtle">○ reconnecting…</span>
        )}
        <span className="text-fg-subtle tabular-nums">
          {intents.length} shown
        </span>
        {error && (
          <span className="text-error truncate">{error}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-96 overflow-y-auto p-3 text-xs space-y-1 bg-card/70 border border-border rounded"
      >
        {intents.length === 0 ? (
          <div className="text-fg-subtle font-mono">
            No calls yet. When the pacer assigns one to you it&apos;ll appear
            here.
          </div>
        ) : (
          intents.map((i) => (
            <Row
              key={i.id}
              intent={i}
              busy={busyId === i.id}
              onDispose={(code) => openWrapUp(i, code)}
            />
          ))
        )}
      </div>
      {wrapUpFor ? (
        <WrapUpDialog
          intent={wrapUpFor.intent}
          initialCode={wrapUpFor.initialCode}
          onClose={() => setWrapUpFor(null)}
          onSubmit={async (args) => {
            const ok = await submitDispose({
              intentId: wrapUpFor.intent.id,
              code: args.code,
              callbackAt: args.callbackAt,
              surveyAnswers: args.surveyAnswers,
            });
            if (ok) setWrapUpFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Row({
  intent,
  busy,
  onDispose,
}: {
  intent: AgentIntent;
  busy: boolean;
  onDispose: (code: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="border-b border-border/40 pb-1">
      <div className="flex gap-3 leading-tight font-mono">
        <span className="text-fg-subtle/70 shrink-0 tabular-nums">
          {formatTime(intent.ts)}
        </span>
        <span className="text-accent shrink-0 w-24 truncate">
          {intent.campaign_name}
        </span>
        <span className="text-fg shrink-0 w-32 tabular-nums">
          {intent.transformed_phone}
        </span>
        {intent.lead_name && (
          <span className="text-fg-muted shrink-0 w-24 truncate">
            {intent.lead_name}
          </span>
        )}
        <span className="text-fg-subtle/70">[{intent.kind}]</span>
        {intent.recording_path && (
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="text-accent hover:text-accent-hover text-[11px] uppercase tracking-wide"
            title="Play recording"
          >
            {playing ? '▣' : '▶'} rec
          </button>
        )}
        {/* Iter 185 — CRM lookup. No-op render when no provider enabled. */}
        <CrmLookupButton phone={intent.transformed_phone} />
      </div>
      {playing && intent.recording_path && (
        <div className="mt-1 ml-12">
          <audio
            src={`/api/recordings/${intent.id}`}
            controls
            preload="metadata"
            className="h-7 w-full max-w-md"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1 ml-12">
        {intent.disposition ? (
          <span
            className={`text-[11px] uppercase tracking-wide ${toneFor(intent.disposition)}`}
          >
            ✓ {labelFor(intent.disposition)}
            {intent.callback_at && (
              <span className="text-fg-subtle ml-2 normal-case tracking-normal">
                callback {new Date(intent.callback_at).toLocaleString()}
              </span>
            )}
          </span>
        ) : (
          DISPOSITIONS.map((d) => (
            <button
              key={d.code}
              onClick={() => onDispose(d.code)}
              disabled={busy}
              className={`text-[11px] px-2 py-0.5 rounded border border-border hover:bg-card-hover disabled:opacity-50 ${d.tone}`}
            >
              {d.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function labelFor(code: string): string {
  return DISPOSITIONS.find((d) => d.code === code)?.label ?? code;
}

function toneFor(code: string): string {
  return DISPOSITIONS.find((d) => d.code === code)?.tone ?? 'text-fg';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

interface SurveyQuestion {
  id: number;
  ordering: number;
  question_text: string;
  question_type: string;
  options: string[];
  is_required: number;
}

// Iter 158 — Wrap-up dialog: fetches the campaign survey for this
// intent's campaign and renders the form. If no survey exists,
// auto-submits the chosen disposition and closes immediately.
function WrapUpDialog({
  intent,
  initialCode,
  onClose,
  onSubmit,
}: {
  intent: AgentIntent;
  initialCode: string;
  onClose: () => void;
  onSubmit: (args: {
    code: string;
    callbackAt?: string;
    surveyAnswers?: Array<{ question_id: number; answer_text: string | null }>;
  }) => Promise<void>;
}) {
  const [questions, setQuestions] = useState<SurveyQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [code, setCode] = useState(initialCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  // Iter 174 — fetch the per-campaign disposition palette. Empty
  // array = use hardcoded DISPOSITIONS fallback.
  const [palette, setPalette] = useState<
    {
      code: string;
      label: string;
      lead_status_target: string;
      is_callback: number;
    }[] | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${intent.campaign_id}/dispositions`, {
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(
        (data: {
          palette: {
            code: string;
            label: string;
            lead_status_target: string;
            is_callback: number;
            is_active: number;
          }[];
        }) => {
          if (cancelled) return;
          setPalette(
            data.palette
              .filter((p) => p.is_active === 1)
              .map((p) => ({
                code: p.code,
                label: p.label,
                lead_status_target: p.lead_status_target,
                is_callback: p.is_callback,
              })),
          );
        },
      )
      .catch(() => {
        if (!cancelled) setPalette([]);
      });
    return () => {
      cancelled = true;
    };
  }, [intent.campaign_id]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${intent.campaign_id}/survey`, {
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(
        (data: {
          survey: { is_active: number } | null;
          questions: SurveyQuestion[];
        }) => {
          if (cancelled) return;
          if (
            !data.survey ||
            data.survey.is_active !== 1 ||
            data.questions.length === 0
          ) {
            // No active survey — short-circuit. Submit the
            // disposition right away with no answers.
            setAutoSubmitted(true);
            void onSubmit({ code: initialCode });
            return;
          }
          setQuestions(data.questions);
        },
      )
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent.campaign_id]);

  function setAnswer(qid: number, val: unknown) {
    setAnswers((a) => ({ ...a, [qid]: val }));
  }

  function submit() {
    if (!questions) return;
    // Required-field check
    const missing = questions.filter(
      (q) =>
        q.is_required === 1 &&
        (answers[q.id] === undefined ||
          answers[q.id] === null ||
          answers[q.id] === '' ||
          (Array.isArray(answers[q.id]) &&
            (answers[q.id] as unknown[]).length === 0)),
    );
    if (missing.length > 0) {
      setError(
        `Please answer the required question(s): ${missing
          .map((q) => `"${q.question_text}"`)
          .join(', ')}`,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const surveyAnswers = questions
      .map((q) => {
        const v = answers[q.id];
        if (v === undefined || v === null || v === '') return null;
        let text: string;
        if (Array.isArray(v)) {
          if ((v as unknown[]).length === 0) return null;
          text = JSON.stringify(v);
        } else {
          text = String(v);
        }
        return { question_id: q.id, answer_text: text };
      })
      .filter((x): x is { question_id: number; answer_text: string } => x !== null);
    void onSubmit({ code, surveyAnswers }).finally(() => setSubmitting(false));
  }

  if (autoSubmitted) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-bg border border-border rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Wrap-up</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-fg-subtle hover:text-fg text-sm"
            disabled={submitting}
          >
            ✕
          </button>
        </div>
        <div className="text-sm text-fg-subtle">
          <span className="text-accent">{intent.campaign_name}</span> ·{' '}
          <span className="font-mono">{intent.transformed_phone}</span>
          {intent.lead_name ? ` · ${intent.lead_name}` : ''}
        </div>

        {questions === null ? (
          <p className="text-fg-subtle text-sm">Loading survey…</p>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className="space-y-1">
                <label className="text-sm font-medium">
                  {q.question_text}
                  {q.is_required === 1 ? (
                    <span className="text-error ml-1">*</span>
                  ) : null}
                </label>
                {q.question_type === 'text' ? (
                  <input
                    type="text"
                    className="input"
                    value={String(answers[q.id] ?? '')}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : q.question_type === 'numeric' ? (
                  <input
                    type="number"
                    className="input"
                    value={String(answers[q.id] ?? '')}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                ) : q.question_type === 'yes_no' ? (
                  <div className="flex gap-2">
                    {['Yes', 'No'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setAnswer(q.id, opt)}
                        className={`px-3 py-1.5 rounded text-sm border ${
                          answers[q.id] === opt
                            ? 'bg-accent text-accent-fg border-accent'
                            : 'border-border hover:bg-card-hover'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                ) : q.question_type === 'single_choice' ? (
                  <div className="space-y-1">
                    {q.options.map((opt) => (
                      <label
                        key={opt}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          checked={answers[q.id] === opt}
                          onChange={() => setAnswer(q.id, opt)}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : q.question_type === 'multi_choice' ? (
                  <div className="space-y-1">
                    {q.options.map((opt) => {
                      const selected = Array.isArray(answers[q.id])
                        ? (answers[q.id] as string[])
                        : [];
                      const checked = selected.includes(opt);
                      return (
                        <label
                          key={opt}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setAnswer(
                                q.id,
                                checked
                                  ? selected.filter((s) => s !== opt)
                                  : [...selected, opt],
                              );
                            }}
                          />
                          {opt}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div className="pt-3 border-t border-border space-y-2">
          <label className="text-sm font-medium">Disposition</label>
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="input"
            disabled={submitting}
          >
            {palette && palette.length > 0
              ? palette.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} — {p.label}
                  </option>
                ))
              : DISPOSITIONS.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.code} — {d.label}
                  </option>
                ))}
          </select>
        </div>

        {error ? <div className="text-error text-sm">{error}</div> : null}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-fg-subtle hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || questions === null}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Submit wrap-up'}
          </button>
        </div>
      </div>
    </div>
  );
}
