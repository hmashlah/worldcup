import { useMemo, useState } from 'react';
import { Flag } from '@/components/Flag';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/contexts/AuthContext';

const SEEN_KEY = 'wc26-picks-seen';

function getSeenMatches(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch { return new Set(); }
}

function markSeen(matchId: string) {
  const seen = getSeenMatches();
  seen.add(matchId);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

interface Props {
  matchId: string;
  team1: string;
  team2: string;
  onClose: () => void;
}

export function PicksRevealModal({ matchId, team1, team2, onClose }: Props) {
  const { user } = useAuth();
  const predsQ = useAllPredictions();
  const profilesQ = useProfiles();
  const [animate] = useState(() => !getSeenMatches().has(matchId));

  // Mark as seen on mount
  useState(() => { markSeen(matchId); });

  const picks = useMemo(() => {
    if (!predsQ.data || !profilesQ.data) return [];
    const approvedIds = new Set(
      Object.values(profilesQ.data).filter(p => p.approved).map(p => p.user_id),
    );
    return (predsQ.data as PredictionRow[])
      .filter(p => p.match_id === matchId && approvedIds.has(p.user_id))
      .map(p => ({
        ...p,
        display_name: profilesQ.data![p.user_id]?.display_name ?? 'Unknown',
        isMe: p.user_id === user?.id,
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [predsQ.data, profilesQ.data, matchId, user]);

  const consensus = useMemo(() => {
    if (picks.length < 2) return null;
    let t1Wins = 0, draws = 0, t2Wins = 0, sumT1 = 0, sumT2 = 0;
    for (const p of picks) {
      sumT1 += p.team1_score;
      sumT2 += p.team2_score;
      if (p.team1_score > p.team2_score) t1Wins++;
      else if (p.team1_score < p.team2_score) t2Wins++;
      else draws++;
    }
    const total = picks.length;
    return {
      t1Pct: Math.round((t1Wins / total) * 100),
      drawPct: Math.round((draws / total) * 100),
      t2Pct: Math.round((t2Wins / total) * 100),
      avgT1: (sumT1 / total).toFixed(1),
      avgT2: (sumT2 / total).toFixed(1),
      total,
    };
  }, [picks]);

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal picks-reveal-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3>
            <Flag team={team1} /> {team1} vs {team2} <Flag team={team2} />
          </h3>
          <button type="button" className="gc-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="picks-reveal-body">
          {/* Consensus bar */}
          {consensus && (
            <div className="picks-consensus">
              <div className="picks-consensus-header">
                <span>{consensus.total} picks</span>
                <span>avg {consensus.avgT1} – {consensus.avgT2}</span>
              </div>
              <div className="consensus-bar">
                {consensus.t1Pct > 0 && (
                  <div className="consensus-seg consensus-seg-t1" style={{ width: `${consensus.t1Pct}%` }}>
                    {consensus.t1Pct >= 15 && <span>{consensus.t1Pct}%</span>}
                  </div>
                )}
                {consensus.drawPct > 0 && (
                  <div className="consensus-seg consensus-seg-draw" style={{ width: `${consensus.drawPct}%` }}>
                    {consensus.drawPct >= 15 && <span>{consensus.drawPct}%</span>}
                  </div>
                )}
                {consensus.t2Pct > 0 && (
                  <div className="consensus-seg consensus-seg-t2" style={{ width: `${consensus.t2Pct}%` }}>
                    {consensus.t2Pct >= 15 && <span>{consensus.t2Pct}%</span>}
                  </div>
                )}
              </div>
              <div className="consensus-legend">
                {consensus.t1Pct > 0 && <span className="consensus-legend-item consensus-legend-t1">{team1}</span>}
                {consensus.drawPct > 0 && <span className="consensus-legend-item consensus-legend-draw">Draw</span>}
                {consensus.t2Pct > 0 && <span className="consensus-legend-item consensus-legend-t2">{team2}</span>}
              </div>
            </div>
          )}

          {/* Individual picks */}
          <div className="picks-list">
            {picks.map((p, i) => (
              <div
                key={p.user_id}
                className={`picks-card ${p.isMe ? 'picks-card-mine' : ''} ${animate ? 'picks-card-animate' : ''}`}
                style={animate ? { animationDelay: `${i * 120}ms` } : undefined}
              >
                <span className="picks-card-name">{p.display_name}</span>
                <span className="picks-card-score">{p.team1_score} – {p.team2_score}</span>
                {p.advancer && <span className="picks-card-adv">{p.advancer} advances</span>}
              </div>
            ))}
          </div>

          {picks.length === 0 && (
            <p className="picks-empty">No predictions for this match yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
