'use client';

import { useEffect, useState } from 'react';

// Iter 40 — phones owned by a user. Each is a SIP credential the
// browser softphone (or a hard phone) can register with. The is_primary
// row is the one the pacer bridges live calls to.

interface PhoneRow {
  id: string;
  user_id: string;
  extension: string;
  label: string | null;
  protocol: string;
  password: string;
  is_primary: number;
}

export function PhonesPanel({ userId }: { userId: string }) {
  const [phones, setPhones] = useState<PhoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const res = await fetch(`/api/users/${userId}/phones`, {
      cache: 'no-store',
    });
    if (!res.ok) {
      setError(`Failed to load phones (${res.status})`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as { phones: PhoneRow[] };
    setPhones(json.phones);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div>
      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-2 mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-fg-subtle text-sm">Loading…</div>
      ) : phones.length === 0 ? (
        <div className="text-fg-subtle text-sm mb-3">
          No phones provisioned. Without a phone, the agent&apos;s
          softphone falls back to the shared default extensions.
        </div>
      ) : (
        <ul className="space-y-2 mb-3">
          {phones.map((p) => (
            <PhoneRow
              key={p.id}
              phone={p}
              onChanged={reload}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {showAdd ? (
        <AddPhoneForm
          userId={userId}
          existing={phones.length}
          onCancel={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void reload();
          }}
          onError={setError}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowAdd(true);
          }}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-xs"
        >
          + Add phone
        </button>
      )}
    </div>
  );
}

function PhoneRow({
  phone,
  onChanged,
  onError,
}: {
  phone: PhoneRow;
  onChanged: () => void | Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <EditPhoneForm
          phone={phone}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void onChanged();
          }}
          onError={onError}
        />
      </li>
    );
  }

  async function makePrimary() {
    onError(null);
    const res = await fetch(`/api/phones/${phone.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      onError(j.error ?? `Failed (${res.status})`);
      return;
    }
    void onChanged();
  }

  async function remove() {
    if (!confirm(`Delete extension ${phone.extension}?`)) return;
    onError(null);
    const res = await fetch(`/api/phones/${phone.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      onError(j.error ?? `Failed (${res.status})`);
      return;
    }
    void onChanged();
  }

  return (
    <li className="border border-border rounded p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm">{phone.extension}</span>
          <span className="text-[10px] uppercase text-fg-subtle">
            {phone.protocol}
          </span>
          {phone.is_primary === 1 && (
            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded border bg-success/10 text-success border-success/40">
              Primary
            </span>
          )}
        </div>
        {phone.label && (
          <div className="text-xs text-fg-subtle mt-0.5">{phone.label}</div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {phone.is_primary !== 1 && (
          <button
            type="button"
            onClick={makePrimary}
            className="text-xs px-2 py-1 rounded border border-border hover:border-fg-muted"
          >
            Make primary
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            onError(null);
            setEditing(true);
          }}
          className="text-xs px-2 py-1 rounded border border-border hover:border-fg-muted"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={remove}
          className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function AddPhoneForm({
  userId,
  existing,
  onCancel,
  onSaved,
  onError,
}: {
  userId: string;
  existing: number;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [extension, setExtension] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [protocol, setProtocol] = useState<'sip' | 'iax2'>('sip');
  const [isPrimary, setIsPrimary] = useState(true);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    const res = await fetch(`/api/users/${userId}/phones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extension,
        label: label || undefined,
        password,
        protocol,
        is_primary: existing === 0 ? true : isPrimary,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      onError(j.error ?? `Failed (${res.status})`);
      return;
    }
    onSaved();
  }

  return (
    <form
      onSubmit={submit}
      className="border border-border rounded p-3 space-y-3 bg-card"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs text-fg-muted mb-1">Extension</div>
          <input
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            required
            pattern="[0-9*#]+"
            className="input"
            placeholder="e.g. 1009"
          />
        </label>
        <label className="block">
          <div className="text-xs text-fg-muted mb-1">Protocol</div>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as 'sip' | 'iax2')}
            className="input"
          >
            <option value="sip">SIP</option>
            <option value="iax2">IAX2</option>
          </select>
        </label>
      </div>
      <label className="block">
        <div className="text-xs text-fg-muted mb-1">Label (optional)</div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="input"
          placeholder="e.g. desk phone"
        />
      </label>
      <label className="block">
        <div className="text-xs text-fg-muted mb-1">SIP password</div>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={4}
          className="input"
          placeholder="min 4 chars"
        />
      </label>
      {existing > 0 && (
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-fg-muted">Make this the primary phone</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-xs disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save phone'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-border hover:border-fg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditPhoneForm({
  phone,
  onCancel,
  onSaved,
  onError,
}: {
  phone: PhoneRow;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string | null) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [extension, setExtension] = useState(phone.extension);
  const [label, setLabel] = useState(phone.label ?? '');
  const [password, setPassword] = useState('');
  const [protocol, setProtocol] = useState<'sip' | 'iax2'>(
    phone.protocol === 'iax2' ? 'iax2' : 'sip',
  );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    const body: Record<string, unknown> = {
      extension,
      label,
      protocol,
    };
    if (password.length > 0) body.password = password;
    const res = await fetch(`/api/phones/${phone.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      onError(j.error ?? `Failed (${res.status})`);
      return;
    }
    onSaved();
  }

  return (
    <form
      onSubmit={submit}
      className="border border-border rounded p-3 space-y-3 bg-card"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <div className="text-xs text-fg-muted mb-1">Extension</div>
          <input
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
            required
            pattern="[0-9*#]+"
            className="input"
          />
        </label>
        <label className="block">
          <div className="text-xs text-fg-muted mb-1">Protocol</div>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as 'sip' | 'iax2')}
            className="input"
          >
            <option value="sip">SIP</option>
            <option value="iax2">IAX2</option>
          </select>
        </label>
      </div>
      <label className="block">
        <div className="text-xs text-fg-muted mb-1">Label</div>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="input"
        />
      </label>
      <label className="block">
        <div className="text-xs text-fg-muted mb-1">
          New SIP password
        </div>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={4}
          className="input"
          placeholder="●●●● (unchanged)"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-xs disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 rounded border border-border hover:border-fg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
