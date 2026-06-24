import { useState, useMemo } from 'react';
import { Flag } from '@/components/Flag';
import { useAuth } from '@/contexts/AuthContext';
import { useSetFavTeam } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';

interface Props {
  onClose: () => void;
}

export function FavTeamModal({ onClose }: Props) {
  const { user } = useAuth();
  const dataQ = useTournamentData();
  const setFavTeam = useSetFavTeam();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const teams = useMemo(() => {
    if (!dataQ.data) return [];
    const all: string[] = [];
    for (const g of dataQ.data.groups) {
      for (const t of g.teams) all.push(t);
    }
    return all.sort((a, b) => a.localeCompare(b));
  }, [dataQ.data]);

  const handleSave = async () => {
    if (!user || !selected) return;
    setSaving(true);
    await setFavTeam.mutateAsync({ userId: user.id, favTeam: selected });
    setSaving(false);
    onClose();
  };

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal fav-team-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3>Pick Your Team</h3>
          <button type="button" className="gc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="fav-team-body">
          <p className="fav-team-intro">Which team are you supporting? Your flag will show next to your name.</p>
          <div className="fav-team-grid">
            {teams.map(t => (
              <button
                key={t}
                type="button"
                className={`fav-team-option ${selected === t ? 'fav-team-selected' : ''}`}
                onClick={() => setSelected(t)}
              >
                <Flag team={t} /> <span>{t}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="capsule-seal-btn"
            onClick={handleSave}
            disabled={saving || !selected}
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
