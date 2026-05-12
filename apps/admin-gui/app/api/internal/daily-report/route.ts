import { NextRequest, NextResponse } from 'next/server';
import { buildDailySummary } from '@dialeros/control-plane';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 131 — daily summary report endpoint. Two output modes:
//
//   GET /api/internal/daily-report           → HTML (default)
//   GET /api/internal/daily-report?format=json → structured JSON
//
// Same token gate as the other /api/internal/* hooks
// (X-Inbound-Token or Basic auth password slot). The script
// scripts/send-daily-report.sh curls the HTML and pipes it to
// sendmail.

const INTERNAL_TOKEN = process.env.KAMAILIO_INBOUND_TOKEN ?? '';

function checkToken(req: NextRequest): boolean {
  if (!INTERNAL_TOKEN) return true; // dev mode
  const presented = req.headers.get('x-inbound-token') ?? '';
  if (presented && presented === INTERNAL_TOKEN) return true;
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (m) {
    try {
      const decoded = Buffer.from(m[1]!, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const candidate = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (candidate === INTERNAL_TOKEN) return true;
    } catch {
      /* malformed — fall through */
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const summary = buildDailySummary();
  const format = req.nextUrl.searchParams.get('format') ?? 'html';
  if (format === 'json') {
    return NextResponse.json(summary);
  }
  return new NextResponse(renderHtml(summary), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const s = sec % 60;
    return `${min}m${s.toString().padStart(2, '0')}s`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

function renderHtml(s: ReturnType<typeof buildDailySummary>): string {
  // Email-safe HTML: inline styles only, tables for layout, no
  // external resources. Tested in Gmail / Outlook / Apple Mail.
  const since = new Date(s.since).toLocaleString('en-US', {
    timeZone: 'UTC',
  });
  const generated = new Date(s.generated_at).toLocaleString('en-US', {
    timeZone: 'UTC',
  });
  const dispTone: Record<string, string> = {
    SALE: '#16a34a',
    CALLBACK: '#0ea5e9',
    SURVEYED: '#16a34a',
    VOICEMAIL_DROPPED: '#0ea5e9',
    NO_INTEREST: '#64748b',
    ANSWERING_MACHINE: '#64748b',
    WRONG_NUMBER: '#ca8a04',
    BAD_NUMBER: '#dc2626',
    DNC: '#dc2626',
    OPEN: '#7c3aed',
  };
  const dispRows = s.dispositions
    .filter((d) => d.count > 0 || d.disposition === 'OPEN')
    .map(
      (d) =>
        `<tr><td style="padding:4px 8px;color:${dispTone[d.disposition] ?? '#000'}">${esc(d.disposition)}</td><td style="padding:4px 8px;text-align:right;font-variant-numeric:tabular-nums">${d.count}</td></tr>`,
    )
    .join('');

  const campaignRows = s.campaigns_today
    .map(
      (c) =>
        `<tr><td style="padding:4px 8px">${esc(c.name)}</td><td style="padding:4px 8px;color:#666">${esc(c.type)}</td><td style="padding:4px 8px;color:#666">${esc(c.status)}</td><td style="padding:4px 8px;text-align:right">${c.last_1m}</td><td style="padding:4px 8px;text-align:right;font-weight:600">${c.today.toLocaleString()}</td></tr>`,
    )
    .join('');

  const leaderboardRows = s.leaderboard
    .filter((a) => a.calls_today > 0 || a.dispositions_today > 0)
    .map((a) => {
      const talkPct =
        a.calls_today > 0
          ? `${Math.round((a.talked_today / a.calls_today) * 100)}%`
          : '—';
      return `<tr><td style="padding:4px 8px">${esc(a.display_name || a.username)}</td><td style="padding:4px 8px;color:#666">${esc(a.role)}</td><td style="padding:4px 8px;text-align:right">${a.calls_today}</td><td style="padding:4px 8px;text-align:right">${a.talked_today}</td><td style="padding:4px 8px;text-align:right;color:#666">${talkPct}</td><td style="padding:4px 8px;text-align:right">${fmtMs(a.talk_time_ms_today)}</td><td style="padding:4px 8px;text-align:right">${a.dispositions_today}</td></tr>`;
    })
    .join('');

  const pauseRows = s.pause_reasons
    .map(
      (p) =>
        `<tr><td style="padding:4px 8px">${esc(p.reason)}</td><td style="padding:4px 8px;text-align:right">${p.count}</td><td style="padding:4px 8px;text-align:right;color:#666">${p.agents_affected}</td><td style="padding:4px 8px;text-align:right">${fmtMs(p.avg_duration_ms)}</td><td style="padding:4px 8px;text-align:right;font-weight:600">${fmtMs(p.total_duration_ms)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>DialerOS daily — ${esc(since)}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:880px;margin:0 auto;padding:24px;background:#fafafa">
  <h1 style="margin:0 0 4px 0;font-size:22px">DialerOS daily summary</h1>
  <div style="color:#666;font-size:13px;margin-bottom:24px">Since UTC midnight (${esc(since)} UTC) · generated ${esc(generated)} UTC</div>

  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:8px;margin-bottom:20px">
    <tr>
      <td style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.05em">Calls today</div><div style="font-size:22px;font-weight:600;margin-top:4px">${s.floor.today.toLocaleString()}</div></td>
      <td style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.05em">Completed</div><div style="font-size:22px;font-weight:600;margin-top:4px;color:#16a34a">${s.floor.completed_today.toLocaleString()}</div></td>
      <td style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.05em">Failed</div><div style="font-size:22px;font-weight:600;margin-top:4px;color:#dc2626">${s.floor.failed_today.toLocaleString()}</div></td>
      <td style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.05em">Talk time</div><div style="font-size:22px;font-weight:600;margin-top:4px">${fmtMs(s.totals.talk_time_ms)}</div></td>
      <td style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center"><div style="font-size:11px;text-transform:uppercase;color:#888;letter-spacing:0.05em">Dispositions</div><div style="font-size:22px;font-weight:600;margin-top:4px">${s.totals.dispositions.toLocaleString()}</div></td>
    </tr>
  </table>

  <h2 style="font-size:14px;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:24px 0 8px 0">Dispositions today</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse"><thead><tr style="background:#f3f4f6;color:#666;text-align:left;font-size:11px"><th style="padding:6px 8px">Code</th><th style="padding:6px 8px;text-align:right">Count</th></tr></thead><tbody>${dispRows || '<tr><td colspan=2 style="padding:8px;color:#999">No dispositions logged.</td></tr>'}</tbody></table>

  <h2 style="font-size:14px;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:24px 0 8px 0">Top campaigns</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse"><thead><tr style="background:#f3f4f6;color:#666;text-align:left;font-size:11px"><th style="padding:6px 8px">Campaign</th><th style="padding:6px 8px">Type</th><th style="padding:6px 8px">Status</th><th style="padding:6px 8px;text-align:right">Last 1m</th><th style="padding:6px 8px;text-align:right">Today</th></tr></thead><tbody>${campaignRows || '<tr><td colspan=5 style="padding:8px;color:#999">No campaign activity.</td></tr>'}</tbody></table>

  <h2 style="font-size:14px;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:24px 0 8px 0">Agent leaderboard</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse"><thead><tr style="background:#f3f4f6;color:#666;text-align:left;font-size:11px"><th style="padding:6px 8px">Agent</th><th style="padding:6px 8px">Role</th><th style="padding:6px 8px;text-align:right">Calls</th><th style="padding:6px 8px;text-align:right">Talked</th><th style="padding:6px 8px;text-align:right">Talk%</th><th style="padding:6px 8px;text-align:right">Talk time</th><th style="padding:6px 8px;text-align:right">Dispos</th></tr></thead><tbody>${leaderboardRows || '<tr><td colspan=7 style="padding:8px;color:#999">No agent activity.</td></tr>'}</tbody></table>

  <h2 style="font-size:14px;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:24px 0 8px 0">Pause reasons</h2>
  <table cellpadding="0" cellspacing="0" style="width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:6px;border-collapse:collapse"><thead><tr style="background:#f3f4f6;color:#666;text-align:left;font-size:11px"><th style="padding:6px 8px">Reason</th><th style="padding:6px 8px;text-align:right">Pauses</th><th style="padding:6px 8px;text-align:right">Agents</th><th style="padding:6px 8px;text-align:right">Avg</th><th style="padding:6px 8px;text-align:right">Total</th></tr></thead><tbody>${pauseRows || '<tr><td colspan=5 style="padding:8px;color:#999">No pauses logged.</td></tr>'}</tbody></table>

  <h2 style="font-size:14px;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:24px 0 8px 0">Inbound — last 100 decisions</h2>
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:13px;color:#666">${s.totals.forwarded_inbound} forwarded · ${s.totals.queued_inbound} queued</div>

  <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;color:#999;font-size:11px">DialerOS · iter 131 · automated report — do not reply</div>
</body></html>`;
}
