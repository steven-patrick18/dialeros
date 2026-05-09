'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle } from './theme-toggle';

export function Nav({
  user,
  initialTheme,
}: {
  user: { username: string; role: string };
  initialTheme: 'light' | 'dark';
}) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="w-64 min-h-screen border-r border-border p-6 flex flex-col bg-card">
      <Link href="/" className="block text-lg font-semibold mb-8 text-accent">
        DialerOS
      </Link>

      <ul className="space-y-1 text-sm">
        <NavLink href="/">Dashboard</NavLink>
        <NavLink href="/cluster/nodes">Cluster Nodes</NavLink>
        <NavLink href="/carriers">Carriers</NavLink>
        <NavLink href="/route-plans">Route Plans</NavLink>
        <NavLink href="/audit">Audit Log</NavLink>
      </ul>

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

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block px-3 py-2 rounded text-fg-muted hover:text-fg hover:bg-card-hover"
      >
        {children}
      </Link>
    </li>
  );
}
