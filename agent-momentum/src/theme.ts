import type { Settings } from './types';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
let current: Settings['theme'] = 'system';

function paint() {
  const dark = current === 'dark' || (current === 'system' && !!media?.matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#060D1A' : '#14284B');
}

media?.addEventListener('change', paint);

export function applyTheme(theme: Settings['theme']) {
  current = theme;
  try {
    localStorage.setItem('am-theme', theme);
  } catch {
    /* private mode */
  }
  paint();
}
