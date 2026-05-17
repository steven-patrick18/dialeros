import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import {
  appendAudit,
  buildChatRequest,
  buildExemplarFromTurns,
  buildInterviewPrompt,
  buildQaTrainingDoc,
  chunkText,
  embed,
  EMBED_MODEL,
  getLlmProvider,
  insertAiMemory,
  listAiCallSessions,
  listAiCallTurns,
  listAiMemory,
  listAiPersonas,
  parseChatReply,
  parseInterviewQuestions,
  resolveLlmModel,
  trainingSource,
  trainingTitle,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 211 — Master AI Training Center (text / live-call /
// self-interview; audio is the sibling /audio route). Every
// mode ends as scoped ai_memory the Worker retrieves (iter 204).
// admin OR ai.manage.

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

function scopeOf(b: {
  scope_type?: unknown;
  scope_id?: unknown;
}): { ok: true; t: string; i: string } | { ok: false; error: string } {
  const t =
    b.scope_type === 'campaign' || b.scope_type === 'in_group'
      ? b.scope_type
      : 'global';
  const i = t === 'global' ? '' : String(b.scope_id ?? '').trim();
  if (t !== 'global' && !i) {
    return { ok: false, error: 'scope_id required for that scope' };
  }
  return { ok: true, t, i };
}

async function storeDoc(args: {
  text: string;
  title: string;
  source: string;
  scopeType: string;
  scopeId: string;
}): Promise<{ stored: number; embedWarning: string | null }> {
  const chunks = chunkText(args.text, 800);
  let stored = 0;
  let embedWarning: string | null = null;
  for (let idx = 0; idx < chunks.length; idx++) {
    const piece = chunks[idx] ?? '';
    if (!piece.trim()) continue;
    const e = await embed(piece);
    if (!e.ok && !embedWarning) embedWarning = e.detail;
    insertAiMemory({
      id: randomUUID(),
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      kind: 'knowledge',
      title:
        chunks.length > 1
          ? `${args.title} (${idx + 1}/${chunks.length})`
          : args.title,
      content: piece,
      embedding: e.ok ? e.vector : null,
      embedModel: e.ok ? EMBED_MODEL : null,
      source: args.source,
    });
    stored++;
  }
  return { stored, embedWarning };
}

async function gate(): Promise<
  | { ok: true; me: Awaited<ReturnType<typeof getCurrentUser>> }
  | { ok: false; res: NextResponse }
> {
  const me = await getCurrentUser();
  if (!me)
    return {
      ok: false,
      res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  if (me.role !== 'admin' && !userHasPermission(me, 'ai.manage')) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'ai.manage required' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, me };
}

export async function GET(req: NextRequest) {
  const g = await gate();
  if (!g.ok) return g.res;
  const mode = req.nextUrl.searchParams.get('mode');

  if (mode === 'sessions') {
    const sessions = listAiCallSessions(30)
      .filter((s) => s.ended_at)
      .slice(0, 25)
      .map((s) => ({
        id: s.id,
        started_at: s.started_at,
        ended_at: s.ended_at,
        status: s.status,
        persona_id: s.persona_id,
      }));
    return NextResponse.json({ sessions });
  }

  if (mode === 'interview') {
    const st = req.nextUrl.searchParams.get('scope_type') ?? 'global';
    const si = req.nextUrl.searchParams.get('scope_id') ?? '';
    const n = Number(req.nextUrl.searchParams.get('n') ?? 6);
    const scopeLabel =
      st === 'global' ? 'general customer support' : `${st}:${si}`;
    const known = [
      ...listAiMemory(st === 'global' ? undefined : st, si),
      ...(st === 'global' ? [] : listAiMemory(undefined, '')),
    ]
      .map((m) => m.title)
      .filter((t): t is string => typeof t === 'string');
    const prov = getLlmProvider();
    const model = resolveLlmModel(
      prov,
      listAiPersonas('default').find((p) => p.enabled)?.llm_model ??
        'qwen2.5:3b',
    );
    const reqd = buildChatRequest(
      prov,
      model,
      [
        {
          role: 'user',
          content: buildInterviewPrompt(scopeLabel, known, n),
        },
      ],
      { temperature: 0.4 },
    );
    try {
      const r = await fetch(reqd.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...reqd.headers,
        },
        body: JSON.stringify(reqd.body),
        signal: AbortSignal.timeout(40_000),
      });
      if (!r.ok) {
        return NextResponse.json(
          { error: `LLM HTTP ${r.status}`, questions: [] },
          { status: 502 },
        );
      }
      const questions = parseInterviewQuestions(
        parseChatReply(prov, await r.json()),
        n,
      );
      return NextResponse.json({ questions });
    } catch (e) {
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? `LLM unreachable (${OLLAMA_URL}): ${e.message}`
              : 'LLM unreachable',
          questions: [],
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const g = await gate();
  if (!g.ok) return g.res;
  const me = g.me!;
  const b = (await req.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const mode = String(b.mode ?? '');
  const sc = scopeOf(b);
  if (!sc.ok) return NextResponse.json({ error: sc.error }, { status: 400 });

  if (mode === 'text') {
    const title = String(b.title ?? '').trim();
    const content = String(b.content ?? '').trim();
    if (!title || !content) {
      return NextResponse.json(
        { error: 'title + content required' },
        { status: 400 },
      );
    }
    const out = await storeDoc({
      text: content,
      title: trainingTitle('text', title),
      source: trainingSource('text'),
      scopeType: sc.t,
      scopeId: sc.i,
    });
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'ai.trained',
      targetType: 'ai_memory',
      targetId: `${sc.t}:${sc.i}`,
      payload: { mode, chunks: out.stored },
    });
    return NextResponse.json({
      ok: true,
      stored: out.stored,
      embed_warning: out.embedWarning,
    });
  }

  if (mode === 'session') {
    const sid = String(b.session_id ?? '').trim();
    if (!sid)
      return NextResponse.json(
        { error: 'session_id required' },
        { status: 400 },
      );
    const turns = listAiCallTurns(sid).map((t) => ({
      role: t.role,
      text: t.text,
    }));
    const doc = buildExemplarFromTurns(turns, 4000);
    if (!doc) {
      return NextResponse.json(
        { error: 'session has no usable caller+agent transcript' },
        { status: 400 },
      );
    }
    const out = await storeDoc({
      text: doc,
      title: trainingTitle('call', sid.slice(0, 8)),
      source: trainingSource('call', sid),
      scopeType: sc.t,
      scopeId: sc.i,
    });
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'ai.trained',
      targetType: 'ai_memory',
      targetId: `${sc.t}:${sc.i}`,
      payload: { mode, session_id: sid, chunks: out.stored },
    });
    return NextResponse.json({
      ok: true,
      stored: out.stored,
      embed_warning: out.embedWarning,
    });
  }

  if (mode === 'interview') {
    const qa = Array.isArray(b.qa) ? b.qa : [];
    let stored = 0;
    let embedWarning: string | null = null;
    for (const item of qa) {
      const q = String((item as { q?: unknown })?.q ?? '');
      const a = String((item as { a?: unknown })?.a ?? '');
      const doc = buildQaTrainingDoc(q, a);
      if (!doc) continue;
      const out = await storeDoc({
        text: doc,
        title: trainingTitle('interview', q.slice(0, 60)),
        source: trainingSource('interview'),
        scopeType: sc.t,
        scopeId: sc.i,
      });
      stored += out.stored;
      if (out.embedWarning && !embedWarning)
        embedWarning = out.embedWarning;
    }
    if (stored === 0) {
      return NextResponse.json(
        { error: 'no answered questions to store' },
        { status: 400 },
      );
    }
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'ai.trained',
      targetType: 'ai_memory',
      targetId: `${sc.t}:${sc.i}`,
      payload: { mode, answers: stored },
    });
    return NextResponse.json({
      ok: true,
      stored,
      embed_warning: embedWarning,
    });
  }

  return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
}
