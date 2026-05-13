import { cookies } from 'next/headers';

export const THEME_COOKIE = 'dialeros_theme';
// Iter 151 — added 'saas' as a fourth option. Modern Stripe/Linear
// look (Inter font, indigo accents, subtle shadows, generous rounding).
// 'vicidial' is the dense classic enterprise look for ops migrating
// from ViciDial; 'light'/'dark' are neutral defaults.
export type Theme = 'light' | 'dark' | 'vicidial' | 'saas';
export const THEMES = ['saas', 'light', 'vicidial', 'dark'] as const;

export const DEFAULT_THEME: Theme = 'saas';

export async function getCurrentTheme(): Promise<Theme> {
  const c = await cookies();
  const value = c.get(THEME_COOKIE)?.value;
  if (
    value === 'light' ||
    value === 'dark' ||
    value === 'vicidial' ||
    value === 'saas'
  ) {
    return value;
  }
  return DEFAULT_THEME;
}
