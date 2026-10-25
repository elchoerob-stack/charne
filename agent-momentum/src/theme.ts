import type { Settings } from './types';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;
let current: Settings['theme'] = 'system';

function paint() {
  // A host page may pin a theme with data-theme; honour it while on "Automatic".
  const pinned = document.documentElement.getAttribute('data-theme');
  const systemDark = pinned ? pinned === 'dark' : !!media?.matches;
  const dark = current === 'dark' || (current === 'system' && systemDark);
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
