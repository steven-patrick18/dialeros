import { describe, expect, it } from 'vitest';
import {
  defaultLevelForRole,
  effectivePermissions,
  grantedPermissions,
  userHasPermission,
  userLevel,
  userMeetsLevel,
} from '../src/permissions';

type U = {
  role: string;
  permissions: string | null;
  user_level?: number | null;
};

describe('defaultLevelForRole', () => {
  it('maps roles to ViciDial-ish levels', () => {
    expect(defaultLevelForRole('admin')).toBe(9);
    expect(defaultLevelForRole('supervisor')).toBe(6);
    expect(defaultLevelForRole('operator')).toBe(5);
    expect(defaultLevelForRole('agent')).toBe(1);
    expect(defaultLevelForRole('weird')).toBe(1);
  });
});

describe('userLevel — fallback safety', () => {
  it('uses the column when valid', () => {
    expect(userLevel({ role: 'agent', user_level: 4 })).toBe(4);
  });
  it('falls back to role default when null / out-of-range', () => {
    expect(userLevel({ role: 'supervisor', user_level: null })).toBe(6);
    expect(userLevel({ role: 'supervisor', user_level: 0 })).toBe(6);
    expect(userLevel({ role: 'agent', user_level: 99 })).toBe(1);
    expect(userLevel({ role: 'agent', user_level: 2.5 })).toBe(1);
  });
});

describe('userMeetsLevel', () => {
  it('admin always meets any level', () => {
    expect(userMeetsLevel({ role: 'admin', user_level: 1 }, 9)).toBe(true);
  });
  it('compares numeric level for non-admins', () => {
    expect(userMeetsLevel({ role: 'agent', user_level: 5 }, 5)).toBe(true);
    expect(userMeetsLevel({ role: 'agent', user_level: 4 }, 5)).toBe(false);
  });
});

describe('grantedPermissions', () => {
  it('admin gets every slug regardless of column', () => {
    const g = grantedPermissions({ role: 'admin', permissions: '[]' });
    expect(g).toContain('orgs.manage');
    expect(g).toContain('users.delete');
  });
  it('null column → role defaults', () => {
    const g = grantedPermissions({ role: 'supervisor', permissions: null });
    expect(g).toContain('monitor.listen');
    expect(g).not.toContain('users.modify');
  });
  it('explicit column overrides role default', () => {
    const g = grantedPermissions({
      role: 'agent',
      permissions: JSON.stringify(['reports.view']),
    });
    expect(g).toEqual(['reports.view']);
  });
  it('drops unknown slugs from a tampered column', () => {
    const g = grantedPermissions({
      role: 'agent',
      permissions: JSON.stringify(['reports.view', 'totally.fake']),
    });
    expect(g).toEqual(['reports.view']);
  });
});

describe('effectivePermissions — level gate (ViciDial pairing)', () => {
  it('admin short-circuits to all', () => {
    const e = effectivePermissions({
      role: 'admin',
      permissions: '[]',
      user_level: 1,
    });
    expect(e).toContain('orgs.manage');
  });

  it('granted-but-under-level permission is INERT', () => {
    // operator role default includes monitor.listen (minLevel 5),
    // qa.flag (5), reports.view (5). At level 4 none clear the bar.
    const u: U = { role: 'operator', permissions: null, user_level: 4 };
    const e = effectivePermissions(u);
    expect(e).not.toContain('monitor.listen');
    expect(e).not.toContain('qa.flag');
  });

  it('same grant becomes effective once level clears the bar', () => {
    const u: U = { role: 'operator', permissions: null, user_level: 5 };
    const e = effectivePermissions(u);
    expect(e).toContain('monitor.listen');
    expect(e).toContain('qa.flag');
    expect(e).toContain('reports.view');
  });

  it('explicit grant of a high-power slug stays inert below its minLevel', () => {
    // Grant ai.manage (minLevel 8) to a level-6 supervisor —
    // ticked but inert until level 8.
    const u: U = {
      role: 'supervisor',
      permissions: JSON.stringify(['ai.manage', 'monitor.listen']),
      user_level: 6,
    };
    const e = effectivePermissions(u);
    expect(e).not.toContain('ai.manage'); // level too low
    expect(e).toContain('monitor.listen'); // minLevel 5 <= 6
  });

  it('level-8 supervisor activates the ai.manage grant', () => {
    const u: U = {
      role: 'supervisor',
      permissions: JSON.stringify(['ai.manage']),
      user_level: 8,
    };
    expect(effectivePermissions(u)).toContain('ai.manage');
  });
});

describe('userHasPermission', () => {
  it('admin true for anything', () => {
    expect(
      userHasPermission(
        { role: 'admin', permissions: '[]', user_level: 1 },
        'orgs.manage',
      ),
    ).toBe(true);
  });
  it('honours the level gate for non-admins', () => {
    const u: U = {
      role: 'supervisor',
      permissions: JSON.stringify(['monitor.barge']),
      user_level: 6, // monitor.barge needs 7
    };
    expect(userHasPermission(u, 'monitor.barge')).toBe(false);
    expect(
      userHasPermission({ ...u, user_level: 7 }, 'monitor.barge'),
    ).toBe(true);
  });
  it('false for an ungranted slug even at high level', () => {
    const u: U = { role: 'agent', permissions: '[]', user_level: 9 };
    expect(userHasPermission(u, 'reports.view')).toBe(false);
  });
});
