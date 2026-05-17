import { describe, expect, it } from 'vitest';
import {
  PACK_SCHEMA_VERSION,
  contentHash,
  dedupeKey,
  validatePackItem,
  buildMemoryPack,
  serializeMemoryPack,
  parseMemoryPack,
  embedModelMatches,
  remapScope,
} from '../src/ai-pack';

const ROW = {
  scope_type: 'global',
  scope_id: '',
  kind: 'knowledge',
  title: 'Refunds',
  content: '30 day window.',
  embedding: JSON.stringify([0.1, 0.2, 0.3]),
  embed_model: 'all-minilm',
  enabled: 1,
  source: 'operator',
};

describe('contentHash', () => {
  it('deterministic, 8-hex', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{8}$/);
  });
  it('differs on different input', () => {
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
  it('empty string is stable', () => {
    expect(contentHash('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('dedupeKey', () => {
  it('whitespace + case insensitive', () => {
    expect(
      dedupeKey({
        kind: 'knowledge',
        scope_type: 'global',
        scope_id: '',
        content: 'Hello   World',
      }),
    ).toBe(
      dedupeKey({
        kind: 'knowledge',
        scope_type: 'global',
        scope_id: '',
        content: ' hello world ',
      }),
    );
  });
  it('scope / kind qualify the key', () => {
    const base = {
      kind: 'knowledge',
      scope_type: 'global',
      scope_id: '',
      content: 'x',
    };
    expect(dedupeKey(base)).not.toBe(
      dedupeKey({ ...base, kind: 'transfer_rule' }),
    );
    expect(dedupeKey(base)).not.toBe(
      dedupeKey({ ...base, scope_type: 'campaign', scope_id: 'c1' }),
    );
  });
});

describe('validatePackItem', () => {
  it('rejects non-object / missing title|content', () => {
    expect(validatePackItem(null)).toBeNull();
    expect(validatePackItem({ title: 'x' })).toBeNull();
    expect(
      validatePackItem({ title: '  ', content: 'y' }),
    ).toBeNull();
  });
  it('coerces unknown scope -> global', () => {
    const v = validatePackItem({
      title: 't',
      content: 'c',
      scope_type: 'weird',
      scope_id: 'z',
    });
    expect(v?.scope_type).toBe('global');
    expect(v?.scope_id).toBe('');
  });
  it('bad embedding -> null; enabled false -> 0', () => {
    const v = validatePackItem({
      title: 't',
      content: 'c',
      embedding: [1, 'x', 3],
      enabled: false,
    });
    expect(v?.embedding).toBeNull();
    expect(v?.enabled).toBe(0);
  });
  it('keeps a finite-number embedding', () => {
    const v = validatePackItem({
      title: 't',
      content: 'c',
      embedding: [0.1, 0.2],
    });
    expect(v?.embedding).toEqual([0.1, 0.2]);
  });
});

describe('buildMemoryPack', () => {
  it('parses embedding string + sets meta', () => {
    const p = buildMemoryPack([ROW], {
      embedModel: 'all-minilm',
      source: 'hostA',
      now: '2026-01-01T00:00:00Z',
    });
    expect(p.schema_version).toBe(PACK_SCHEMA_VERSION);
    expect(p.embed_model).toBe('all-minilm');
    expect(p.item_count).toBe(1);
    expect(p.items[0]?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(p.created_at).toBe('2026-01-01T00:00:00Z');
  });
  it('bad embedding string -> null embedding (no throw)', () => {
    const p = buildMemoryPack(
      [{ ...ROW, embedding: 'not json' }],
      { embedModel: 'all-minilm', source: 's' },
    );
    expect(p.items[0]?.embedding).toBeNull();
  });
});

describe('serialize <-> parse round-trip', () => {
  it('survives a full cycle', () => {
    const p = buildMemoryPack([ROW], {
      embedModel: 'all-minilm',
      source: 's',
      now: '2026-01-01T00:00:00Z',
    });
    const back = parseMemoryPack(serializeMemoryPack(p));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.pack.items).toEqual(p.items);
      expect(back.pack.embed_model).toBe('all-minilm');
    }
  });
});

describe('parseMemoryPack — defensive', () => {
  it('invalid JSON', () => {
    expect(parseMemoryPack('{nope')).toEqual({
      ok: false,
      error: 'not valid JSON',
    });
  });
  it('not an object', () => {
    expect(parseMemoryPack('42').ok).toBe(false);
  });
  it('wrong schema_version', () => {
    const r = parseMemoryPack(
      JSON.stringify({ schema_version: 99, embed_model: 'm', items: [] }),
    );
    expect(r.ok).toBe(false);
  });
  it('missing embed_model / items', () => {
    expect(
      parseMemoryPack(
        JSON.stringify({ schema_version: 1, items: [] }),
      ).ok,
    ).toBe(false);
    expect(
      parseMemoryPack(
        JSON.stringify({ schema_version: 1, embed_model: 'm' }),
      ).ok,
    ).toBe(false);
  });
  it('filters bad items, keeps good ones', () => {
    const r = parseMemoryPack(
      JSON.stringify({
        schema_version: 1,
        embed_model: 'm',
        items: [
          { title: '', content: 'x' },
          { title: 'ok', content: 'good' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pack.item_count).toBe(1);
  });
});

describe('embedModelMatches', () => {
  it('exact match only', () => {
    expect(embedModelMatches({ embed_model: 'all-minilm' }, 'all-minilm')).toBe(
      true,
    );
    expect(embedModelMatches({ embed_model: 'other' }, 'all-minilm')).toBe(
      false,
    );
  });
});

describe('remapScope', () => {
  const item = validatePackItem({
    title: 't',
    content: 'c',
    scope_type: 'campaign',
    scope_id: 'OLD',
  })!;
  it('no map -> passthrough', () => {
    expect(remapScope(item, null)).toEqual(item);
  });
  it('explicit key remap', () => {
    const r = remapScope(item, { 'campaign:OLD': 'campaign:NEW' });
    expect(r.scope_type).toBe('campaign');
    expect(r.scope_id).toBe('NEW');
  });
  it('"*" catch-all collapses to global', () => {
    const r = remapScope(item, { '*': 'global' });
    expect(r.scope_type).toBe('global');
    expect(r.scope_id).toBe('');
  });
  it('unknown key, no catch-all -> passthrough', () => {
    expect(remapScope(item, { 'campaign:ZZZ': 'global' })).toEqual(
      item,
    );
  });
  it('target without ":" -> treated as scope_type', () => {
    const r = remapScope(item, { '*': 'global' });
    expect(r.scope_type).toBe('global');
  });
});
