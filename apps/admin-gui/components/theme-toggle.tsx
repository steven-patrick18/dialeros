'use client';

import { useEffect, useState } from 'react';

const COOKIE = 'dialeros_theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

export function ThemeToggle({
  initialTheme,
}: {
  initialTheme: 'light' | 'dark';
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    document.cookie = `${COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }, [theme]);

  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      className="text-fg-muted hover:text-fg flex items-center gap-2 text-xs"
    >
      <span aria-hidden>{theme === 'light' ? '◐' : '◑'}</span>
      <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
