// Iter 126 — tiny RFC 4180 CSV writer. We don't need a full library
// for two endpoints; this is ~30 lines and handles the only edge
// cases that bite operators: commas in display names, newlines in
// notes, and quotes in CID strings.

/** Escape a single field per RFC 4180 §2.6. Wraps in double quotes
 * when the value contains a comma, newline, carriage return, or
 * double quote — and doubles any embedded double quotes. */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.length === 0) return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a single CSV row terminated with CRLF — RFC 4180 §2.4
 * mandates CRLF, and Excel + LibreOffice + Google Sheets all expect
 * it for proper newline handling inside quoted fields. */
export function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(',') + '\r\n';
}

/** Build the standard CSV download headers. filename should be
 * URL-safe; embed a date stamp at the call site if you want one. */
export function csvHeaders(filename: string): HeadersInit {
  return {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    // Don't let proxies cache — exports are stateful + per-user.
    'cache-control': 'no-store, max-age=0',
  };
}
