import { create } from 'zustand';

export type TabKey = 'groups' | 'bracket' | 'champion' | 'leaderboard' | 'admin';

interface UIState {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
}

export const useUI = create<UIState>(set => ({
  tab: 'groups',
  setTab: t => set({ tab: t }),
  authOpen: false,
  setAuthOpen: open => set({ authOpen: open }),
}));
