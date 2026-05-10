import { cookies } from 'next/headers';

export const THEME_COOKIE = 'dialeros_theme';
export type Theme = 'light' | 'dark' | 'vicidial';
export const THEMES = ['light', 'vicidial', 'dark'] as const;

export const DEFAULT_THEME: Theme = 'light';

export async function getCurrentTheme(): Promise<Theme> {
  const c = await cookies();
  const value = c.get(THEME_COOKIE)?.value;
  if (value === 'light' || value === 'dark' || value === 'vicidial') {
    return value;
  }
  return DEFAULT_THEME;
}
