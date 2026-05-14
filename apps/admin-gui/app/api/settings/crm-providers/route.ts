import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  crmProviderToSafe,
  insertCrmProvider,
  listCrmProviders,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 185 — CRM providers list + create (admin only).

export async function GET() {
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
  const rows = listCrmProviders(me.org_id).map(crmProviderToSafe);
  return NextResponse.json({ rows: JSON.parse(JSON.stringify(rows)) });
}

export async function POST(req: NextRequest) {
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const obj = body as {
    provider_type?: unknown;
    name?: unknown;
    base_url?: unknown;
    api_key?: unknown;
    request_template_json?: unknown;
  };
  if (obj.provider_type !== 'hubspot' && obj.provider_type !== 'generic') {
    return NextResponse.json(
      { error: 'provider_type must be hubspot|generic' },
      { status: 400 },
    );
  }
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (
    typeof obj.base_url !== 'string' ||
    !obj.base_url.startsWith('http')
  ) {
    return NextResponse.json(
      { error: 'base_url must be http(s) url' },
      { status: 400 },
    );
  }
  const row = insertCrmProvider({
    orgId: me.org_id,
    providerType: obj.provider_type,
    name: obj.name.trim(),
    baseUrl: obj.base_url.trim(),
    apiKey: typeof obj.api_key === 'string' && obj.api_key.length > 0 ? obj.api_key : null,
    requestTemplateJson:
      typeof obj.request_template_json === 'string'
        ? obj.request_template_json
        : null,
  });
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'crm_provider.created',
    targetType: 'crm_provider',
    targetId: row.id,
    payload: {
      provider_type: row.provider_type,
      name: row.name,
      base_url: row.base_url,
    },
  });
  return NextResponse.json({
    row: JSON.parse(JSON.stringify(crmProviderToSafe(row))),
  });
}
