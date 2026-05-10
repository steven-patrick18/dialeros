import type { UserRecord } from './db';

// Iter 43 — fine-grained ACL. ViciDial-style permission matrix on top
// of the coarse role system. Each user can be granted a subset of the
// catalog below; the role provides a sensible default that admins can
// override per-user via the Access card on the user detail page.
//
// Admins implicitly have every permission regardless of the column —
// this is enforced in `userHasPermission`. The column is consulted
// only for non-admin users.

export const PERMISSION_CATALOG = [
  // User management
  { slug: 'users.modify', label: 'Edit users', group: 'Users' },
  { slug: 'users.create', label: 'Create users', group: 'Users' },
  { slug: 'users.delete', label: 'Deactivate users', group: 'Users' },
  // Telephony resources
  { slug: 'carriers.modify', label: 'Edit carriers', group: 'Telephony' },
  {
    slug: 'route_plans.modify',
    label: 'Edit route plans',
    group: 'Telephony',
  },
  // Campaigns
  {
    slug: 'campaigns.modify',
    label: 'Edit campaigns',
    group: 'Campaigns',
  },
  {
    slug: 'campaigns.start_stop',
    label: 'Start / stop campaigns',
    group: 'Campaigns',
  },
  // Lists / leads
  {
    slug: 'lead_lists.modify',
    label: 'Edit lead lists',
    group: 'Lead lists',
  },
  {
    slug: 'lead_lists.upload',
    label: 'Upload CSV to a list',
    group: 'Lead lists',
  },
  // In-groups + DIDs
  {
    slug: 'in_groups.modify',
    label: 'Edit in-groups',
    group: 'In-groups',
  },
  { slug: 'dids.modify', label: 'Manage DIDs', group: 'In-groups' },
  // Reporting + audit
  { slug: 'reports.view', label: 'View reports', group: 'Reporting' },
  { slug: 'audit.view', label: 'View audit log', group: 'Reporting' },
] as const;

export type PermissionSlug =
  (typeof PERMISSION_CATALOG)[number]['slug'];

export const ALL_PERMISSION_SLUGS: PermissionSlug[] =
  PERMISSION_CATALOG.map((p) => p.slug);

/**
 * Sensible default permission set for a role when the user's
 * `permissions` column is NULL. Admins are short-circuited — they
 * implicitly have everything via `userHasPermission`.
 */
export function defaultPermissionsForRole(role: string): PermissionSlug[] {
  switch (role) {
    case 'admin':
      return ALL_PERMISSION_SLUGS.slice();
    case 'supervisor':
      // Read-mostly; can edit non-destructive things. No user mgmt.
      return [
        'campaigns.start_stop',
        'lead_lists.upload',
        'reports.view',
        'audit.view',
      ];
    case 'operator':
      return ['reports.view'];
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
    const set = new Set(ALL_PERMISSION_SLUGS);
    return arr.filter(
      (s): s is PermissionSlug =>
        typeof s === 'string' && set.has(s as PermissionSlug),
    );
  } catch {
    return [];
  }
}

export function serializePermissions(slugs: PermissionSlug[]): string {
  // Stable order so two equivalent sets produce identical JSON.
  const set = new Set(slugs);
  const ordered = ALL_PERMISSION_SLUGS.filter((s) => set.has(s));
  return JSON.stringify(ordered);
}

/**
 * Effective permission set for a user: explicit grants if the column
 * is non-null, else the role's defaults. Admins always have all.
 */
export function effectivePermissions(
  user: Pick<UserRecord, 'role' | 'permissions'>,
): PermissionSlug[] {
  if (user.role === 'admin') return ALL_PERMISSION_SLUGS.slice();
  if (user.permissions === null) return defaultPermissionsForRole(user.role);
  return parsePermissions(user.permissions);
}

export function userHasPermission(
  user: Pick<UserRecord, 'role' | 'permissions'>,
  perm: PermissionSlug,
): boolean {
  if (user.role === 'admin') return true;
  return effectivePermissions(user).includes(perm);
}
