'use client';

// Iter 165 — Print button. Trivial client component because
// window.print() can't be called from a server component, but the
// TCPA report itself needs to stay server-rendered for the DB
// queries.

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="bg-card-hover hover:bg-card-hover/70 border border-border px-3 py-1.5 rounded text-sm no-print"
    >
      🖨 Print
    </button>
  );
}
