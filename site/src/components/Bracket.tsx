import { useEffect, useMemo, useState } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { Flag } from '@/components/Flag';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import {
  resolveSlot, prettySlot, isKnockoutRound, koWinner, koLoser,
} from '@/lib/tournament';
import { parseKickoff } from '@/lib/time';
import type { AdvancerMap, KoMatch, RoundName, ScoreMap, TournamentData } from '@/lib/types';

type RoundKey = 'r32' | 'r16' | 'qf' | 'sf' | 'final';

const ROUND_DEFS: Array<{ key: RoundKey; label: string; rounds: RoundName[] }> = [
  { key: 'r32',   label: 'R32',   rounds: ['Round of 32'] },
  { key: 'r16',   label: 'R16',   rounds: ['Round of 16'] },
  { key: 'qf',    label: 'QF',    rounds: ['Quarter-final'] },
  { key: 'sf',    label: 'SF',    rounds: ['Semi-final'] },
  { key: 'final', label: 'Final', rounds: ['Final', 'Match for third place'] },
];

function nextUpcomingRound(
  data: TournamentData,
  resultsMap: Record<string, unknown>,
): RoundKey {
  const now = Date.now();
  for (const def of ROUND_DEFS) {
    const matches = data.ko_matches.filter(m => def.rounds.includes(m.round));
    // The "next" round is the first one with at least one un-played match
    // (no result, OR kickoff is still in the future).
    const hasOpenMatch = matches.some(m => !resultsMap[m.id] || parseKickoff(m.date, m.time).getTime() > now);
    if (hasOpenMatch) return def.key;
  }
  return 'final';
}

export function Bracket() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();

  const scores: ScoreMap = useMemo(() => {
    const out: ScoreMap = {};
    for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
      out[id] = { team1: r.team1_score, team2: r.team2_score };
    }
    return out;
  }, [resultsQ.data]);

  const advancers: AdvancerMap = useMemo(() => {
    const out: AdvancerMap = {};
    for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
      out[id] = r.advancer ?? null;
    }
    return out;
  }, [resultsQ.data]);

  const initial = useMemo<RoundKey>(
    () => dataQ.data ? nextUpcomingRound(dataQ.data, resultsQ.data ?? {}) : 'r32',
    [dataQ.data, resultsQ.data],
  );
  const [activeRound, setActiveRound] = useState<RoundKey>(initial);
  // Reset to "next upcoming" only when data first loads.
  useEffect(() => { setActiveRound(initial); }, [initial]);

  if (!dataQ.data) return null;

  const def = ROUND_DEFS.find(d => d.key === activeRound)!;
  const matches = dataQ.data.ko_matches.filter(m => def.rounds.includes(m.round));

  return (
    <div className="kb">
      {/* Round nav */}
      <div className="kb-nav">
        {ROUND_DEFS.map(d => {
          const count = dataQ.data!.ko_matches.filter(m => d.rounds.includes(m.round)).length;
          return (
            <button
              key={d.key}
              className={`kb-nav-tab ${activeRound === d.key ? 'active' : ''}`}
              data-r={d.key}
              onClick={() => setActiveRound(d.key)}
            >
              <span className="kb-nav-label">{d.label}</span>
              <span className="kb-nav-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Final round gets a trophy banner */}
      {activeRound === 'final' && (
        <ChampionBanner data={dataQ.data} scores={scores} advancers={advancers} />
      )}

      {/* Match grid */}
      <div className={`kb-grid ${activeRound === 'final' ? 'kb-grid-final' : ''}`}>
        {matches
          .filter(m => m.round !== 'Match for third place')
          .map(m => (
            <KoCardWrapper
              key={m.id}
              match={m}
              data={dataQ.data!}
              scores={scores}
              advancers={advancers}
              isFinal={m.round === 'Final'}
            />
          ))}
      </div>

      {/* 3rd-place playoff appears below the Final card on the Final tab */}
      {activeRound === 'final' && (
        <div className="kb-third">
          <h3 className="kb-third-heading">Match for third place</h3>
          {matches
            .filter(m => m.round === 'Match for third place')
            .map(m => (
              <KoCardWrapper
                key={m.id}
                match={m}
                data={dataQ.data!}
                scores={scores}
                advancers={advancers}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function KoCardWrapper({
  match, data, scores, advancers, isFinal,
}: {
  match: KoMatch;
  data: TournamentData;
  scores: ScoreMap;
  advancers: AdvancerMap;
  isFinal?: boolean;
}) {
  const t1 = resolveSlot(data, scores, advancers, match.team1);
  const t2 = resolveSlot(data, scores, advancers, match.team2);
  // Pick a stable round token for theming (data-round → CSS picks --rnd-*)
  const roundKey =
    match.round === 'Round of 32' ? 'r32'
    : match.round === 'Round of 16' ? 'r16'
    : match.round === 'Quarter-final' ? 'qf'
    : match.round === 'Semi-final' ? 'sf'
    : match.round === 'Final' ? 'final'
    : match.round === 'Match for third place' ? 'sf'
    : 'r32';
  return (
    <div className={`kb-card ${isFinal ? 'kb-card-final' : ''}`} data-round={roundKey}>
      {match.num !== null && <div className="kb-card-num">M{match.num}</div>}
      <MatchCard
        matchId={match.id}
        team1={t1 ?? match.team1}
        team2={t2 ?? match.team2}
        team1IsResolved={!!t1}
        team2IsResolved={!!t2}
        team1Placeholder={prettySlot(match.team1)}
        team2Placeholder={prettySlot(match.team2)}
        date={match.date}
        time={match.time}
        ground={match.ground}
        isKO={isKnockoutRound(match.round)}
        roundLabel={match.round}
      />
    </div>
  );
}

function ChampionBanner({
  data, scores, advancers,
}: {
  data: TournamentData;
  scores: ScoreMap;
  advancers: AdvancerMap;
}) {
  const finalMatch = data.ko_matches.find(m => m.round === 'Final');
  let champion: string | null = null;
  let runnerUp: string | null = null;
  if (finalMatch) {
    if (finalMatch.num != null) {
      champion = koWinner(data, scores, advancers, finalMatch.num);
      runnerUp = koLoser(data, scores, advancers, finalMatch.num);
    } else {
      const t1 = resolveSlot(data, scores, advancers, finalMatch.team1);
      const t2 = resolveSlot(data, scores, advancers, finalMatch.team2);
      const sc = scores[finalMatch.id];
      const adv = advancers[finalMatch.id];
      if (t1 && t2 && sc) {
        if (adv === t1) { champion = t1; runnerUp = t2; }
        else if (adv === t2) { champion = t2; runnerUp = t1; }
        else if (sc.team1 > sc.team2) { champion = t1; runnerUp = t2; }
        else if (sc.team2 > sc.team1) { champion = t2; runnerUp = t1; }
      }
    }
  }

  return (
    <div className={`kb-trophy ${champion ? 'is-set' : ''}`}>
      <div className="kb-trophy-icon">🏆</div>
      <div className="kb-trophy-label">2026 Champion</div>
      <div className="kb-trophy-name">
        {champion ? <><Flag team={champion} /> {champion}</> : '?'}
      </div>
      {champion && runnerUp && (
        <div className="kb-trophy-sub">defeated {runnerUp} in the final</div>
      )}
    </div>
  );
}
