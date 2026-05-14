import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteCrmProvider,
  getCrmProvider,
  setCrmProviderEnabled,
  updateCrmProvider,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 185 — Single CRM provider: PATCH (name/base/api_key/enabled),
// DELETE. Admin only. Audit on every mutation. api_key never echoed.

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const existing = getCrmProvider(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as {
    name?: unknown;
    base_url?: unknown;
    api_key?: unknown;
    request_template_json?: unknown;
    enabled?: unknown;
  };
  const payload: Record<string, unknown> = {};

  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be boolean' }, { status: 400 });
    }
    setCrmProviderEnabled(id, obj.enabled);
    payload.enabled = obj.enabled;
  }

  const updates: Parameters<typeof updateCrmProvider>[1] = {};
  if (obj.name !== undefined) {
    if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
      return NextResponse.json({ error: 'name invalid' }, { status: 400 });
    }
    updates.name = obj.name.trim();
    payload.name = updates.name;
  }
  if (obj.base_url !== undefined) {
    if (typeof obj.base_url !== 'string' || !obj.base_url.startsWith('http')) {
      return NextResponse.json({ error: 'base_url invalid' }, { status: 400 });
    }
    updates.baseUrl = obj.base_url.trim();
    payload.base_url = updates.baseUrl;
  }
  if (obj.api_key !== undefined) {
    if (obj.api_key === null) {
      updates.apiKey = null;
      payload.api_key = '(cleared)';
    } else if (typeof obj.api_key === 'string' && obj.api_key.length > 0) {
      updates.apiKey = obj.api_key;
      payload.api_key = '(rotated)';
    } else {
      return NextResponse.json({ error: 'api_key invalid' }, { status: 400 });
    }
  }
  if (obj.request_template_json !== undefined) {
    if (obj.request_template_json === null) {
      updates.requestTemplateJson = null;
    } else if (typeof obj.request_template_json === 'string') {
      updates.requestTemplateJson = obj.request_template_json;
      payload.request_template_json = '(updated)';
    } else {
      return NextResponse.json({ error: 'request_template_json invalid' }, { status: 400 });
    }
  }
  if (Object.keys(updates).length > 0) {
    updateCrmProvider(id, updates);
  }
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'crm_provider.updated',
    targetType: 'crm_provider',
    targetId: id,
    payload,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json(
      { error: 'Admin role required' },
      { status: 403 },
    );
  }
  const { id } = await ctx.params;
  const existing = getCrmProvider(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.org_id !== me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  deleteCrmProvider(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'crm_provider.deleted',
    targetType: 'crm_provider',
    targetId: id,
    payload: { name: existing.name, provider_type: existing.provider_type },
  });
  return NextResponse.json({ ok: true });
}
