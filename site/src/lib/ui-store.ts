import { create } from 'zustand';

export type TabKey = 'today' | 'groups' | 'bracket' | 'leaderboard' | 'admin';
export type ThemeKey = 'minimal' | 'funky';

const THEME_STORAGE_KEY = 'wc26-theme';
const ADMIN_MODE_STORAGE_KEY = 'wc26-admin-mode';

function readInitialTheme(): ThemeKey {
  if (typeof window === 'undefined') return 'minimal';
  const v = localStorage.getItem(THEME_STORAGE_KEY);
  return v === 'funky' ? 'funky' : 'minimal';
}

function readInitialAdminMode(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(ADMIN_MODE_STORAGE_KEY) === '1';
}

function applyThemeToDom(theme: ThemeKey) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

interface UIState {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  /** When set, App renders MatchDetailPage as a full-screen overlay
   *  instead of the current tab content. Closing it returns to `tab`. */
  openMatchId: string | null;
  openMatch: (id: string) => void;
  closeMatch: () => void;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
  theme: ThemeKey;
  toggleTheme: () => void;
  setTheme: (t: ThemeKey) => void;
  /** Admin viewing the site as themselves (results inputs, admin tab) vs.
   *  as a regular user (predictions only). Persisted in localStorage. */
  adminMode: boolean;
  toggleAdminMode: () => void;
  setAdminMode: (on: boolean) => void;
}

export const useUI = create<UIState>(set => ({
  tab: 'today',
  setTab: t => set({ tab: t }),
  openMatchId: null,
  openMatch: id => set({ openMatchId: id }),
  closeMatch: () => set({ openMatchId: null }),
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
  adminMode: readInitialAdminMode(),
  toggleAdminMode: () => set(s => {
    const next = !s.adminMode;
    localStorage.setItem(ADMIN_MODE_STORAGE_KEY, next ? '1' : '0');
    return { adminMode: next };
  }),
  setAdminMode: on => {
    localStorage.setItem(ADMIN_MODE_STORAGE_KEY, on ? '1' : '0');
    set({ adminMode: on });
  },
}));

// Apply on first load too (handles direct nav, /loop wakes, etc.)
if (typeof document !== 'undefined') {
  applyThemeToDom(readInitialTheme());
}
