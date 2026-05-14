import net from 'net';
import {
  applyDialIntentAnswered,
  getRaceOutcomeByCorrelation,
  recordRaceWinner,
  applyDialIntentHangup,
  applyAutoDisposition,
  getCampaignFromDb,
  getLeadIdForCorrelation,
  insertCallMenuLog,
  setLeadStatusIfIn,
} from './db';
import { appendAudit } from './audit';
import { inferAutoDisposition } from './auto-disposition';
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
// Iter 172 — heartbeat: send `api status core db handle` every 30s
// while streaming. If no reply within 5s, force a reconnect — the
// socket is silently dead.
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;
// Iter 172 — watchdog: if the state machine sits in any non-streaming
// phase for more than 60s, something's stuck. Force a reconnect.
const WATCHDOG_INTERVAL_MS = 10_000;
const PHASE_STALL_MS = 60_000;

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
  // Iter 172 — resilience tracking
  lastEventAt: number;        // ms timestamp of last event from FS
  lastConnectedAt: number;    // ms timestamp of last successful connect
  reconnectCount: number;     // lifetime reconnects
  phaseEnteredAt: number;     // ms timestamp of last phase transition
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeatPendingSince: number; // 0 = no pending; ms when sent otherwise
  watchdogTimer: NodeJS.Timeout | null;
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
      lastEventAt: 0,
      lastConnectedAt: 0,
      reconnectCount: 0,
      phaseEnteredAt: Date.now(),
      heartbeatTimer: null,
      heartbeatPendingSince: 0,
      watchdogTimer: null,
    };
  }
  return globalThis.__dialeros_fs_events!;
}

export function ensureFsEventListener(): void {
  // Iter 172 — watchdog runs continuously regardless of connection
  // state so a wedged 'auth-pending' phase still triggers eventual
  // reconnect.
  startWatchdog();
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
    s.lastConnectedAt = Date.now();
    s.reconnectCount += 1;
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
  s.phaseEnteredAt = Date.now();
  s.buffer = '';
  s.pendingBodyLen = 0;
  s.pendingHeaders = null;
  // Iter 172 — stop heartbeat on teardown; new connection re-starts.
  stopHeartbeat();
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
      s.phaseEnteredAt = Date.now();
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
        s.phaseEnteredAt = Date.now();
        s.socket?.write(
          'event plain CHANNEL_ANSWER CHANNEL_HANGUP_COMPLETE CUSTOM dialeros::menu_press\n\n',
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
        s.phaseEnteredAt = Date.now();
        s.lastEventAt = Date.now();
        startHeartbeat();
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
      // Iter 172 — api/response or command/reply on the streaming
      // channel is our heartbeat coming back. Reset the pending
      // flag + lastEventAt so the watchdog sees liveness.
      if (
        headers['content-type'] === 'api/response' ||
        headers['content-type'] === 'command/reply'
      ) {
        s.heartbeatPendingSince = 0;
        s.lastEventAt = Date.now();
        // api/response carries a Content-Length body; consume it.
        if (headers['content-length']) {
          const len = Number(headers['content-length']);
          if (len > 0 && s.buffer.length >= len) {
            s.buffer = s.buffer.slice(len);
          } else if (len > 0) {
            // Body not all here yet — schedule body drain.
            s.pendingBodyLen = len;
            s.pendingHeaders = headers;
          }
        }
        continue;
      }
      // Other server-pushed messages (event heartbeats, etc.) —
      // ignore.
      continue;
    }
  }
}

function handleEventBody(
  body: string,
  _envelope: Record<string, string>,
): void {
  // Iter 172 — every event resets the freshness clock + clears any
  // pending heartbeat ping (the ping arrives as a command/reply
  // which doesn't go through this path, but if the reply got
  // ahead of normal events we still want to clear it).
  const s = state();
  s.lastEventAt = Date.now();
  s.heartbeatPendingSince = 0;
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

    // Iter 186 — Parallel race-to-answer winner detection.
    // When the correlation_id matches a pending race outcome (set
    // by iter 183's recordRaceStart), identify the winning leg's
    // gateway from event vars + map back to the carrier_id. The
    // gateway naming convention 'dialeros-<carrierId>' is set by
    // the pacer (carrier.id → gateway = `dialeros-${carrier.id}`),
    // so the suffix is the carrier id.
    try {
      const pending = getRaceOutcomeByCorrelation(correlationId);
      if (pending && !pending.winner_carrier_id) {
        // FreeSWITCH sets variable_sip_gateway_name when an
        // outbound leg via sofia/gateway/<name> is created.
        // Fallbacks cover older FS versions + edge cases.
        const gw =
          ev['variable_sip_gateway_name'] ??
          ev['variable_sip_gateway'] ??
          ev['variable_dialed_user'] ??
          '';
        const carrierId = gw.startsWith('dialeros-')
          ? gw.slice('dialeros-'.length)
          : null;
        if (carrierId) {
          // PDD = answered_at - race.started_at (ms). started_at
          // is iso 8601 from the DB; answeredAt is iso 8601 from
          // the FS event.
          const startedMs = Date.parse(pending.started_at);
          const answeredMs = Date.parse(answeredAt);
          const pddMs =
            Number.isFinite(startedMs) && Number.isFinite(answeredMs)
              ? Math.max(0, answeredMs - startedMs)
              : 0;
          const ok = recordRaceWinner(correlationId, carrierId, pddMs);
          if (ok) {
            console.log(
              `[fs-events] race winner: correlation=${correlationId.slice(0, 8)} carrier=${carrierId} pdd=${pddMs}ms`,
            );
            try {
              appendAudit({
                actorUserId: null,
                actorIp: null,
                action: 'pacing.parallel_race_won',
                targetType: 'carrier_race_outcome',
                targetId: String(pending.id),
                payload: {
                  correlation_id: correlationId,
                  winner_carrier_id: carrierId,
                  pdd_ms: pddMs,
                  raced_carriers: (() => {
                    try {
                      return JSON.parse(pending.raced_carriers_json);
                    } catch {
                      return [];
                    }
                  })(),
                },
              });
            } catch (auditErr) {
              console.error(
                '[fs-events] race-won audit append failed:',
                auditErr,
              );
            }
          }
        } else {
          // Gateway didn't match our naming convention — log so
          // the operator can investigate (custom gateway names,
          // FS version with different vars, etc.).
          console.warn(
            `[fs-events] race-pending CHANNEL_ANSWER had no recognizable gateway var (sip_gateway_name=${ev['variable_sip_gateway_name'] ?? '∅'} sip_gateway=${ev['variable_sip_gateway'] ?? '∅'})`,
          );
        }
      }
    } catch (e) {
      // Race-winner detection is best-effort — never let a parse
      // glitch kill the CHANNEL_ANSWER handler.
      console.error('[fs-events] race-winner detection failed:', e);
    }
    return;
  }

  // Iter 153 — DTMF press logging. The call-menu dialplan generator
  // emits Event-Subclass=dialeros::menu_press for every entry, press,
  // timeout, invalid digit, and completion. We persist these into
  // call_menu_log for iter 154 analytics (option pick rate, drop
  // rate during menu, etc.).
  if (
    eventName === 'CUSTOM' &&
    ev['event-subclass'] === 'dialeros::menu_press'
  ) {
    try {
      insertCallMenuLog({
        call_menu_id: ev['dialeros_menu_id'] ?? '',
        dial_intent_id: null,
        call_uuid: ev['unique-id'] ?? null,
        event_type:
          ev['dialeros_menu_event'] ??
          (ev['dialeros_menu_digit'] ? 'pressed' : 'unknown'),
        digit: ev['dialeros_menu_digit'] ?? null,
        action_taken: ev['dialeros_menu_action'] ?? null,
        retry_count: null,
      });
    } catch (e) {
      console.error('[fs-events] menu_press log failed:', e);
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

    // Iter 122 — capture AMD verdict when amd_action=detect ran
    // amd_v2 inline. The dialplan stamps dialeros_amd_result on
    // the channel right after amd_v2 returns; FS surfaces it on
    // every event as variable_dialeros_amd_result. Pass undefined
    // (don't touch the column) when the var isn't present so
    // existing non-AMD campaigns stay NULL.
    const amdResultRaw = ev['variable_dialeros_amd_result'];
    const amdResult =
      amdResultRaw && amdResultRaw.length > 0 ? amdResultRaw : undefined;

    let updated: ReturnType<typeof applyDialIntentHangup> = undefined;
    try {
      updated = applyDialIntentHangup({
        correlation_id: correlationId,
        hangup_cause: cause,
        hangup_at: hangupAt,
        duration_ms: durationMs,
        answered_at: answeredAt,
        amd_result: amdResult,
      });
      // Iter 78 — push the terminal state out to the SSE bus so the
      // live campaign panel transitions the row to its final label
      // (NO_ANSWER / BUSY / NORMAL_CLEARING / …) instead of being
      // stuck at DIALING.
      if (updated) emitIntentUpdate(updated);
    } catch (e) {
      console.error('[fs-events] applyDialIntentHangup failed:', e);
    }

    // Iter 146 — system-set a disposition for the row IF no agent
    // is going to fill one in (machine drops, no-answers, abandons,
    // originate errors). For answered + agent-assigned calls,
    // inferAutoDisposition returns null and we let the wrap-up
    // screen handle it. Errors here don't fail the rest of the
    // hangup path; we still want lead status to update even if
    // the auto-dispo lookup hiccups.
    try {
      if (updated && !updated.disposition) {
        const campaign = getCampaignFromDb(updated.campaign_id);
        const auto = inferAutoDisposition(
          {
            disposition: updated.disposition,
            originate_error: updated.originate_error,
            answered_at: updated.answered_at,
            assigned_user_id: updated.assigned_user_id,
            hangup_cause: updated.hangup_cause,
            amd_result: updated.amd_result,
          },
          campaign
            ? {
                amd_action: campaign.amd_action,
                voicemail_path: campaign.voicemail_path,
              }
            : null,
        );
        if (auto) {
          const dispoUpdated = applyAutoDisposition(correlationId, auto);
          if (dispoUpdated) emitIntentUpdate(dispoUpdated);
        }
      }
    } catch (e) {
      console.error('[fs-events] auto-disposition failed:', e);
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

// Iter 172 — heartbeat: every HEARTBEAT_INTERVAL_MS, send a cheap
// `api status core db handle` ping while streaming. If we don't see
// any event/reply within HEARTBEAT_TIMEOUT_MS, force a reconnect.
function startHeartbeat(): void {
  const s = state();
  if (s.heartbeatTimer) return;
  s.heartbeatTimer = setInterval(() => {
    const s2 = state();
    if (s2.phase !== 'streaming' || !s2.socket || s2.socket.destroyed) {
      return;
    }
    const now = Date.now();
    if (
      s2.heartbeatPendingSince > 0 &&
      now - s2.heartbeatPendingSince > HEARTBEAT_TIMEOUT_MS
    ) {
      console.warn(
        '[fs-events] heartbeat timeout — reconnecting',
      );
      teardown();
      scheduleReconnect();
      return;
    }
    if (s2.heartbeatPendingSince === 0) {
      s2.heartbeatPendingSince = now;
      try {
        s2.socket.write('api status core db handle\n\n');
      } catch {
        teardown();
        scheduleReconnect();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  s.heartbeatTimer.unref?.();
}

function stopHeartbeat(): void {
  const s = state();
  if (s.heartbeatTimer) {
    clearInterval(s.heartbeatTimer);
    s.heartbeatTimer = null;
  }
  s.heartbeatPendingSince = 0;
}

// Iter 172 — watchdog: catches the case where the state machine sits
// in a non-streaming phase forever (e.g. auth hang). Force a
// reconnect after PHASE_STALL_MS.
function startWatchdog(): void {
  const s = state();
  if (s.watchdogTimer) return;
  s.watchdogTimer = setInterval(() => {
    const s2 = state();
    if (s2.phase === 'streaming') return;
    const now = Date.now();
    if (now - s2.phaseEnteredAt > PHASE_STALL_MS) {
      console.warn(
        `[fs-events] watchdog: stalled in phase=${s2.phase} for ` +
          `${Math.round((now - s2.phaseEnteredAt) / 1000)}s — reconnecting`,
      );
      teardown();
      scheduleReconnect();
    }
  }, WATCHDOG_INTERVAL_MS);
  s.watchdogTimer.unref?.();
}

// Iter 172 — Snapshot of listener state for the health probe.
export function getFsEventListenerState(): {
  phase: string;
  connected: boolean;
  last_event_at_iso: string | null;
  last_connected_at_iso: string | null;
  reconnect_count: number;
  seconds_since_last_event: number | null;
  heartbeat_pending_seconds: number | null;
} {
  const s = state();
  const now = Date.now();
  return {
    phase: s.phase,
    connected: Boolean(s.socket && !s.socket.destroyed),
    last_event_at_iso: s.lastEventAt
      ? new Date(s.lastEventAt).toISOString()
      : null,
    last_connected_at_iso: s.lastConnectedAt
      ? new Date(s.lastConnectedAt).toISOString()
      : null,
    reconnect_count: s.reconnectCount,
    seconds_since_last_event: s.lastEventAt
      ? Math.round((now - s.lastEventAt) / 1000)
      : null,
    heartbeat_pending_seconds:
      s.heartbeatPendingSince > 0
        ? Math.round((now - s.heartbeatPendingSince) / 1000)
        : null,
  };
}
