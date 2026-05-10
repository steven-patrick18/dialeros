import { redirect } from 'next/navigation';
import { isSetupComplete } from '@dialeros/control-plane';
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

  return (
    <div className="min-h-screen flex flex-col">
      <ModuleStrip role={user.role} />
      <div className="flex flex-1">
        <Nav
          user={{ username: user.username, role: user.role }}
          initialTheme={theme}
        />
        <main className="flex-1 p-8 bg-bg text-fg">{children}</main>
      </div>
    </div>
  );
}
