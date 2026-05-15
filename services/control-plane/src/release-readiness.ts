// Iter 188 — Pure release-readiness evaluation. Given a snapshot
// of system facts, decide GO / NO-GO for a 1.0 production
// cut-over + return a checklist the operator can act on.
//
// Separated from data access so it's unit-testable: the API
// route gathers the facts (counts, env presence, health probe)
// and hands them here.

export interface ReadinessFacts {
  // From /api/health
  health_overall: 'ok' | 'degraded' | 'down';
  // Inventory — a usable dialer needs at least one of each
  carriers_enabled: number;
  route_plans_enabled: number;
  campaigns_total: number;
  users_admins: number;
  // Compliance / ops posture
  tls_configured: boolean;
  backups_configured: boolean;
  admin_env_present: boolean;
  smtp_configured: boolean;
  dnc_list_present: boolean;
}

export type CheckLevel = 'pass' | 'warn' | 'fail';

export interface ReadinessCheck {
  key: string;
  label: string;
  level: CheckLevel;
  detail: string;
}

export interface ReadinessReport {
  verdict: 'go' | 'no-go';
  // 'go' is allowed with warnings; only a 'fail' forces 'no-go'.
  checks: ReadinessCheck[];
  summary: { pass: number; warn: number; fail: number };
}

export function evaluateReadiness(
  f: ReadinessFacts,
): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // --- Hard gates (fail → NO-GO) ---
  checks.push({
    key: 'health',
    label: 'Subsystem health',
    level:
      f.health_overall === 'ok'
        ? 'pass'
        : f.health_overall === 'degraded'
          ? 'warn'
          : 'fail',
    detail:
      f.health_overall === 'ok'
        ? 'All subsystems green (db / disk / esl / fs_events / pacer).'
        : f.health_overall === 'degraded'
          ? 'One or more subsystems degraded — review /api/health.'
          : 'A subsystem is DOWN — fix before going live.',
  });

  checks.push({
    key: 'carriers',
    label: 'At least one enabled carrier',
    level: f.carriers_enabled > 0 ? 'pass' : 'fail',
    detail:
      f.carriers_enabled > 0
        ? `${f.carriers_enabled} enabled carrier(s).`
        : 'No enabled carrier — outbound + inbound termination impossible.',
  });

  checks.push({
    key: 'route_plans',
    label: 'At least one enabled route plan',
    level: f.route_plans_enabled > 0 ? 'pass' : 'fail',
    detail:
      f.route_plans_enabled > 0
        ? `${f.route_plans_enabled} enabled route plan(s).`
        : 'No enabled route plan — the pacer has nothing to dial through.',
  });

  checks.push({
    key: 'admins',
    label: 'At least one active admin',
    level: f.users_admins > 0 ? 'pass' : 'fail',
    detail:
      f.users_admins > 0
        ? `${f.users_admins} active admin user(s).`
        : 'No active admin — you would be locked out of management.',
  });

  checks.push({
    key: 'admin_env',
    label: 'Admin env / inbound token bootstrapped',
    level: f.admin_env_present ? 'pass' : 'fail',
    detail: f.admin_env_present
      ? 'KAMAILIO_INBOUND_TOKEN present — token-gated timers + inbound work.'
      : 'admin.env missing — every token-gated timer silently no-ops.',
  });

  // --- Soft gates (warn → still GO, but operator should know) ---
  checks.push({
    key: 'tls',
    label: 'TLS configured',
    level: f.tls_configured ? 'pass' : 'warn',
    detail: f.tls_configured
      ? 'Domain + TLS configured.'
      : 'No TLS — sessions ride plain HTTP; cookies need secure context.',
  });

  checks.push({
    key: 'backups',
    label: 'Backups configured',
    level: f.backups_configured ? 'pass' : 'warn',
    detail: f.backups_configured
      ? 'Nightly backup target configured.'
      : 'No backup target — a disk loss is unrecoverable.',
  });

  checks.push({
    key: 'campaigns',
    label: 'At least one campaign',
    level: f.campaigns_total > 0 ? 'pass' : 'warn',
    detail:
      f.campaigns_total > 0
        ? `${f.campaigns_total} campaign(s) configured.`
        : 'No campaigns yet — fine for a fresh install, expected before live traffic.',
  });

  checks.push({
    key: 'dnc',
    label: 'DNC list populated',
    level: f.dnc_list_present ? 'pass' : 'warn',
    detail: f.dnc_list_present
      ? 'DNC list has entries.'
      : 'DNC list empty — confirm this is intentional before outbound dialing (TCPA).',
  });

  checks.push({
    key: 'smtp',
    label: 'SMTP configured',
    level: f.smtp_configured ? 'pass' : 'warn',
    detail: f.smtp_configured
      ? 'SMTP relay configured — daily reports + alerts deliverable.'
      : 'No SMTP — daily report + operational emails will not send.',
  });

  const summary = {
    pass: checks.filter((c) => c.level === 'pass').length,
    warn: checks.filter((c) => c.level === 'warn').length,
    fail: checks.filter((c) => c.level === 'fail').length,
  };

  return {
    verdict: summary.fail > 0 ? 'no-go' : 'go',
    checks,
    summary,
  };
}
