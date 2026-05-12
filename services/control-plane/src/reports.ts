import {
  agentLeaderboardToday,
  floorDispositionMixToday,
  floorThroughputSnapshot,
  listRecentInboundDecisions,
  topCampaignsToday,
  type AgentLeaderboardRow,
  type CampaignDispositionRow,
  type FloorThroughputSnapshot,
  type InboundDecisionRow,
} from './db';
import { pauseReasonAnalytics, type PauseReasonRow } from './db';

// Iter 131 — daily summary roll-up. Aggregates the read-only
// snapshots already used by the dashboard + reports surfaces into
// one structured payload suitable for either email or a JSON
// downstream consumer (Slack/Teams webhook, BI ingestion, etc.).
//
// All component helpers are "since UTC midnight" — there's no
// arbitrary date-range option in v1. The use case is "what
// happened on the floor today" delivered around 06:00 local.
// Multi-day rollups land in a follow-up iter if there's demand.

export interface DailySummary {
  generated_at: string;
  /** UTC midnight floor today is bucketed against. The component
   * helpers compute this internally; we surface it here so the
   * recipient knows the report's window without parsing
   * generated_at. */
  since: string;
  floor: FloorThroughputSnapshot;
  campaigns_today: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    today: number;
    last_1m: number;
  }>;
  leaderboard: AgentLeaderboardRow[];
  dispositions: CampaignDispositionRow[];
  pause_reasons: PauseReasonRow[];
  recent_inbound: InboundDecisionRow[];
  totals: {
    talk_time_ms: number;
    dispositions: number;
    forwarded_inbound: number;
    queued_inbound: number;
  };
}

export function buildDailySummary(): DailySummary {
  const floor = floorThroughputSnapshot();
  const campaignsToday = topCampaignsToday(20);
  const leaderboard = agentLeaderboardToday();
  const dispositions = floorDispositionMixToday();
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const sinceIso = dayStart.toISOString();
  const pauseReasons = pauseReasonAnalytics(sinceIso);
  // Cap inbound history at 100 — daily reports for very-busy
  // queues get unwieldy otherwise and the per-row detail is more
  // a daily audit aid than a metric.
  const recentInbound = listRecentInboundDecisions(100);

  // Roll up totals from the per-agent and per-dispo data we
  // already pulled — cheaper than another aggregate query and
  // keeps the values consistent with the per-row tables in the
  // same report.
  const talkTime = leaderboard.reduce(
    (s, a) => s + a.talk_time_ms_today,
    0,
  );
  const dispoCount = leaderboard.reduce(
    (s, a) => s + a.dispositions_today,
    0,
  );
  const forwarded = recentInbound.filter(
    (r) => r.action === 'inbound.forwarded',
  ).length;
  const queued = recentInbound.filter(
    (r) => r.action === 'inbound.queued',
  ).length;

  return {
    generated_at: new Date().toISOString(),
    since: sinceIso,
    floor,
    campaigns_today: campaignsToday,
    leaderboard,
    dispositions,
    pause_reasons: pauseReasons,
    recent_inbound: recentInbound,
    totals: {
      talk_time_ms: talkTime,
      dispositions: dispoCount,
      forwarded_inbound: forwarded,
      queued_inbound: queued,
    },
  };
}
