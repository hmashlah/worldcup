import { useState, useCallback, useEffect } from 'react';
import { Flag } from '@/components/Flag';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useUI } from '@/lib/ui-store';
import { computeStandings, getThirdPlacedRanking, computeSafeThirds, type Standing } from '@/lib/tournament';
import type { Group, GroupMatch, ScoreMap } from '@/lib/types';

interface CardProps { group: Group; isThirdQualified: boolean; isThirdSafe: boolean; onExpand: () => void }

function GroupCardCompact({ group, isThirdQualified, isThirdSafe, onExpand }: CardProps) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const openTeam = useUI(s => s.openTeam);

  const scores: ScoreMap = {};
  for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  const standings = dataQ.data ? computeStandings(dataQ.data, group, scores) : [];
  const groupComplete = standings.length > 0 && standings.every(t => t.P === 3);

  return (
    <div
      className="gc"
      data-group={group.name.split(' ').pop()}
    >
      <button
        type="button"
        className="gc-header"
        onClick={onExpand}
      >
        <span className="gc-title">{group.name}</span>
        <span className="gc-toggle">matches →</span>
      </button>

      <table className="gc-table">
        <thead>
          <tr>
            <th className="team-col">Team</th>
            <th>P</th><th>W</th><th>D</th><th>L</th>
            <th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((t, i) => {
            const cls =
              i < 2 ? 'qualified'
              : (i === 2 && isThirdQualified ? 'qualified'
              : i === 2 ? 'third-tied' : '');
            const showCheck = groupComplete && (i < 2 || (i === 2 && isThirdSafe));
            return (
              <tr className={cls} key={t.team}>
                <td className="team-col"><Flag team={t.team} /><span className="team-link" onClick={() => openTeam(t.team)}>{t.team}</span>{showCheck && <span className="gc-qualified-badge">✓</span>}</td>
                <td>{t.P}</td><td>{t.W}</td><td>{t.D}</td><td>{t.L}</td>
                <td>{t.GD > 0 ? `+${t.GD}` : t.GD}</td>
                <td className="pts">{t.Pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Compact row showing a played match result (read-only). */
function PlayedMatchRow({ match, score }: { match: GroupMatch; score: { team1: number; team2: number } }) {
  return (
    <div className="gc-sim-row gc-sim-row--played">
      <div className="gc-sim-team gc-sim-team--left">
        <Flag team={match.team1} /><span>{match.team1}</span>
      </div>
      <div className="gc-sim-score-display">
        <span>{score.team1}</span>
        <span className="gc-sim-dash">–</span>
        <span>{score.team2}</span>
      </div>
      <div className="gc-sim-team gc-sim-team--right">
        <span>{match.team2}</span><Flag team={match.team2} />
      </div>
      <div className="gc-sim-meta">{match.date} · {match.time}</div>
    </div>
  );
}

/** Compact row for an unplayed match with inline score inputs. */
function SimMatchRow({
  match,
  simScore,
  onChange,
}: {
  match: GroupMatch;
  simScore: { team1: string; team2: string } | undefined;
  onChange: (matchId: string, field: 'team1' | 'team2', value: string) => void;
}) {
  return (
    <div className="gc-sim-row">
      <div className="gc-sim-team gc-sim-team--left">
        <Flag team={match.team1} /><span>{match.team1}</span>
      </div>
      <div className="gc-sim-inputs">
        <input
          type="number"
          min={0}
          max={99}
          className="gc-sim-input"
          value={simScore?.team1 ?? ''}
          onChange={e => onChange(match.id, 'team1', e.target.value)}
          aria-label={`${match.team1} score`}
        />
        <span className="gc-sim-dash">–</span>
        <input
          type="number"
          min={0}
          max={99}
          className="gc-sim-input"
          value={simScore?.team2 ?? ''}
          onChange={e => onChange(match.id, 'team2', e.target.value)}
          aria-label={`${match.team2} score`}
        />
      </div>
      <div className="gc-sim-team gc-sim-team--right">
        <span>{match.team2}</span><Flag team={match.team2} />
      </div>
      <div className="gc-sim-meta">{match.date} · {match.time}</div>
    </div>
  );
}

function GroupMatchesModal({ group, onClose }: { group: Group; onClose: () => void }) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const openMatchId = useUI(s => s.openMatchId);
  const matches = dataQ.data?.group_matches[group.name] ?? [];

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Simulated scores: raw string values for controlled inputs
  const [simRaw, setSimRaw] = useState<Record<string, { team1: string; team2: string }>>({});

  const handleSimChange = useCallback((matchId: string, field: 'team1' | 'team2', value: string) => {
    setSimRaw(prev => ({
      ...prev,
      [matchId]: { ...prev[matchId], [field]: value } as { team1: string; team2: string },
    }));
  }, []);

  const resetSim = useCallback(() => setSimRaw({}), []);

  // Build merged ScoreMap: real results + valid sim scores
  const realResults = resultsQ.data ?? {};
  const mergedScores: ScoreMap = {};
  for (const [id, r] of Object.entries(realResults)) {
    mergedScores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  for (const [id, raw] of Object.entries(simRaw)) {
    if (realResults[id]) continue; // don't override real results
    const t1 = parseInt(raw.team1, 10);
    const t2 = parseInt(raw.team2, 10);
    if (!isNaN(t1) && !isNaN(t2) && t1 >= 0 && t2 >= 0) {
      mergedScores[id] = { team1: t1, team2: t2 };
    }
  }

  const standings = dataQ.data ? computeStandings(dataQ.data, group, mergedScores) : [];
  const hasSimActive = Object.keys(simRaw).some(id => {
    if (realResults[id]) return false;
    const raw = simRaw[id];
    const t1 = parseInt(raw.team1, 10);
    const t2 = parseInt(raw.team2, 10);
    return !isNaN(t1) && !isNaN(t2);
  });

  // Hide the modal when a match detail is open (it renders on top)
  if (openMatchId) return null;

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3>{group.name} — What-if Simulator</h3>
          <button className="gc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="gc-modal-body">
          {/* Standings table */}
          <div className="gc-sim-standings">
            {hasSimActive && <span className="gc-sim-badge">SIMULATED</span>}
            <table className="gc-table">
              <thead>
                <tr>
                  <th className="team-col">Team</th>
                  <th>P</th><th>W</th><th>D</th><th>L</th>
                  <th>GD</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((t, i) => {
                  const cls = i < 2 ? 'qualified' : i === 2 ? 'third-tied' : '';
                  return (
                    <tr className={cls} key={t.team}>
                      <td className="team-col"><Flag team={t.team} /><span>{t.team}</span></td>
                      <td>{t.P}</td><td>{t.W}</td><td>{t.D}</td><td>{t.L}</td>
                      <td>{t.GD > 0 ? `+${t.GD}` : t.GD}</td>
                      <td className="pts">{t.Pts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hasSimActive && (
              <button className="gc-sim-reset" onClick={resetSim} type="button">
                Reset simulation
              </button>
            )}
          </div>

          {/* Match rows */}
          <div className="gc-sim-matches">
            {matches.map(m => {
              const result = realResults[m.id];
              if (result) {
                return (
                  <PlayedMatchRow
                    key={m.id}
                    match={m}
                    score={{ team1: result.team1_score, team2: result.team2_score }}
                  />
                );
              }
              return (
                <SimMatchRow
                  key={m.id}
                  match={m}
                  simScore={simRaw[m.id]}
                  onChange={handleSimChange}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThirdPlaceTable({ ranking }: { ranking: Array<Standing & { group: string }> }) {
  return (
    <div className="third-place-section">
      <h3 className="third-place-title">Best Third-Place Teams</h3>
      <p className="third-place-subtitle">Top 8 advance to the Round of 32</p>
      <table className="third-place-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>Grp</th>
            <th>P</th>
            <th>W</th>
            <th>D</th>
            <th>L</th>
            <th>GD</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((t, i) => (
            <tr key={t.team} className={i < 8 ? 'third-qualified' : 'third-eliminated'}>
              <td>{i + 1}</td>
              <td className="third-team-cell"><Flag team={t.team} />{t.team}</td>
              <td>{t.group.replace('Group ', '')}</td>
              <td>{t.P}</td>
              <td>{t.W}</td>
              <td>{t.D}</td>
              <td>{t.L}</td>
              <td>{t.GD > 0 ? `+${t.GD}` : t.GD}</td>
              <td className="third-pts">{t.Pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GroupsGridView() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const openGroupName = useUI(s => s.openGroupName);
  const openGroup = useUI(s => s.openGroup);
  const closeGroup = useUI(s => s.closeGroup);

  if (!dataQ.data) return null;

  const scores: ScoreMap = {};
  for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  const ranking = getThirdPlacedRanking(dataQ.data, scores);
  const top8Thirds = new Set(ranking.slice(0, 8).map(t => t.group));
  const safeThirds = computeSafeThirds(dataQ.data, scores);

  const expandedGroup = openGroupName
    ? dataQ.data.groups.find(g => g.name === openGroupName) ?? null
    : null;

  return (
    <>
      <div className="gc-grid">
        {dataQ.data.groups.map(g => (
          <GroupCardCompact
            key={g.name}
            group={g}
            isThirdQualified={top8Thirds.has(g.name)}
            isThirdSafe={safeThirds.has(g.name)}
            onExpand={() => openGroup(g.name)}
          />
        ))}
      </div>
      {ranking.length > 0 && (
        <ThirdPlaceTable ranking={ranking} />
      )}
      {expandedGroup && (
        <GroupMatchesModal
          group={expandedGroup}
          onClose={closeGroup}
        />
      )}
    </>
  );
}
