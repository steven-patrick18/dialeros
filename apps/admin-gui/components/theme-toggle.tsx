'use client';

import { useEffect, useState } from 'react';

const COOKIE = 'dialeros_theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

type Theme = 'light' | 'dark' | 'vicidial';

const ORDER: Theme[] = ['light', 'vicidial', 'dark'];

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'vicidial');
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'vicidial') root.classList.add('vicidial');
    document.cookie = `${COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }, [theme]);

  const idx = ORDER.indexOf(theme);
  const next = ORDER[(idx + 1) % ORDER.length]!;

  const label =
    theme === 'light' ? 'Light' : theme === 'dark' ? 'Dark' : 'ViciDial';
  const glyph =
    theme === 'light' ? '◐' : theme === 'dark' ? '◑' : '◕';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      className="text-fg-muted hover:text-fg flex items-center gap-2 text-xs"
    >
      <span aria-hidden>{glyph}</span>
      <span>{label}</span>
    </button>
  );
}
