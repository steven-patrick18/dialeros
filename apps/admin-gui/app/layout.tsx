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
  return (
    <html lang="en" className={theme === 'dark' ? 'dark' : ''}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
