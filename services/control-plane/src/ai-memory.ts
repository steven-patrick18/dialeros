// Iter 202 — Master AI RAG memory. Local-only: embeddings via
// Ollama (all-minilm, 384-dim, on this box), vectors stored in
// sqlite, brute-force cosine search in-process (corpus is small;
// no external vector DB — fully local per the project rule).
//
// The pure halves (cosine, ranking, chunking) are exhaustively
// tested — retrieval quality + a divide-by-zero on a zero vector
// are the failure modes that matter. embed() is the only I/O and
// degrades gracefully when the model isn't pulled.

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const EMBED_MODEL = process.env.AI_EMBED_MODEL ?? 'all-minilm';
export const EMBED_DIM = 384;

/** Cosine similarity. Returns 0 for empty / mismatched-length /
 * zero-magnitude vectors (never NaN — a NaN would poison the
 * ranking sort). Range for valid inputs: [-1, 1]. */
export function cosineSim(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RankCandidate<T> {
  item: T;
  vector: number[];
}
export interface RankHit<T> {
  item: T;
  score: number;
}

/** Top-K by cosine, descending. minScore filters weak matches
 * (default 0 = keep all). Stable: equal scores keep input order. */
export function rankBySimilarity<T>(
  query: number[],
  candidates: RankCandidate<T>[],
  k: number,
  minScore = 0,
): RankHit<T>[] {
  const scored = candidates.map((c, idx) => ({
    item: c.item,
    score: cosineSim(query, c.vector),
    idx,
  }));
  scored.sort((p, q) => (q.score - p.score) || (p.idx - q.idx));
  const lim = Number.isInteger(k) && k > 0 ? k : 0;
  return scored
    .filter((s) => s.score >= minScore)
    .slice(0, lim)
    .map((s) => ({ item: s.item, score: s.score }));
}

/** Split a knowledge doc into embeddable chunks on paragraph /
 * sentence boundaries, each <= maxChars. Pure + deterministic.
 * Whitespace-only / empty → []. Never emits an empty chunk. */
export function chunkText(text: string, maxChars = 800): string[] {
  if (typeof text !== 'string') return [];
  const norm = text.replace(/\r\n/g, '\n').trim();
  if (!norm) return [];
  const max = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : 800;
  // Prefer paragraph breaks, then sentence ends, then hard cut.
  const paras = norm.split(/\n{2,}/);
  const out: string[] = [];
  for (const para of paras) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= max) {
      out.push(p);
      continue;
    }
    const sentences = p.split(/(?<=[.!?])\s+/);
    let buf = '';
    for (const s of sentences) {
      if (s.length > max) {
        if (buf) {
          out.push(buf);
          buf = '';
        }
        for (let i = 0; i < s.length; i += max) {
          out.push(s.slice(i, i + max));
        }
        continue;
      }
      if ((buf + ' ' + s).trim().length > max) {
        if (buf) out.push(buf);
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf) out.push(buf);
  }
  return out.filter((c) => c.trim().length > 0);
}

export type EmbedResult =
  | { ok: true; vector: number[] }
  | { ok: false; detail: string };

export async function embed(text: string): Promise<EmbedResult> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text,
        // Iter 214 — keep all-minilm resident; on a RAM-tight
        // box it gets evicted between turns and a cold reload
        // adds seconds of pure latency to every retrieval.
        keep_alive: '30m',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ok: false, detail: `ollama embeddings HTTP ${res.status}` };
    }
    const j = (await res.json()) as { embedding?: number[] };
    const v = j.embedding;
    if (!Array.isArray(v) || v.length === 0) {
      return { ok: false, detail: 'empty embedding' };
    }
    return { ok: true, vector: v };
  } catch (e) {
    return {
      ok: false,
      detail:
        e instanceof Error
          ? `${e.message} — is the ${EMBED_MODEL} model pulled? (ollama pull ${EMBED_MODEL})`
          : 'embed failed',
    };
  }
}
