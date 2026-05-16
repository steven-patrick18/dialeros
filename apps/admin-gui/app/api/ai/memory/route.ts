import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendAudit,
  chunkText,
  embed,
  insertAiMemory,
  listAiMemory,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 202 — Master RAG memory. GET list (optional ?scope_type
// &scope_id). POST: chunk + embed + store one knowledge entry
// per chunk. ai.manage gated.

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const st = req.nextUrl.searchParams.get('scope_type') ?? undefined;
  const si = req.nextUrl.searchParams.get('scope_id') ?? '';
  const rows = listAiMemory(st, si).map((r) => ({
    ...r,
    embedding: undefined, // never ship vectors to the browser
    embedded: r.embedding != null,
  }));
  return NextResponse.json({ rows: JSON.parse(JSON.stringify(rows)) });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json({ error: 'ai.manage required' }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as {
    title?: unknown;
    content?: unknown;
    scope_type?: unknown;
    scope_id?: unknown;
  };
  const title = String(b.title ?? '').trim();
  const content = String(b.content ?? '').trim();
  const scopeType =
    b.scope_type === 'campaign' || b.scope_type === 'in_group'
      ? b.scope_type
      : 'global';
  const scopeId =
    scopeType === 'global' ? '' : String(b.scope_id ?? '').trim();
  if (!title || !content) {
    return NextResponse.json(
      { error: 'title + content required' },
      { status: 400 },
    );
  }
  if (scopeType !== 'global' && !scopeId) {
    return NextResponse.json(
      { error: 'scope_id required for campaign / in_group scope' },
      { status: 400 },
    );
  }
  const chunks = chunkText(content, 800);
  if (chunks.length === 0) {
    return NextResponse.json({ error: 'empty content' }, { status: 400 });
  }
  let stored = 0;
  let embedErr: string | null = null;
  for (let idx = 0; idx < chunks.length; idx++) {
    const e = await embed(chunks[idx]!);
    insertAiMemory({
      id: randomUUID(),
      scopeType,
      scopeId,
      kind: 'knowledge',
      title: chunks.length > 1 ? `${title} (${idx + 1}/${chunks.length})` : title,
      content: chunks[idx]!,
      embedding: e.ok ? e.vector : null,
      embedModel: e.ok ? 'all-minilm' : null,
      source: 'operator',
    });
    stored++;
    if (!e.ok && !embedErr) embedErr = e.detail;
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.memory_added',
    targetType: 'ai_memory',
    targetId: scopeType + ':' + scopeId,
    payload: { title, chunks: stored, scope_type: scopeType },
  });
  return NextResponse.json({
    ok: true,
    chunks: stored,
    embed_warning: embedErr,
  });
}
