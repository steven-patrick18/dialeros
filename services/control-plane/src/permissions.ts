import type { UserRecord } from './db';

// Iter 43 — fine-grained ACL. Iter 192 — ViciDial-style numeric
// user_level (1-9) layered on top, plus a level gate per
// permission (ViciDial pairs a grant with a minimum level: you
// can tick a powerful permission but it stays INERT until the
// user's level is high enough — prevents accidental over-grant).
//
// Effective rule:
//   admin role            → everything, always (short-circuit)
//   else a permission is effective iff
//        it is granted (explicit column OR role default)
//        AND user_level >= that permission's minLevel
//
// The catalog grew a lot since iter 43 — every supervisor /
// cluster / AI / CRM surface built through iter 191 now has a
// slug so access can be delegated without handing out admin.

export interface PermissionDef {
  slug: string;
  label: string;
  group: string;
  // Minimum user_level for this grant to take effect. ViciDial
  // semantics: high-power actions need both the grant and the
  // level.
  minLevel: number;
}

export const PERMISSION_CATALOG = [
  // Users
  { slug: 'users.modify', label: 'Edit users', group: 'Users', minLevel: 7 },
  { slug: 'users.create', label: 'Create users', group: 'Users', minLevel: 7 },
  { slug: 'users.delete', label: 'Deactivate users', group: 'Users', minLevel: 8 },
  { slug: 'users.access', label: 'Grant access / set user level', group: 'Users', minLevel: 9 },
  // Telephony
  { slug: 'carriers.modify', label: 'Edit carriers', group: 'Telephony', minLevel: 7 },
  { slug: 'route_plans.modify', label: 'Edit route plans', group: 'Telephony', minLevel: 7 },
  { slug: 'cluster.view', label: 'View cluster load', group: 'Telephony', minLevel: 6 },
  { slug: 'cluster.manage', label: 'Manage cluster nodes', group: 'Telephony', minLevel: 8 },
  // Campaigns
  { slug: 'campaigns.modify', label: 'Edit campaigns', group: 'Campaigns', minLevel: 6 },
  { slug: 'campaigns.start_stop', label: 'Start / stop campaigns', group: 'Campaigns', minLevel: 5 },
  // Lead lists
  { slug: 'lead_lists.modify', label: 'Edit lead lists', group: 'Lead lists', minLevel: 6 },
  { slug: 'lead_lists.upload', label: 'Upload CSV to a list', group: 'Lead lists', minLevel: 5 },
  // In-groups + DIDs
  { slug: 'in_groups.modify', label: 'Edit in-groups', group: 'In-groups', minLevel: 6 },
  { slug: 'dids.modify', label: 'Manage DIDs', group: 'In-groups', minLevel: 6 },
  // Supervision (wired live in iter 193)
  { slug: 'monitor.listen', label: 'Listen to live calls', group: 'Supervision', minLevel: 5 },
  { slug: 'monitor.whisper', label: 'Whisper to agent', group: 'Supervision', minLevel: 6 },
  { slug: 'monitor.barge', label: 'Barge into a call', group: 'Supervision', minLevel: 7 },
  { slug: 'qa.flag', label: 'Flag calls for QA', group: 'Supervision', minLevel: 5 },
  // AI / CRM / org
  { slug: 'ai.manage', label: 'Manage AI personas', group: 'AI & integrations', minLevel: 8 },
  { slug: 'crm.manage', label: 'Manage CRM providers', group: 'AI & integrations', minLevel: 8 },
  { slug: 'orgs.manage', label: 'Manage organizations', group: 'AI & integrations', minLevel: 9 },
  // Reporting + audit
  { slug: 'reports.view', label: 'View reports', group: 'Reporting', minLevel: 5 },
  { slug: 'audit.view', label: 'View audit log', group: 'Reporting', minLevel: 6 },
] as const satisfies readonly PermissionDef[];

export type PermissionSlug =
  (typeof PERMISSION_CATALOG)[number]['slug'];

export const ALL_PERMISSION_SLUGS: PermissionSlug[] =
  PERMISSION_CATALOG.map((p) => p.slug);

const SLUG_MIN_LEVEL: Record<string, number> = Object.fromEntries(
  PERMISSION_CATALOG.map((p) => [p.slug, p.minLevel]),
);

// --- User levels (ViciDial 1-9) -------------------------------------------

export interface UserLevelDef {
  level: number;
  label: string;
}
export const USER_LEVELS: UserLevelDef[] = [
  { level: 1, label: '1 — Agent' },
  { level: 2, label: '2 — Agent (extended)' },
  { level: 3, label: '3 — Senior agent' },
  { level: 4, label: '4 — Lead agent' },
  { level: 5, label: '5 — Supervisor' },
  { level: 6, label: '6 — Supervisor (extended)' },
  { level: 7, label: '7 — Manager' },
  { level: 8, label: '8 — Administrator' },
  { level: 9, label: '9 — Owner / full access' },
];

export function defaultLevelForRole(role: string): number {
  switch (role) {
    case 'admin':
      return 9;
    case 'supervisor':
      return 6;
    case 'operator':
      return 5;
    case 'agent':
    default:
      return 1;
  }
}

/** A user's effective numeric level. Falls back to the role
 * default when the column is missing/out-of-range (legacy rows
 * pre-iter-192 are backfilled, but be defensive). */
export function userLevel(
  user: Pick<UserRecord, 'role'> & { user_level?: number | null },
): number {
  const n = user.user_level;
  if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9) {
    return n;
  }
  return defaultLevelForRole(user.role);
}

export function userMeetsLevel(
  user: Pick<UserRecord, 'role'> & { user_level?: number | null },
  required: number,
): boolean {
  if (user.role === 'admin') return true;
  return userLevel(user) >= required;
}

// --- Role defaults ---------------------------------------------------------

export function defaultPermissionsForRole(role: string): PermissionSlug[] {
  switch (role) {
    case 'admin':
      return ALL_PERMISSION_SLUGS.slice();
    case 'supervisor':
      return [
        'campaigns.start_stop',
        'lead_lists.upload',
        'reports.view',
        'audit.view',
        'cluster.view',
        'monitor.listen',
        'monitor.whisper',
        'monitor.barge',
        'qa.flag',
      ];
    case 'operator':
      return ['reports.view', 'monitor.listen', 'qa.flag'];
    case 'agent':
    default:
      return [];
  }
}

export function parsePermissions(raw: string | null): PermissionSlug[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const set = new Set<string>(ALL_PERMISSION_SLUGS);
    return arr.filter(
      (s): s is PermissionSlug => typeof s === 'string' && set.has(s),
    );
  } catch {
    return [];
  }
}

export function serializePermissions(slugs: PermissionSlug[]): string {
  const set = new Set<string>(slugs);
  const ordered = ALL_PERMISSION_SLUGS.filter((s) => set.has(s));
  return JSON.stringify(ordered);
}

/** Granted set BEFORE the level gate (explicit column or role
 * default). Admins get everything. */
export function grantedPermissions(
  user: Pick<UserRecord, 'role' | 'permissions'>,
): PermissionSlug[] {
  if (user.role === 'admin') return ALL_PERMISSION_SLUGS.slice();
  if (user.permissions === null) {
    return defaultPermissionsForRole(user.role);
  }
  return parsePermissions(user.permissions);
}

/** Effective set = granted ∩ (user_level >= slug.minLevel).
 * Admins short-circuit to all. This is the ViciDial pairing:
 * a ticked permission is inert until the level clears its bar. */
export function effectivePermissions(
  user: Pick<UserRecord, 'role' | 'permissions'> & {
    user_level?: number | null;
  },
): PermissionSlug[] {
  if (user.role === 'admin') return ALL_PERMISSION_SLUGS.slice();
  const lvl = userLevel(user);
  return grantedPermissions(user).filter(
    (s) => lvl >= (SLUG_MIN_LEVEL[s] ?? 1),
  );
}

export function userHasPermission(
  user: Pick<UserRecord, 'role' | 'permissions'> & {
    user_level?: number | null;
  },
  perm: PermissionSlug,
): boolean {
  if (user.role === 'admin') return true;
  return effectivePermissions(user).includes(perm);
}
