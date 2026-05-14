'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface ConsentRow {
  id: string;
  phone: string;
  consent_type: string;
  source: string;
  source_ref: string | null;
  granted_at: string;
  revoked_at: string | null;
  notes: string | null;
  granted_by_user_id: string | null;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
}

const TYPES = [
  { value: 'express_written', label: 'Express written' },
  { value: 'express_oral', label: 'Express oral' },
  { value: 'prior_business', label: 'Prior business relationship' },
  { value: 'web_form', label: 'Web form opt-in' },
  { value: 'other', label: 'Other' },
];

const SOURCES = [
  { value: 'web_form', label: 'Web form' },
  { value: 'csv_import', label: 'CSV import' },
  { value: 'manual', label: 'Manual entry' },
  { value: 'recording', label: 'Recorded call' },
  { value: 'pdf_signature', label: 'Signed PDF' },
  { value: 'other', label: 'Other' },
];

export function ConsentRecordsClient({
  initial,
  canEdit,
  canDelete,
}: {
  initial: ConsentRow[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ConsentRow[]>(initial);
  const [searchPhone, setSearchPhone] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh(phone: string, active: boolean) {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (phone) params.set('phone', phone);
      if (active) params.set('active_only', '1');
      const res = await fetch(
        `/api/consent-records?${params.toString()}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { records: ConsentRow[] };
      setRows(data.records);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4">
      <AddForm
        canEdit={canEdit}
        onAdded={() => {
          void refresh(searchPhone, activeOnly);
          router.refresh();
        }}
      />

      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Search by phone</span>
          <input
            value={searchPhone}
            onChange={(e) => setSearchPhone(e.target.value)}
            className="input"
            placeholder="+15551234567"
          />
        </label>
        <label className="text-sm flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          <span>Active only</span>
        </label>
        <button
          type="button"
          onClick={() => refresh(searchPhone, activeOnly)}
          disabled={refreshing}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {refreshing ? 'Searching…' : 'Search'}
        </button>
        <button
          type="button"
          onClick={() => {
            setSearchPhone('');
            setActiveOnly(false);
            void refresh('', false);
          }}
          disabled={refreshing}
          className="text-sm text-link hover:underline"
        >
          Clear
        </button>
      </div>

      <div className="overflow-x-auto border border-border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Granted</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-fg-subtle">
                  No consent records match.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <Row
                  key={r.id}
                  row={r}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onChanged={() => {
                    void refresh(searchPhone, activeOnly);
                    router.refresh();
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  row,
  canEdit,
  canDelete,
  onChanged,
}: {
  row: ConsentRow;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const revoked = Boolean(row.revoked_at);
  return (
    <tr className={`border-t border-border align-top ${revoked ? 'opacity-60' : ''}`}>
      <td className="px-3 py-2 font-mono">{row.phone}</td>
      <td className="px-3 py-2">{labelFor(TYPES, row.consent_type)}</td>
      <td className="px-3 py-2">{labelFor(SOURCES, row.source)}</td>
      <td className="px-3 py-2 text-xs">
        {row.source_ref ? (
          <span className="font-mono break-all">{row.source_ref}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {new Date(row.granted_at).toLocaleString()}
      </td>
      <td className="px-3 py-2 text-xs">
        {revoked ? (
          <span className="text-warn">
            ✕ Revoked
            <br />
            <span className="text-fg-subtle">
              {new Date(row.revoked_at!).toLocaleString()}
            </span>
          </span>
        ) : (
          <span className="text-success">● Active</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap">
        {canEdit && !revoked ? (
          <button
            type="button"
            onClick={async () => {
              const reason = prompt('Reason for revocation (optional):', '');
              if (reason === null) return;
              const res = await fetch(`/api/consent-records/${row.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ reason: reason || '' }),
              });
              if (res.ok) onChanged();
              else alert(`Revoke failed (HTTP ${res.status})`);
            }}
            className="text-warn hover:underline"
          >
            Revoke
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={async () => {
              if (
                !confirm(
                  `Hard-delete this consent record? (admin-only; for data correction)`,
                )
              )
                return;
              const res = await fetch(`/api/consent-records/${row.id}`, {
                method: 'DELETE',
                credentials: 'same-origin',
              });
              if (res.ok) onChanged();
              else alert(`Delete failed (HTTP ${res.status})`);
            }}
            className="text-error hover:underline ml-3"
          >
            Delete
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function AddForm({
  canEdit,
  onAdded,
}: {
  canEdit: boolean;
  onAdded: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [consentType, setConsentType] = useState('express_written');
  const [source, setSource] = useState('web_form');
  const [sourceRef, setSourceRef] = useState('');
  const [grantedAt, setGrantedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        phone,
        consent_type: consentType,
        source,
        source_ref: sourceRef,
        notes,
      };
      if (grantedAt) body.granted_at = new Date(grantedAt).toISOString();
      const res = await fetch('/api/consent-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setPhone('');
      setSourceRef('');
      setNotes('');
      setGrantedAt('');
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 bg-card space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">
        Record consent
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="input"
            placeholder="+15551234567"
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Consent type</span>
          <select
            value={consentType}
            onChange={(e) => setConsentType(e.target.value)}
            className="input"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="input"
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">
            Granted at (optional — defaults to now)
          </span>
          <input
            type="datetime-local"
            value={grantedAt}
            onChange={(e) => setGrantedAt(e.target.value)}
            className="input"
          />
        </label>
        <label className="text-sm flex flex-col gap-1 md:col-span-2">
          <span className="text-fg-subtle">
            Evidence reference (URL / file / recording id)
          </span>
          <input
            value={sourceRef}
            onChange={(e) => setSourceRef(e.target.value)}
            className="input font-mono text-xs"
            placeholder="https://… or signed-consent-2026-05-13.pdf"
          />
        </label>
        <label className="text-sm flex flex-col gap-1 md:col-span-2">
          <span className="text-fg-subtle">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input"
            rows={2}
          />
        </label>
      </div>
      {error ? <p className="text-error text-sm">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || !phone}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Record consent'}
      </button>
    </div>
  );
}

function labelFor(
  options: { value: string; label: string }[],
  value: string,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
