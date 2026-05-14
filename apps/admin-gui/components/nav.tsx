'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle } from './theme-toggle';

// Iter 60 — collapsible-grouped sidebar. The flat 15-link list got
// unwieldy after iter 57's Remote Agents and iter 36's Domain & TLS;
// grouping into Operations / Telephony / Campaigns / People reads at
// a glance and lets infrequently-touched items (Cluster Nodes, Domain
// & TLS) collapse out of the way. The current route's section
// auto-expands so an agent always sees the link they came in on.

interface NavItem {
  href: string;
  label: string;
}
interface NavGroupDef {
  label: string;
  items: NavItem[];
}

const ADMIN_GROUPS: NavGroupDef[] = [
  {
    label: 'Operations',
    items: [
      { href: '/', label: 'Dashboard' },
      { href: '/realtime', label: 'Real-time' },
      { href: '/agent', label: 'Agent console' },
      { href: '/supervisor', label: 'Supervisor floor' },
      { href: '/supervisor/calls', label: 'Floor calls' },
      { href: '/callbacks', label: 'Callbacks' },
      { href: '/search/transcripts', label: 'Search transcripts' },
      { href: '/reports', label: 'Reports' },
      { href: '/audit', label: 'Audit Log' },
      { href: '/dnc', label: 'Do Not Call' },
      { href: '/consent-records', label: 'Consent records' },
    ],
  },
  {
    label: 'Campaigns',
    items: [
      { href: '/campaigns', label: 'Campaigns' },
      { href: '/leads', label: 'Lead Lists' },
      { href: '/in-groups', label: 'In-Groups' },
      { href: '/call-menus', label: 'Call Menus (IVR)' },
      { href: '/sound-board', label: 'Sound Board' },
      { href: '/dids', label: 'DIDs' },
    ],
  },
  {
    label: 'Telephony',
    items: [
      { href: '/carriers', label: 'Carriers' },
      { href: '/route-plans', label: 'Route Plans' },
      { href: '/cid-groups', label: 'CID Groups' },
      { href: '/cluster/nodes', label: 'Cluster Nodes' },
      { href: '/settings/telephony', label: 'Telephony settings' },
      { href: '/settings/recording-retention', label: 'Recording retention' },
      { href: '/settings/smtp', label: 'SMTP / email' },
      { href: '/settings/backups', label: 'Backups' },
      { href: '/settings/timers', label: 'Timer health' },
      { href: '/settings/queue-announce', label: 'Queue announce' },
      { href: '/settings/wrapup-enforcement', label: 'Wrap-up enforcement' },
      { href: '/settings/frequency-caps', label: 'Frequency caps (TCPA)' },
      { href: '/settings/domain', label: 'Domain & TLS' },
      { href: '/settings/pacing', label: 'Pacing curve' },
    ],
  },
  {
    label: 'People',
    items: [
      { href: '/users', label: 'Users' },
      { href: '/remote-agents', label: 'Remote Agents' },
    ],
  },
];

function pathMatches(itemHref: string, pathname: string): boolean {
  if (itemHref === '/') return pathname === '/';
  return pathname === itemHref || pathname.startsWith(itemHref + '/');
}

export function Nav({
  user,
  initialTheme,
}: {
  user: { username: string; role: string };
  initialTheme: 'light' | 'dark' | 'vicidial' | 'saas';
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="w-64 min-h-screen border-r border-border p-6 flex flex-col bg-card">
      <Link
        href={user.role === 'agent' ? '/agent' : '/'}
        className="block text-lg font-semibold mb-6 text-accent"
      >
        DialerOS
      </Link>

      <div className="space-y-1 text-sm">
        {user.role === 'agent' ? (
          <ul>
            <NavLink href="/agent" pathname={pathname}>
              My console
            </NavLink>
          </ul>
        ) : (
          ADMIN_GROUPS.map((g) => (
            <NavGroup key={g.label} group={g} pathname={pathname} />
          ))
        )}
      </div>

      <div className="mt-auto pt-4 border-t border-border space-y-3">
        <ThemeToggle initialTheme={initialTheme} />
        <div className="text-xs text-fg-muted">
          <div className="text-fg">{user.username}</div>
          <div className="text-fg-subtle">{user.role}</div>
        </div>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="text-fg-muted hover:text-fg disabled:opacity-50 text-xs"
        >
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </nav>
  );
}

function NavGroup({
  group,
  pathname,
}: {
  group: NavGroupDef;
  pathname: string;
}) {
  const activeIn = group.items.some((i) => pathMatches(i.href, pathname));
  const [open, setOpen] = useState(activeIn);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-fg-subtle hover:text-fg-muted"
      >
        <span>{group.label}</span>
        <span aria-hidden className="text-fg-subtle/70">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <ul className="mb-2">
          {group.items.map((i) => (
            <NavLink key={i.href} href={i.href} pathname={pathname}>
              {i.label}
            </NavLink>
          ))}
        </ul>
      )}
    </div>
  );
}

function NavLink({
  href,
  pathname,
  children,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
}) {
  const active = pathMatches(href, pathname);
  return (
    <li>
      <Link
        href={href}
        className={`block px-3 py-1.5 rounded transition-colors ${
          active
            ? 'bg-accent/15 text-accent'
            : 'text-fg-muted hover:text-fg hover:bg-card-hover'
        }`}
      >
        {children}
      </Link>
    </li>
  );
}
