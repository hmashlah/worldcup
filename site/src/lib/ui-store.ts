import { create } from 'zustand';

export type TabKey = 'today' | 'groups' | 'bracket' | 'leaderboard' | 'admin';

interface UIState {
  tab: TabKey;
  setTab: (t: TabKey) => void;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
}

export const useUI = create<UIState>(set => ({
  tab: 'today',
  setTab: t => set({ tab: t }),
  authOpen: false,
  setAuthOpen: open => set({ authOpen: open }),
}));
