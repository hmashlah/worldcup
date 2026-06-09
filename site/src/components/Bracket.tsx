import { MatchRow } from '@/components/MatchRow';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { resolveSlot, prettySlot, isKnockoutRound } from '@/lib/tournament';
import type { AdvancerMap, KoMatch, ScoreMap } from '@/lib/types';

const COLS: Array<{ title: string; rounds: string[]; cls: string }> = [
  { title: 'Round of 32',     rounds: ['Round of 32'],                          cls: 'r32' },
  { title: 'Round of 16',     rounds: ['Round of 16'],                          cls: 'r16' },
  { title: 'Quarter-finals',  rounds: ['Quarter-final'],                        cls: 'qf'  },
  { title: 'Semi-finals',     rounds: ['Semi-final'],                           cls: 'sf'  },
  { title: 'Final',           rounds: ['Final', 'Match for third place'],      cls: 'final' },
];

export function Bracket() {
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

  return (
    <div className="bracket-wrap">
      <div className="bracket">
        {COLS.map(c => (
          <div className={`bracket-col ${c.cls}`} key={c.title}>
            <div className="col-title">{c.title}</div>
            {dataQ.data!.ko_matches
              .filter(m => c.rounds.includes(m.round))
              .map(m => (
                <KoCard key={m.id} match={m} scores={scores} advancers={advancers} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function KoCard({ match, scores, advancers }: { match: KoMatch; scores: ScoreMap; advancers: AdvancerMap }) {
  const dataQ = useTournamentData();
  if (!dataQ.data) return null;
  const t1 = resolveSlot(dataQ.data, scores, advancers, match.team1);
  const t2 = resolveSlot(dataQ.data, scores, advancers, match.team2);
  const isFinal = match.round === 'Final';
  return (
    <div className={`ko-card ${isFinal ? 'ko-card-final' : ''}`}>
      {match.num !== null && <div className="ko-num">M{match.num}</div>}
      <MatchRow
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
        variant="ko"
      />
    </div>
  );
}
