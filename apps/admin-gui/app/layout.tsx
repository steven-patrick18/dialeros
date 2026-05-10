import type { Metadata } from 'next';
import './globals.css';
import { getCurrentTheme } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'DialerOS',
  description: 'Cluster control plane',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const theme = await getCurrentTheme();
  const themeClass =
    theme === 'dark' ? 'dark' : theme === 'vicidial' ? 'vicidial' : '';
  return (
    <html lang="en" className={themeClass}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
