import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  getLlmProvider,
  setLlmProvider,
  validateLlmProvider,
  userHasPermission,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 209 — pluggable LOCAL LLM provider. ai.manage gated. The
// api_key is never echoed back (only api_key_set). A non-local
// base_url is rejected by validateLlmProvider — DialerOS never
// calls an external service.

function redact(p: ReturnType<typeof getLlmProvider>) {
  return {
    kind: p.kind,
    base_url: p.base_url,
    model_override: p.model_override ?? '',
    api_key_set: !!p.api_key,
  };
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!userHasPermission(me, 'ai.manage')) {
    return NextResponse.json(
      { error: 'ai.manage required' },
      { status: 403 },
    );
  }
  return NextResponse.json({ provider: redact(getLlmProvider()) });
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
  const b = await req.json().catch(() => ({}));
  const v = validateLlmProvider(b);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }
  // Preserve an existing api_key when the form leaves it blank
  // (so editing other fields doesn't wipe the bearer).
  if (!v.provider.api_key) {
    const cur = getLlmProvider();
    if (cur.api_key) v.provider.api_key = cur.api_key;
  }
  setLlmProvider(v.provider);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'ai.llm_provider_set',
    targetType: 'app_settings',
    targetId: 'ai.llm_provider',
    payload: {
      kind: v.provider.kind,
      base_url: v.provider.base_url,
      model_override: v.provider.model_override ?? null,
      api_key_set: !!v.provider.api_key,
    },
  });
  return NextResponse.json({ ok: true, provider: redact(v.provider) });
}
