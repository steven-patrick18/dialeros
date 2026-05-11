import net from 'node:net';
import {
  applyDialIntentAnswered,
  applyDialIntentHangup,
  getLeadIdForCorrelation,
  setLeadStatusIfIn,
} from './db';
import {
  IN_FLIGHT_STATUSES,
  leadStatusFromHangup,
} from './call-outcome';
import { emitIntentUpdate } from './pacing';

/**
 * Iter 33 — long-running ESL listener that subscribes to FreeSWITCH
 * channel events and writes outcomes back onto matching dial_intent
 * rows.
 *
 * Strategy:
 *   - Subscribe to CHANNEL_ANSWER + CHANNEL_HANGUP_COMPLETE in plain
 *     text mode (URL-encoded headers, easier to parse than JSON or XML
 *     and a smaller dependency surface than mod_event_socket's
 *     event_json).
 *   - Extract `variable_dialeros_correlation_id` from the body.
 *     pacer-originated calls carry it; nothing else does, so events
 *     for hand-installed gateways or test calls are silently ignored.
 *   - On ANSWER: stamp answered_at on the row.
 *   - On HANGUP_COMPLETE: stamp hangup_cause + hangup_at + duration_ms
 *     (and answered_at if missed earlier). The matching row gets
 *     updated atomically.
 *
 * Reconnect:
 *   - Backoff starts at 1s, doubles to 60s cap.
 *   - "FS not running" failure (ECONNREFUSED) is the most common case
 *     pre-install — we log lazily (not on every retry) to keep the
 *     journal quiet.
 */

const ESL_HOST = '127.0.0.1';
const ESL_PORT = 8021;
const ESL_PASSWORD = 'ClueCon';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 60000;

interface ListenerState {
  socket: net.Socket | null;
  reconnectMs: number;
  reconnectTimer: NodeJS.Timeout | null;
  // Phases mirror what we expect from FS: first an auth/request, then
  // an OK after sending `auth`, then nothing until events arrive.
  phase: 'wait-auth' | 'auth-pending' | 'subscribing' | 'streaming';
  buffer: string;
  pendingBodyLen: number;
  pendingHeaders: Record<string, string> | null;
  // Suppress ECONNREFUSED log spam — only log first occurrence and on
  // every transition from "was-up" to "down".
  loggedConnectFailure: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __dialeros_fs_events: ListenerState | undefined;
}

function state(): ListenerState {
  if (!globalThis.__dialeros_fs_events) {
    globalThis.__dialeros_fs_events = {
      socket: null,
      reconnectMs: RECONNECT_BASE_MS,
      reconnectTimer: null,
      phase: 'wait-auth',
      buffer: '',
      pendingBodyLen: 0,
      pendingHeaders: null,
      loggedConnectFailure: false,
    };
  }
  return globalThis.__dialeros_fs_events!;
}

export function ensureFsEventListener(): void {
  const s = state();
  if (s.socket && !s.socket.destroyed) return;
  if (s.reconnectTimer) return; // a reconnect is already scheduled
  connect();
}

function scheduleReconnect(): void {
  const s = state();
  if (s.reconnectTimer) return;
  const delay = Math.min(s.reconnectMs, RECONNECT_CAP_MS);
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    s.reconnectMs = Math.min(s.reconnectMs * 2, RECONNECT_CAP_MS);
    connect();
  }, delay);
  s.reconnectTimer.unref?.();
}

function connect(): void {
  const s = state();
  s.buffer = '';
  s.phase = 'wait-auth';
  s.pendingBodyLen = 0;
  s.pendingHeaders = null;

  const socket = net.createConnection({ host: ESL_HOST, port: ESL_PORT });
  socket.setEncoding('utf8');
  s.socket = socket;

  socket.on('connect', () => {
    if (s.loggedConnectFailure) {
      console.log('[fs-events] connected to FreeSWITCH ESL');
    }
    s.loggedConnectFailure = false;
    s.reconnectMs = RECONNECT_BASE_MS;
  });

  socket.on('error', (e) => {
    const code = (e as { code?: string }).code;
    if (code === 'ECONNREFUSED') {
      // FS not running — usual pre-install. Log only the first time.
      if (!s.loggedConnectFailure) {
        console.log(
          '[fs-events] FreeSWITCH not reachable yet; will retry quietly',
        );
        s.loggedConnectFailure = true;
      }
    } else {
      console.error('[fs-events] socket error:', e);
    }
    teardown();
    scheduleReconnect();
  });

  socket.on('close', () => {
    teardown();
    scheduleReconnect();
  });

  socket.on('data', (chunk: string) => handleData(chunk));
}

function teardown(): void {
  const s = state();
  if (s.socket && !s.socket.destroyed) {
    try {
      s.socket.destroy();
    } catch {
      /* ignore */
    }
  }
  s.socket = null;
  s.phase = 'wait-auth';
  s.buffer = '';
  s.pendingBodyLen = 0;
  s.pendingHeaders = null;
}

function handleData(chunk: string): void {
  const s = state();
  s.buffer += chunk;

  while (true) {
    // If we know we're inside an event body, drain that first.
    if (s.pendingBodyLen > 0 && s.pendingHeaders) {
      if (s.buffer.length < s.pendingBodyLen) return;
      const body = s.buffer.slice(0, s.pendingBodyLen);
      s.buffer = s.buffer.slice(s.pendingBodyLen);
      const headers = s.pendingHeaders;
      s.pendingBodyLen = 0;
      s.pendingHeaders = null;
      handleEventBody(body, headers);
      continue;
    }

    const sep = s.buffer.indexOf('\n\n');
    if (sep === -1) return;
    const headerBlock = s.buffer.slice(0, sep);
    s.buffer = s.buffer.slice(sep + 2);
    const headers = parseHeaders(headerBlock);

    if (s.phase === 'wait-auth') {
      if (headers['content-type'] === 'auth/request') {
        s.phase = 'auth-pending';
        s.socket?.write(`auth ${ESL_PASSWORD}\n\n`);
      }
      continue;
    }
    if (s.phase === 'auth-pending') {
      if (
        headers['content-type'] === 'command/reply' &&
        headers['reply-text']?.startsWith('+OK')
      ) {
        s.phase = 'subscribing';
        s.socket?.write(
          'event plain CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE\n\n',
        );
      } else {
        console.error('[fs-events] auth failed:', headers['reply-text']);
        teardown();
        scheduleReconnect();
        return;
      }
      continue;
    }
    if (s.phase === 'subscribing') {
      if (
        headers['content-type'] === 'command/reply' &&
        headers['reply-text']?.startsWith('+OK')
      ) {
        s.phase = 'streaming';
        console.log('[fs-events] subscribed; streaming events');
      } else {
        console.error(
          '[fs-events] subscribe failed:',
          headers['reply-text'],
        );
        teardown();
        scheduleReconnect();
        return;
      }
      continue;
    }
    if (s.phase === 'streaming') {
      // Streaming events: each is "Content-Type: text/event-plain\n
      // Content-Length: N\n\n<body>". The body is URL-encoded headers.
      if (headers['content-type'] === 'text/event-plain') {
        const len = Number(headers['content-length'] ?? '0');
        if (len > 0) {
          s.pendingBodyLen = len;
          s.pendingHeaders = headers;
        }
        continue;
      }
      // Other server-pushed messages (heartbeats, command/reply for
      // commands we never sent post-subscribe) — ignore.
      continue;
    }
  }
}

function handleEventBody(
  body: string,
  _envelope: Record<string, string>,
): void {
  const ev = parseEventBody(body);
  const correlationId = ev['variable_dialeros_correlation_id'];
  if (!correlationId) return; // not one of ours — ignore

  const eventName = ev['event-name'];
  if (eventName === 'CHANNEL_ANSWER') {
    const answeredAt = epochToIso(ev['caller-channel-answered-time']);
    if (!answeredAt) return;
    try {
      const updated = applyDialIntentAnswered({
        correlation_id: correlationId,
        answered_at: answeredAt,
      });
      // Iter 78 — push the new state out to the SSE bus so the
      // live campaign panel transitions from DIALING → CONNECTED
      // immediately instead of waiting for the hangup.
      if (updated) emitIntentUpdate(updated);
    } catch (e) {
      console.error('[fs-events] applyDialIntentAnswered failed:', e);
    }
    return;
  }

  if (eventName === 'CHANNEL_HANGUP_COMPLETE') {
    const cause = ev['hangup-cause'] ?? 'UNKNOWN';
    const hangupAt =
      epochToIso(ev['caller-channel-hangup-time']) ??
      epochToIso(ev['event-date-timestamp']) ??
      new Date().toISOString();

    // FS reports billsec / progresssec / etc. in `variable_billmsec`,
    // `variable_billsec`. We want the actual call duration (answered
    // → hangup) in ms when the call connected, else 0.
    let durationMs = 0;
    const billmsec = Number(ev['variable_billmsec'] ?? '0');
    if (Number.isFinite(billmsec) && billmsec > 0) {
      durationMs = Math.round(billmsec);
    } else {
      const billsec = Number(ev['variable_billsec'] ?? '0');
      if (Number.isFinite(billsec) && billsec > 0) {
        durationMs = billsec * 1000;
      }
    }

    let answeredAt: string | undefined = undefined;
    const answered = epochToIso(ev['caller-channel-answered-time']);
    if (answered) answeredAt = answered;

    try {
      const updated = applyDialIntentHangup({
        correlation_id: correlationId,
        hangup_cause: cause,
        hangup_at: hangupAt,
        duration_ms: durationMs,
        answered_at: answeredAt,
      });
      // Iter 78 — push the terminal state out to the SSE bus so the
      // live campaign panel transitions the row to its final label
      // (NO_ANSWER / BUSY / NORMAL_CLEARING / …) instead of being
      // stuck at DIALING.
      if (updated) emitIntentUpdate(updated);
    } catch (e) {
      console.error('[fs-events] applyDialIntentHangup failed:', e);
    }

    // Iter 34 — also update the lead's status from the carrier
    // outcome, but ONLY if the lead is still in flight (DIALING).
    // If an agent dispositioned the call before hangup (status moved
    // to CONVERTED / DNC / CALLBACK_SCHEDULED / etc.), that wins —
    // we don't trample it.
    try {
      const newLeadStatus = leadStatusFromHangup({
        hangupCause: cause,
        answeredAt: answeredAt ?? null,
      });
      if (newLeadStatus) {
        const row = getLeadIdForCorrelation(correlationId);
        if (row) {
          setLeadStatusIfIn(
            row.lead_id,
            newLeadStatus,
            [...IN_FLIGHT_STATUSES],
          );
        }
      }
    } catch (e) {
      console.error('[fs-events] lead status update failed:', e);
    }
  }
}

function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

/**
 * Event bodies use the same name: value\n format as headers, but with
 * URL-encoded values (so colons / newlines in real values don't confuse
 * the parser). Keys are lowercased for stable lookup.
 */
function parseEventBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      out[k] = v;
    }
  }
  return out;
}

/**
 * FreeSWITCH timestamps come in microseconds since epoch as a string.
 * Convert to ISO-8601, or undefined if the value is "0" / missing /
 * unparseable.
 */
function epochToIso(microseconds: string | undefined): string | undefined {
  if (!microseconds) return undefined;
  const us = Number(microseconds);
  if (!Number.isFinite(us) || us <= 0) return undefined;
  return new Date(us / 1000).toISOString();
}
