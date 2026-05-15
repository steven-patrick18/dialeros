import { describe, expect, it } from 'vitest';
import {
  evaluateReadiness,
  type ReadinessFacts,
} from '../src/release-readiness';

// A fully-healthy production-ready snapshot.
const GO: ReadinessFacts = {
  health_overall: 'ok',
  carriers_enabled: 2,
  route_plans_enabled: 1,
  campaigns_total: 3,
  users_admins: 1,
  tls_configured: true,
  backups_configured: true,
  admin_env_present: true,
  smtp_configured: true,
  dnc_list_present: true,
};

describe('evaluateReadiness — verdict', () => {
  it('GO when everything passes', () => {
    const r = evaluateReadiness(GO);
    expect(r.verdict).toBe('go');
    expect(r.summary.fail).toBe(0);
    expect(r.summary.warn).toBe(0);
    expect(r.checks.every((c) => c.level === 'pass')).toBe(true);
  });

  it('GO with warnings (soft gates do not block)', () => {
    const r = evaluateReadiness({
      ...GO,
      tls_configured: false,
      backups_configured: false,
      smtp_configured: false,
      dnc_list_present: false,
      campaigns_total: 0,
    });
    expect(r.verdict).toBe('go');
    expect(r.summary.fail).toBe(0);
    expect(r.summary.warn).toBeGreaterThanOrEqual(4);
  });

  it('NO-GO when a hard gate fails (no carrier)', () => {
    const r = evaluateReadiness({ ...GO, carriers_enabled: 0 });
    expect(r.verdict).toBe('no-go');
    const carrier = r.checks.find((c) => c.key === 'carriers');
    expect(carrier?.level).toBe('fail');
  });

  it('NO-GO when no route plan', () => {
    const r = evaluateReadiness({ ...GO, route_plans_enabled: 0 });
    expect(r.verdict).toBe('no-go');
  });

  it('NO-GO when no active admin', () => {
    const r = evaluateReadiness({ ...GO, users_admins: 0 });
    expect(r.verdict).toBe('no-go');
  });

  it('NO-GO when admin.env missing', () => {
    const r = evaluateReadiness({ ...GO, admin_env_present: false });
    expect(r.verdict).toBe('no-go');
    expect(
      r.checks.find((c) => c.key === 'admin_env')?.level,
    ).toBe('fail');
  });

  it('NO-GO when health is down', () => {
    const r = evaluateReadiness({ ...GO, health_overall: 'down' });
    expect(r.verdict).toBe('no-go');
  });

  it('GO but warns when health degraded', () => {
    const r = evaluateReadiness({ ...GO, health_overall: 'degraded' });
    expect(r.verdict).toBe('go');
    expect(
      r.checks.find((c) => c.key === 'health')?.level,
    ).toBe('warn');
  });
});

describe('evaluateReadiness — summary counts', () => {
  it('counts pass/warn/fail correctly', () => {
    const r = evaluateReadiness({
      ...GO,
      carriers_enabled: 0, // fail
      tls_configured: false, // warn
      smtp_configured: false, // warn
    });
    expect(r.summary.fail).toBe(1);
    expect(r.summary.warn).toBe(2);
    expect(r.summary.pass).toBe(
      r.checks.length - r.summary.fail - r.summary.warn,
    );
  });

  it('every check has a non-empty detail string', () => {
    const r = evaluateReadiness(GO);
    expect(r.checks.every((c) => c.detail.length > 0)).toBe(true);
  });

  it('check keys are unique', () => {
    const r = evaluateReadiness(GO);
    const keys = r.checks.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
