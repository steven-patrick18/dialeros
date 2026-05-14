import { redirect } from 'next/navigation';
import { getOrg, isSetupComplete } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { getCurrentTheme } from '@/lib/theme';
import { Nav } from '@/components/nav';
import { ModuleStrip } from '@/components/module-strip';

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSetupComplete()) {
    redirect('/setup');
  }
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  const theme = await getCurrentTheme();
  // Iter 181 — surface org name in the sidebar. Legacy users
  // (pre-iter-181 backfill) end up on 'default' so this resolves.
  const org = getOrg(user.org_id ?? 'default');

  return (
    <div className="min-h-screen flex flex-col">
      <ModuleStrip role={user.role} />
      <div className="flex flex-1">
        <Nav
          user={{
            username: user.username,
            role: user.role,
            orgName: org?.name ?? 'Default Organization',
            orgSlug: org?.slug ?? 'default',
          }}
          initialTheme={theme}
        />
        <main className="flex-1 p-8 bg-bg text-fg">{children}</main>
      </div>
    </div>
  );
}
