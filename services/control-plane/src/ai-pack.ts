// Iter 206 — portable / stackable brain. A Master's learned
// memory (knowledge + call_exemplar + transfer_rule) serializes
// to a versioned, self-describing JSON "pack" that another
// DialerOS cluster can import + STACK — fully local, no re-
// embed, deterministic. Vectors are only meaningful within ONE
// embedding model, so the pack is stamped with embed_model and
// import refuses a mismatch (cross-model re-embed is a separate
// concern, deliberately deferred).
//
// Pure half only (build / serialize / parse / validate / dedupe
// / scope-remap). I/O (list rows, insert) stays in db.ts + the
// route. parse* NEVER throws — it ingests a foreign file.

export const PACK_SCHEMA_VERSION = 1;

export interface PackItem {
  scope_type: string;
  scope_id: string;
  kind: string;
  title: string;
  content: string;
  embedding: number[] | null;
  embed_model: string | null;
  enabled: number;
  source: string;
}

export interface MemoryPack {
  schema_version: number;
  embed_model: string;
  created_at: string;
  source: string;
  item_count: number;
  items: PackItem[];
}

export type ParseResult =
  | { ok: true; pack: MemoryPack }
  | { ok: false; error: string };

/** Stable 32-bit FNV-1a over a string. Pure, dependency-free
 * (no crypto import → webpack-clean). Used only for dedupe keys
 * — collision risk is negligible for this corpus and the key is
 * further qualified by kind + scope. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Idempotent stacking key: same kind+scope+content => same
 * memory => skip on re-import. Whitespace/case-normalized so
 * trivial reformatting doesn't defeat dedupe. */
export function dedupeKey(item: {
  kind: string;
  scope_type: string;
  scope_id: string;
  content: string;
}): string {
  const norm = String(item.content ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${item.kind}|${item.scope_type}|${item.scope_id}|${contentHash(
    norm,
  )}`;
}

function isFiniteNumberArray(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** Coerce one untrusted object into a PackItem, or null if it
 * is unusable. A bad embedding becomes null (the row still
 * imports, just un-retrievable until re-embedded). */
export function validatePackItem(x: unknown): PackItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title : '';
  const content = typeof o.content === 'string' ? o.content : '';
  if (!title.trim() || !content.trim()) return null;
  const scope_type =
    o.scope_type === 'campaign' || o.scope_type === 'in_group'
      ? o.scope_type
      : 'global';
  const scope_id =
    scope_type === 'global'
      ? ''
      : typeof o.scope_id === 'string'
        ? o.scope_id
        : '';
  return {
    scope_type,
    scope_id,
    kind: typeof o.kind === 'string' && o.kind ? o.kind : 'knowledge',
    title,
    content,
    embedding: isFiniteNumberArray(o.embedding) ? o.embedding : null,
    embed_model:
      typeof o.embed_model === 'string' ? o.embed_model : null,
    enabled: o.enabled === 0 || o.enabled === false ? 0 : 1,
    source: typeof o.source === 'string' ? o.source : 'pack',
  };
}

/** Build a pack from db rows (AiMemoryRow-shaped: embedding is
 * the stored JSON string or null). Bad/unparseable embeddings
 * degrade to null, never throw. */
export function buildMemoryPack(
  rows: Array<{
    scope_type: string;
    scope_id: string;
    kind: string;
    title: string;
    content: string;
    embedding: string | null;
    embed_model: string | null;
    enabled: number;
    source: string;
  }>,
  meta: { embedModel: string; source: string; now?: string },
): MemoryPack {
  const items: PackItem[] = [];
  for (const r of rows) {
    let emb: number[] | null = null;
    if (r.embedding) {
      try {
        const v = JSON.parse(r.embedding);
        if (isFiniteNumberArray(v)) emb = v;
      } catch {
        emb = null;
      }
    }
    items.push({
      scope_type: r.scope_type,
      scope_id: r.scope_id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      embedding: emb,
      embed_model: r.embed_model,
      enabled: r.enabled ? 1 : 0,
      source: r.source,
    });
  }
  return {
    schema_version: PACK_SCHEMA_VERSION,
    embed_model: meta.embedModel,
    created_at: meta.now ?? new Date().toISOString(),
    source: meta.source,
    item_count: items.length,
    items,
  };
}

export function serializeMemoryPack(pack: MemoryPack): string {
  return JSON.stringify(pack, null, 2);
}

/** Parse + validate an untrusted pack file. NEVER throws. */
export function parseMemoryPack(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'pack is not an object' };
  }
  const o = raw as Record<string, unknown>;
  if (Number(o.schema_version) !== PACK_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `unsupported schema_version (need ${PACK_SCHEMA_VERSION})`,
    };
  }
  if (typeof o.embed_model !== 'string' || !o.embed_model) {
    return { ok: false, error: 'missing embed_model' };
  }
  if (!Array.isArray(o.items)) {
    return { ok: false, error: 'missing items[]' };
  }
  const items: PackItem[] = [];
  for (const it of o.items) {
    const v = validatePackItem(it);
    if (v) items.push(v);
  }
  return {
    ok: true,
    pack: {
      schema_version: PACK_SCHEMA_VERSION,
      embed_model: o.embed_model,
      created_at:
        typeof o.created_at === 'string' ? o.created_at : '',
      source: typeof o.source === 'string' ? o.source : 'unknown',
      item_count: items.length,
      items,
    },
  };
}

/** Vectors are only comparable within ONE embedding model.
 * Import refuses a mismatch (re-embed-on-import is deferred). */
export function embedModelMatches(
  pack: { embed_model: string },
  localModel: string,
): boolean {
  return (
    typeof pack.embed_model === 'string' &&
    pack.embed_model === localModel
  );
}

/** Optional import-time scope remap. `map` keys are
 * "<scope_type>:<scope_id>" (or "*" catch-all); value is the
 * replacement "<scope_type>:<scope_id>". Lets an operator fold
 * a foreign cluster's campaign-scoped brain onto a local
 * campaign — or collapse everything to global. Pure. */
export function remapScope(
  item: PackItem,
  map: Record<string, string> | null | undefined,
): PackItem {
  if (!map) return item;
  const key = `${item.scope_type}:${item.scope_id}`;
  const target = map[key] ?? map['*'];
  if (!target || typeof target !== 'string') return item;
  const ci = target.indexOf(':');
  const st = ci >= 0 ? target.slice(0, ci) : target;
  const si = ci >= 0 ? target.slice(ci + 1) : '';
  const scope_type =
    st === 'campaign' || st === 'in_group' ? st : 'global';
  return {
    ...item,
    scope_type,
    scope_id: scope_type === 'global' ? '' : si,
  };
}
