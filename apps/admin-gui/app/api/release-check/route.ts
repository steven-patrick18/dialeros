import { NextResponse } from 'next/server';
import {
  countDnc,
  evaluateReadiness,
  getAppSetting,
  getBuildInfo,
  getSmtpConfig,
  listBackupVerifications,
  listCampaigns,
  listCarriers,
  listRoutePlans,
  listUsers,
  type ReadinessFacts,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 188 — Release-readiness self-check. Gathers system facts,
// hands them to the pure evaluateReadiness() decider, returns the
// GO / NO-GO verdict + checklist. Admin only.

async function gatherFacts(): Promise<ReadinessFacts> {
  // Health: ask our own /api/health so the verdict reflects the
  // same probes ops + uptime monitors see. Localhost, short
  // timeout; on any failure we treat health as 'down'.
  let healthOverall: 'ok' | 'degraded' | 'down' = 'down';
  try {
    const res = await fetch('http://127.0.0.1:1111/api/health', {
      signal: AbortSignal.timeout(3000),
    });
    const j = (await res.json()) as { status?: string };
    if (j.status === 'ok' || j.status === 'degraded' || j.status === 'down') {
      healthOverall = j.status;
    }
  } catch {
    healthOverall = 'down';
  }

  const carriers = listCarriers();
  const routePlans = listRoutePlans();
  const campaigns = listCampaigns();
  const users = listUsers();
  const smtp = getSmtpConfig();
  const backups = listBackupVerifications();

  return {
    health_overall: healthOverall,
    carriers_enabled: carriers.filter((c) => c.enabled === 1).length,
    route_plans_enabled: routePlans.filter((r) => r.enabled === 1).length,
    campaigns_total: campaigns.length,
    users_admins: users.filter(
      (u) => u.role === 'admin' && u.is_active === 1,
    ).length,
    tls_configured: Boolean(getAppSetting('domain.canonical')),
    backups_configured: backups.length > 0,
    admin_env_present: Boolean(process.env.KAMAILIO_INBOUND_TOKEN),
    smtp_configured: Boolean(smtp.host && smtp.host.length > 0),
    dnc_list_present: countDnc() > 0,
  };
}

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
  const facts = await gatherFacts();
  const report = evaluateReadiness(facts);
  return NextResponse.json({
    build: getBuildInfo(),
    facts,
    report,
  });
}
