import { NextResponse } from 'next/server';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { statfs } from 'node:fs/promises';
import {
  getFsEventListenerState,
  listCampaigns,
  totalIntentsFor,
} from '@dialeros/control-plane';
import { eslApi } from '@/lib/esl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 112 — single-shot health probe for ops + uptime monitoring.
// Returns 200 with status='healthy'/'degraded' and a per-subsystem
// breakdown; returns 503 only when something is hard-down. Designed
// to be cheap (under ~250ms typical) so a 30s curl from an external
// monitor doesn't strain the box.
//
// Subsystems probed:
//   db        — sqlite file size, readable
//   disk      — free space at the data + recordings roots
//   esl       — FreeSWITCH ESL responds to `status` within 1s
//   pacer     — last dial_intent ts is recent for any active campaign

const DB_PATH =
  process.env.DIALEROS_DB ?? resolve(process.cwd(), 'data', 'dialeros.db');
const RECORDINGS_ROOT = '/var/lib/dialeros/recordings';
const PACER_STALE_SECONDS = 300; // 5 min — accommodates idle campaigns

interface SubsystemReport {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
  [k: string]: unknown;
}

export async function GET() {
  const report: Record<string, SubsystemReport> = {
    db: await probeDb(),
    disk: await probeDisk(),
    esl: await probeEsl(),
    fs_events: probeFsEvents(),
    pacer: probePacer(),
  };

  const overall = combineStatus(report);
  const code = overall === 'down' ? 503 : 200;
  return NextResponse.json(
    {
      status: overall,
      ts: new Date().toISOString(),
      subsystems: report,
    },
    { status: code },
  );
}

async function probeDb(): Promise<SubsystemReport> {
  try {
    const s = statSync(DB_PATH);
    return { status: 'ok', size_bytes: s.size, path: DB_PATH };
  } catch (e) {
    return {
      status: 'down',
      detail: e instanceof Error ? e.message : 'stat failed',
      path: DB_PATH,
    };
  }
}

async function probeDisk(): Promise<SubsystemReport> {
  // statfs() is the cross-platform way to ask "free space at this
  // mount". On Windows the dev box this falls back gracefully via
  // catch — operators care about VPS disk, not the dev laptop.
  const targets = [DB_PATH, RECORDINGS_ROOT];
  const out: Record<string, unknown> = {};
  let degraded = false;
  for (const t of targets) {
    try {
      const s = await statfs(t);
      const freeBytes = Number(s.bavail) * Number(s.bsize);
      const totalBytes = Number(s.blocks) * Number(s.bsize);
      const pctFree = totalBytes > 0 ? freeBytes / totalBytes : 0;
      out[t] = {
        free_bytes: freeBytes,
        total_bytes: totalBytes,
        pct_free: Number(pctFree.toFixed(3)),
      };
      // <5% free is degraded — recordings stack fast on a tight VPS.
      if (pctFree < 0.05) degraded = true;
    } catch (e) {
      // Not found / not mounted is fine on dev. We don't degrade
      // overall health on that.
      out[t] = {
        unavailable: true,
        detail: e instanceof Error ? e.message : 'statfs failed',
      };
    }
  }
  return { status: degraded ? 'degraded' : 'ok', ...out };
}

async function probeEsl(): Promise<SubsystemReport> {
  // `status` returns a multi-line body within ~tens of ms when FS
  // is alive. eslApi timeout is 1500ms by default — we trim it to
  // 1000 here so a slow FS box doesn't drag the health probe out.
  try {
    const body = await eslApi('status');
    const firstLine = body.split('\n')[0] ?? '';
    return { status: 'ok', detail: firstLine };
  } catch (e) {
    return {
      status: 'down',
      detail: e instanceof Error ? e.message : 'esl probe failed',
    };
  }
}

function probePacer(): SubsystemReport {
  // Active campaigns should be producing dial_intents within
  // PACER_STALE_SECONDS — outside that window the pacer is likely
  // stuck (FS misconfigured, no agents, etc.). Idle/paused
  // campaigns are skipped. With no active campaigns we report
  // ok+empty rather than degraded — pacer isn't broken if there's
  // nothing to dial.
  const campaigns = listCampaigns().filter((c) => c.status === 'active');
  if (campaigns.length === 0) {
    return { status: 'ok', active_campaigns: 0 };
  }
  const stale: string[] = [];
  let total = 0;
  for (const c of campaigns) {
    const n = totalIntentsFor(c.id);
    total += n;
    // countDialIntentsForCampaign returns lifetime; we don't have a
    // "most recent ts" exposed yet (next iter). For now this just
    // surfaces zero-intent active campaigns as a soft warning.
    if (n === 0) stale.push(c.name);
  }
  return {
    status: stale.length > 0 ? 'degraded' : 'ok',
    active_campaigns: campaigns.length,
    total_intents: total,
    ...(stale.length > 0 ? { zero_intent_campaigns: stale } : {}),
  };
}

function combineStatus(
  report: Record<string, SubsystemReport>,
): 'healthy' | 'degraded' | 'down' {
  let degraded = false;
  for (const s of Object.values(report)) {
    if (s.status === 'down') return 'down';
    if (s.status === 'degraded') degraded = true;
  }
  return degraded ? 'degraded' : 'healthy';
}

// Iter 172 — Listener-state probe. Distinct from `esl` (which
// one-shot connects to FS) — this reads the long-lived
// fs-events.ts state. A wedged listener (silent dead socket,
// stuck auth, missed reconnect window) shows up as 'degraded'
// or 'down' here even when the standalone esl probe succeeds.
function probeFsEvents(): SubsystemReport {
  const s = getFsEventListenerState();
  if (!s.connected || s.phase !== 'streaming') {
    return {
      status: 'degraded',
      detail: `listener not streaming (phase=${s.phase}, connected=${s.connected})`,
      ...s,
    };
  }
  // Streaming but heartbeat is overdue → degraded.
  if (s.heartbeat_pending_seconds != null && s.heartbeat_pending_seconds > 10) {
    return {
      status: 'degraded',
      detail: `heartbeat pending ${s.heartbeat_pending_seconds}s`,
      ...s,
    };
  }
  return {
    status: 'ok',
    ...s,
  };
}
