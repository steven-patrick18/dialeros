'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 157 — Survey editor. Stateful client form for the
// per-campaign survey definition. Mirrors the call-menu options
// grid pattern: add/remove question rows, each row carries its
// type + options (where applicable) + required flag.
//
// Save submits the entire definition as one PUT — server replaces
// questions wholesale inside a transaction.

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single choice (radio)' },
  { value: 'multi_choice', label: 'Multi choice (checkbox)' },
  { value: 'text', label: 'Free text' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'yes_no', label: 'Yes / No' },
] as const;

interface Question {
  ordering: number;
  question_text: string;
  question_type: string;
  options: string[];
  is_required: boolean;
}

interface Initial {
  name: string;
  is_active: boolean;
  questions: Question[];
}

export function SurveyEditor({
  campaignId,
  initial,
  hasExisting,
}: {
  campaignId: string;
  initial: Initial;
  hasExisting: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [isActive, setIsActive] = useState(initial.is_active);
  const [questions, setQuestions] = useState<Question[]>(initial.questions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function addQuestion() {
    setQuestions((qs) => [
      ...qs,
      {
        ordering: qs.length,
        question_text: '',
        question_type: 'single_choice',
        options: ['Yes', 'No'],
        is_required: false,
      },
    ]);
  }

  function removeQuestion(idx: number) {
    setQuestions((qs) => qs.filter((_, i) => i !== idx));
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    setQuestions((qs) => {
      const target = idx + dir;
      if (target < 0 || target >= qs.length) return qs;
      const next = [...qs];
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next.map((q, i) => ({ ...q, ordering: i }));
    });
  }

  function setQ<K extends keyof Question>(
    idx: number,
    key: K,
    val: Question[K],
  ) {
    setQuestions((qs) =>
      qs.map((q, i) => (i === idx ? { ...q, [key]: val } : q)),
    );
  }

  function setOption(qIdx: number, oIdx: number, val: string) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIdx
          ? {
              ...q,
              options: q.options.map((o, j) => (j === oIdx ? val : o)),
            }
          : q,
      ),
    );
  }

  function addOption(qIdx: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIdx ? { ...q, options: [...q.options, ''] } : q,
      ),
    );
  }

  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIdx
          ? { ...q, options: q.options.filter((_, j) => j !== oIdx) }
          : q,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/survey`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name,
          is_active: isActive,
          questions: questions.map((q, idx) => ({
            ordering: idx,
            question_text: q.question_text,
            question_type: q.question_type,
            options:
              q.question_type === 'single_choice' ||
              q.question_type === 'multi_choice'
                ? q.options.filter((o) => o.trim() !== '')
                : [],
            is_required: q.is_required,
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };
        setError(
          data.error
            ? `${data.error}${data.details ? ' — ' + JSON.stringify(data.details) : ''}`
            : `HTTP ${res.status}`,
        );
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this survey? All collected answers stay.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/survey`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`Delete failed — HTTP ${res.status}`);
        return;
      }
      router.push(`/campaigns/${campaignId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Survey name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="campaign-survey"
          />
        </label>
        <label className="text-sm flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span>
            Active{' '}
            <span className="text-fg-subtle">
              (only active surveys appear in the agent wrap-up)
            </span>
          </span>
        </label>
      </div>

      <div className="space-y-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Questions
        </h2>
        {questions.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No questions yet. Add one to start.
          </p>
        ) : (
          questions.map((q, idx) => (
            <div
              key={idx}
              className="border border-border rounded p-3 space-y-3 bg-card"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-fg-subtle">
                  Question #{idx + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveQuestion(idx, -1)}
                    disabled={idx === 0}
                    className="text-xs text-fg-subtle hover:text-fg disabled:opacity-30 px-2"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuestion(idx, 1)}
                    disabled={idx === questions.length - 1}
                    className="text-xs text-fg-subtle hover:text-fg disabled:opacity-30 px-2"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    className="text-error hover:text-error-strong text-sm px-1"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <label className="text-sm flex flex-col gap-1">
                <span className="text-fg-subtle">Question text</span>
                <input
                  required
                  value={q.question_text}
                  onChange={(e) => setQ(idx, 'question_text', e.target.value)}
                  className="input"
                  placeholder="e.g. Was the caller satisfied?"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm flex flex-col gap-1">
                  <span className="text-fg-subtle">Type</span>
                  <select
                    value={q.question_type}
                    onChange={(e) =>
                      setQ(idx, 'question_type', e.target.value)
                    }
                    className="input"
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm flex items-center gap-2 mt-6">
                  <input
                    type="checkbox"
                    checked={q.is_required}
                    onChange={(e) =>
                      setQ(idx, 'is_required', e.target.checked)
                    }
                  />
                  <span>Required (blocks wrap-up submit if blank)</span>
                </label>
              </div>

              {(q.question_type === 'single_choice' ||
                q.question_type === 'multi_choice') ? (
                <div className="space-y-1.5">
                  <span className="text-fg-subtle text-xs">
                    Options
                  </span>
                  {q.options.map((opt, oIdx) => (
                    <div key={oIdx} className="flex gap-2">
                      <input
                        value={opt}
                        onChange={(e) => setOption(idx, oIdx, e.target.value)}
                        className="input flex-1"
                        placeholder={`Option ${oIdx + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(idx, oIdx)}
                        className="text-error hover:text-error-strong text-sm px-2"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addOption(idx)}
                    disabled={q.options.length >= 20}
                    className="text-xs bg-card-hover hover:bg-card-hover/70 px-3 py-1 rounded disabled:opacity-50"
                  >
                    + Add option
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
        <button
          type="button"
          onClick={addQuestion}
          disabled={questions.length >= 30}
          className="text-sm bg-card-hover hover:bg-card-hover/70 px-3 py-1.5 rounded disabled:opacity-50"
        >
          + Add question
        </button>
      </div>

      {error ? <div className="text-error text-sm">{error}</div> : null}
      {success ? <div className="text-success text-sm">Saved.</div> : null}

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save survey'}
        </button>
        {hasExisting ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            className="text-error hover:text-error-strong text-sm"
          >
            Delete survey
          </button>
        ) : null}
      </div>
    </div>
  );
}
