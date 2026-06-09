import { useAuth } from '@/contexts/AuthContext';
import { useUI, type TabKey } from '@/lib/ui-store';

interface TabDef { key: TabKey; label: string }

const BASE_TABS: TabDef[] = [
  { key: 'groups',      label: 'Group Stage' },
  { key: 'bracket',     label: 'Knockouts' },
  { key: 'champion',    label: 'Champion' },
  { key: 'leaderboard', label: 'Leaderboard' },
];

export function Tabs() {
  const { tab, setTab } = useUI();
  const { isAdmin } = useAuth();
  const tabs = isAdmin ? [...BASE_TABS, { key: 'admin' as TabKey, label: 'Admin · Results' }] : BASE_TABS;
  return (
    <nav className="tabs">
      {tabs.map(t => (
        <button
          key={t.key}
          className={'tab' + (tab === t.key ? ' active' : '')}
          onClick={() => setTab(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
