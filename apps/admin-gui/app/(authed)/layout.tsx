import { redirect } from 'next/navigation';
import { isSetupComplete } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { getCurrentTheme } from '@/lib/theme';
import { Nav } from '@/components/nav';

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
    <div className="flex min-h-screen">
      <Nav
        user={{ username: user.username, role: user.role }}
        initialTheme={theme}
      />
      <main className="flex-1 p-8 bg-bg text-fg">{children}</main>
    </div>
  );
}
