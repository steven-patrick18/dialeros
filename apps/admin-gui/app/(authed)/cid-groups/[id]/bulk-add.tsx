'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function BulkAddCids({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    | { tone: 'ok'; inserted: number; rejected: string[] }
    | { tone: 'err'; text: string }
    | null
  >(null);

  async function add() {
    if (!text.trim()) {
      setMsg({ tone: 'err', text: 'Paste at least one number.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/cid-groups/${groupId}/numbers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `Failed (${res.status})` });
      return;
    }
    const j = (await res.json()) as { inserted: number; rejected: string[] };
    setMsg({ tone: 'ok', inserted: j.inserted, rejected: j.rejected });
    setText('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={'+14155551234\n+14155551235\n+14155551236'}
        className="input font-mono text-xs w-full"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add numbers'}
        </button>
        {msg?.tone === 'ok' && (
          <div className="text-xs">
            <span className="text-success">
              Added {msg.inserted.toLocaleString()} number
              {msg.inserted === 1 ? '' : 's'}.
            </span>
            {msg.rejected.length > 0 && (
              <span className="text-warn ml-2">
                {msg.rejected.length} rejected: {msg.rejected.slice(0, 3).join(', ')}
                {msg.rejected.length > 3 ? '…' : ''}
              </span>
            )}
          </div>
        )}
        {msg?.tone === 'err' && (
          <span className="text-xs text-error">{msg.text}</span>
        )}
      </div>
    </div>
  );
}
