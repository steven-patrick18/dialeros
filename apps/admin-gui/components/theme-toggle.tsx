'use client';

import { useEffect, useState } from 'react';

const COOKIE = 'dialeros_theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

type Theme = 'light' | 'dark' | 'vicidial' | 'saas';

// Iter 151 — order matters: saas is the new default + first in the
// rotation so a fresh visitor clicking the toggle sees the modern
// look before bouncing through other themes.
const ORDER: Theme[] = ['saas', 'light', 'vicidial', 'dark'];

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'vicidial', 'saas');
    if (theme === 'dark') root.classList.add('dark');
    else if (theme === 'vicidial') root.classList.add('vicidial');
    else if (theme === 'saas') root.classList.add('saas');
    document.cookie = `${COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }, [theme]);

  const idx = ORDER.indexOf(theme);
  const next = ORDER[(idx + 1) % ORDER.length]!;

  const label =
    theme === 'light'
      ? 'Light'
      : theme === 'dark'
        ? 'Dark'
        : theme === 'saas'
          ? 'SaaS'
          : 'ViciDial';
  const glyph =
    theme === 'light'
      ? '◐'
      : theme === 'dark'
        ? '◑'
        : theme === 'saas'
          ? '✦'
          : '◕';

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
