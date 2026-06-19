import { create } from 'zustand';

export type TabKey = 'today' | 'groups' | 'bracket' | 'leaderboard' | 'picks' | 'admin';
export type ThemeKey = 'minimal' | 'dark' | 'funky';

const THEME_STORAGE_KEY = 'wc26-theme';

function readInitialTheme(): ThemeKey {
  if (typeof window === 'undefined') return 'minimal';
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === 'dark') return 'dark';
  if (v === 'funky') return 'funky';
  return 'minimal';
}

function applyThemeToDom(theme: ThemeKey) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

interface UIState {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  openMatchId: string | null;
  openMatch: (id: string) => void;
  closeMatch: () => void;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  theme: ThemeKey;
  toggleTheme: () => void;
  setTheme: (t: ThemeKey) => void;
}

export const useUI = create<UIState>(set => ({
  tab: 'today',
  setTab: t => set({ tab: t, openMatchId: null }),
  openMatchId: null,
  openMatch: id => set({ openMatchId: id }),
  closeMatch: () => set({ openMatchId: null }),
  authOpen: false,
  setAuthOpen: open => set({ authOpen: open }),
  theme: readInitialTheme(),
  toggleTheme: () => set(s => {
    const order: ThemeKey[] = ['minimal', 'dark', 'funky'];
    const idx = order.indexOf(s.theme);
    const next = order[(idx + 1) % order.length];
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

if (typeof document !== 'undefined') {
  applyThemeToDom(readInitialTheme());
}
