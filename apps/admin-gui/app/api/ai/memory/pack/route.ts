import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendAudit,
  buildMemoryPack,
  dedupeKey,
  embedModelMatches,
  EMBED_MODEL,
  insertAiMemory,
  listAiMemory,
  parseMemoryPack,
  remapScope,
  serializeMemoryPack,
  setAiMemoryEnabled,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 206 — portable / stackable brain. GET = export the
// Master memory as a versioned pack file. POST = import + STACK
// a pack (idempotent: re-importing skips dupes). ai.manage gated.
// Vectors only compare within one embed model, so import refuses
// a mismatch (cross-model re-embed is a separate, deferred job).

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  const st = req.nextUrl.searchParams.get('scope_type') ?? undefined;
  const si = req.nextUrl.searchParams.get('scope_id') ?? '';
  const rows = listAiMemory(st, si);
  const pack = buildMemoryPack(rows, {
    embedModel: EMBED_MODEL,
    source: req.headers.get('host') ?? 'dialeros',
  });
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.memory_pack_exported',
    targetType: 'ai_memory',
    targetId: st ? `${st}:${si}` : 'all',
    payload: { item_count: pack.item_count },
  });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return new NextResponse(serializeMemoryPack(pack), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="dialeros-brain-${ts}.json"`,
    },
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    pack?: unknown;
    scope_remap?: Record<string, string> | null;
    dry_run?: boolean;
  };
  const text =
    typeof body.pack === 'string'
      ? body.pack
      : JSON.stringify(body.pack ?? null);
  const parsed = parseMemoryPack(text);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!embedModelMatches(parsed.pack, EMBED_MODEL)) {
    return NextResponse.json(
      {
        error:
          `embed_model mismatch: pack=${parsed.pack.embed_model} ` +
          `local=${EMBED_MODEL}. Re-embed-on-import is not supported.`,
      },
      { status: 409 },
    );
  }
  // Existing dedupe keys across ALL scopes — idempotent stack.
  const existing = new Set(
    listAiMemory().map((r) =>
      dedupeKey({
        kind: r.kind,
        scope_type: r.scope_type,
        scope_id: r.scope_id,
        content: r.content,
      }),
    ),
  );
  const dryRun = body.dry_run === true;
  let imported = 0;
  let skipped = 0;
  for (const raw of parsed.pack.items) {
    const item = remapScope(raw, body.scope_remap);
    const key = dedupeKey(item);
    if (existing.has(key)) {
      skipped++;
      continue;
    }
    existing.add(key); // also dedupe within the pack itself
    if (!dryRun) {
      const id = randomUUID();
      insertAiMemory({
        id,
        scopeType: item.scope_type,
        scopeId: item.scope_id,
        kind: item.kind,
        title: item.title,
        content: item.content,
        embedding: item.embedding,
        embedModel: item.embed_model,
        source: `pack:${parsed.pack.source}`.slice(0, 120),
      });
      if (item.enabled === 0) setAiMemoryEnabled(id, false);
    }
    imported++;
  }
  if (!dryRun) {
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'ai.memory_pack_imported',
      targetType: 'ai_memory',
      targetId: parsed.pack.source,
      payload: {
        imported,
        skipped,
        total: parsed.pack.items.length,
      },
    });
  }
  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    imported,
    skipped,
    total: parsed.pack.items.length,
  });
}
