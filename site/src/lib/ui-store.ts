import { create } from 'zustand';

export type TabKey = 'today' | 'groups' | 'bracket' | 'leaderboard' | 'admin';
export type ThemeKey = 'minimal' | 'funky';

const THEME_STORAGE_KEY = 'wc26-theme';

function readInitialTheme(): ThemeKey {
  if (typeof window === 'undefined') return 'minimal';
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  return v === 'funky' ? 'funky' : 'minimal';
}

function applyThemeToDom(theme: ThemeKey) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

interface UIState {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  theme: ThemeKey;
  toggleTheme: () => void;
  setTheme: (t: ThemeKey) => void;
}

export const useUI = create<UIState>(set => ({
  tab: 'today',
  setTab: t => set({ tab: t }),
  authOpen: false,
  setAuthOpen: open => set({ authOpen: open }),
  theme: readInitialTheme(),
  toggleTheme: () => set(s => {
    const next: ThemeKey = s.theme === 'minimal' ? 'funky' : 'minimal';
    localStorage.setItem(THEME_STORAGE_KEY, next);
    applyThemeToDom(next);
    return { theme: next };
  }),
  setTheme: t => {
    localStorage.setItem(THEME_STORAGE_KEY, t);
    applyThemeToDom(t);
    set({ theme: t });
  },
}));

// Apply on first load too (handles direct nav, /loop wakes, etc.)
if (typeof document !== 'undefined') {
  applyThemeToDom(readInitialTheme());
}
