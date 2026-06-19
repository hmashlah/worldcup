import { create } from 'zustand';

export type TabKey = 'today' | 'groups' | 'bracket' | 'leaderboard' | 'picks' | 'admin';
export type ThemeKey = 'minimal' | 'dark' | 'funky';

const THEME_STORAGE_KEY = 'wc26-theme';
const SPECTATOR_MODE_KEY = 'wc26-spectator';

function readInitialTheme(): ThemeKey {
  if (typeof window === 'undefined') return 'minimal';
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  if (v === 'dark') return 'dark';
  if (v === 'funky') return 'funky';
  return 'minimal';
}

function readInitialSpectator(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SPECTATOR_MODE_KEY) === '1';
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
  /** Spectator mode: hides predictions, consensus, points — shows only
   *  matches, scores, and schedule. Like a logged-out view but while
   *  staying signed in. */
  spectatorMode: boolean;
  toggleSpectator: () => void;
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
  spectatorMode: readInitialSpectator(),
  toggleSpectator: () => set(s => {
    const next = !s.spectatorMode;
    localStorage.setItem(SPECTATOR_MODE_KEY, next ? '1' : '0');
    // If switching to spectator while on a prediction-only tab, bounce to Matches
    if (next && (s.tab === 'leaderboard' || s.tab === 'picks')) {
      return { spectatorMode: next, tab: 'today' };
    }
    return { spectatorMode: next };
  }),
}));

if (typeof document !== 'undefined') {
  applyThemeToDom(readInitialTheme());
}
