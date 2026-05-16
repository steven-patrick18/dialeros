// Iter 198 — Persona A/B testing. Pure split-decision + result
// aggregation. The pacer calls pickAbPersona per AI-routed call;
// /reports/ai-calls calls summarizeAbResults to compare variants.

/** Choose persona A or B for one call. Deterministic given rng
 * (0..1). Degenerate inputs collapse to A so a misconfigured
 * experiment never breaks dialing:
 *   no B, or abPct<=0      → always A (experiment off)
 *   abPct>=100             → always B
 *   else rng < abPct/100   → B, otherwise A
 */
export function pickAbPersona(
  idA: string,
  idB: string | null | undefined,
  abPct: number,
  rng01: number,
): string {
  if (!idB || !Number.isFinite(abPct) || abPct <= 0) return idA;
  if (abPct >= 100) return idB;
  const r =
    Number.isFinite(rng01) && rng01 >= 0 && rng01 < 1 ? rng01 : 0;
  return r < abPct / 100 ? idB : idA;
}

export interface AbSessionRow {
  persona_id: string;
  status: string;
  turn_count: number;
  qa_score: number | null;
}

export interface AbVariantStat {
  persona_id: string;
  count: number;
  completed: number;
  escalated: number;
  seized: number;
  completed_pct: number; // of count
  escalated_pct: number;
  avg_turns: number;
  avg_qa: number | null; // over graded sessions only
  graded: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Group sessions by persona_id into comparable variant stats.
 * Sorted by count desc so the dominant variant leads. */
export function summarizeAbResults(
  rows: AbSessionRow[],
): AbVariantStat[] {
  const acc = new Map<
    string,
    {
      count: number;
      completed: number;
      escalated: number;
      seized: number;
      turns: number;
      qaSum: number;
      graded: number;
    }
  >();
  for (const r of rows) {
    if (!r || typeof r.persona_id !== 'string' || !r.persona_id) continue;
    let a = acc.get(r.persona_id);
    if (!a) {
      a = {
        count: 0,
        completed: 0,
        escalated: 0,
        seized: 0,
        turns: 0,
        qaSum: 0,
        graded: 0,
      };
      acc.set(r.persona_id, a);
    }
    a.count += 1;
    if (r.status === 'completed') a.completed += 1;
    else if (r.status === 'escalated') a.escalated += 1;
    else if (r.status === 'seized') a.seized += 1;
    a.turns += Number.isFinite(r.turn_count) ? r.turn_count : 0;
    if (typeof r.qa_score === 'number' && Number.isFinite(r.qa_score)) {
      a.qaSum += r.qa_score;
      a.graded += 1;
    }
  }
  return [...acc.entries()]
    .map(([persona_id, a]) => ({
      persona_id,
      count: a.count,
      completed: a.completed,
      escalated: a.escalated,
      seized: a.seized,
      completed_pct: a.count ? round1((a.completed / a.count) * 100) : 0,
      escalated_pct: a.count ? round1((a.escalated / a.count) * 100) : 0,
      avg_turns: a.count ? round1(a.turns / a.count) : 0,
      avg_qa: a.graded ? round1(a.qaSum / a.graded) : null,
      graded: a.graded,
    }))
    .sort((x, y) => y.count - x.count);
}
