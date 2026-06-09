import { Flag } from '@/components/Flag';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { resolveSlot, koWinner, koLoser } from '@/lib/tournament';
import type { AdvancerMap, ScoreMap } from '@/lib/types';

export function ChampionCard() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  if (!dataQ.data) return null;

  const scores: ScoreMap = {};
  const advancers: AdvancerMap = {};
  if (resultsQ.data) {
    for (const [id, r] of Object.entries(resultsQ.data)) {
      scores[id] = { team1: r.team1_score, team2: r.team2_score };
      advancers[id] = r.advancer ?? null;
    }
  }

  const finalMatch = dataQ.data.ko_matches.find(m => m.round === 'Final');
  const thirdMatch = dataQ.data.ko_matches.find(m => m.round === 'Match for third place');

  let champion: string | null = null;
  let runnerUp: string | null = null;
  if (finalMatch && finalMatch.num != null) {
    champion = koWinner(dataQ.data, scores, advancers, finalMatch.num);
    runnerUp = koLoser(dataQ.data, scores, advancers, finalMatch.num);
  } else if (finalMatch) {
    // Final has no num in source data; resolve via match id.
    const t1 = resolveSlot(dataQ.data, scores, advancers, finalMatch.team1);
    const t2 = resolveSlot(dataQ.data, scores, advancers, finalMatch.team2);
    const sc = scores[finalMatch.id];
    const adv = advancers[finalMatch.id];
    if (t1 && t2 && sc) {
      if (adv === t1) { champion = t1; runnerUp = t2; }
      else if (adv === t2) { champion = t2; runnerUp = t1; }
      else if (sc.team1 > sc.team2) { champion = t1; runnerUp = t2; }
      else if (sc.team2 > sc.team1) { champion = t2; runnerUp = t1; }
    }
  }

  let third: string | null = null;
  if (thirdMatch) {
    const t1 = resolveSlot(dataQ.data, scores, advancers, thirdMatch.team1);
    const t2 = resolveSlot(dataQ.data, scores, advancers, thirdMatch.team2);
    const sc = scores[thirdMatch.id];
    const adv = advancers[thirdMatch.id];
    if (t1 && t2 && sc) {
      if (adv === t1 || adv === t2) third = adv;
      else if (sc.team1 > sc.team2) third = t1;
      else if (sc.team2 > sc.team1) third = t2;
    }
  }

  return (
    <div className="champion-card">
      <div className="confetti" aria-hidden />
      <div className="trophy">🏆</div>
      <div className="champion-label">2026 Champion</div>
      <div className="champion-name">
        {champion ? <><Flag team={champion} /> {champion}</> : '—'}
      </div>
      <div className="champion-sub">
        {champion && runnerUp ? `defeated ${runnerUp} in the final` : 'Fill in the final to crown a winner'}
      </div>
      <div className="podium">
        <div className="podium-step second">
          <div className="podium-label">Runner-up</div>
          <div className="podium-name">{runnerUp ? <><Flag team={runnerUp} /> {runnerUp}</> : '—'}</div>
        </div>
        <div className="podium-step first">
          <div className="podium-label">Champion</div>
          <div className="podium-name">{champion ? <><Flag team={champion} /> {champion}</> : '—'}</div>
        </div>
        <div className="podium-step third">
          <div className="podium-label">Third place</div>
          <div className="podium-name">{third ? <><Flag team={third} /> {third}</> : '—'}</div>
        </div>
      </div>
    </div>
  );
}
