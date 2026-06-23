import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useProfiles } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';
import { scorePrediction } from '@/lib/scoring';
import { allMatches } from '@/lib/days';
import { isMatchKO, getOutcome } from '@/lib/utils';

interface Award {
  emoji: string;
  name: string;
  winner: string;
  stat: string;
}

export function SeasonAwards() {
  const dataQ = useTournamentData();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const profilesQ = useProfiles();

  const awards = useMemo<Award[] | null>(() => {
    if (!dataQ.data || !predsQ.data || !resultsQ.data || !profilesQ.data) return null;

    const data = dataQ.data;
    const results = resultsQ.data;
    const profiles = profilesQ.data;
    const predictions = predsQ.data as PredictionRow[];

    // Only approved users
    const approvedIds = new Set(
      Object.values(profiles).filter(p => p.approved).map(p => p.user_id),
    );

    // Get finished matches in chronological order
    const chronoMatches = allMatches(data).filter(m => results[m.id]);
    if (chronoMatches.length < 5) return null;

    // Build prediction lookup: userId -> matchId -> PredictionRow
    const predByUser: Record<string, Record<string, PredictionRow>> = {};
    for (const p of predictions) {
      if (!approvedIds.has(p.user_id)) continue;
      if (!predByUser[p.user_id]) predByUser[p.user_id] = {};
      predByUser[p.user_id][p.match_id] = p;
    }

    // ---------- 1. Sharpshooter — most exact score predictions ----------
    const exactCounts: Record<string, number> = {};
    for (const userId of approvedIds) {
      const userPreds = predByUser[userId] ?? {};
      let count = 0;
      for (const m of chronoMatches) {
        const pred = userPreds[m.id];
        const result = results[m.id];
        if (pred && result &&
            pred.team1_score === result.team1_score &&
            pred.team2_score === result.team2_score) {
          count++;
        }
      }
      exactCounts[userId] = count;
    }

    // ---------- 2. Best Day — highest single-day points total ----------
    // Group matches by date, compute per-player per-day points
    const matchesByDate: Record<string, typeof chronoMatches> = {};
    for (const m of chronoMatches) {
      if (!matchesByDate[m.date]) matchesByDate[m.date] = [];
      matchesByDate[m.date].push(m);
    }

    let bestDayPlayer = '';
    let bestDayDate = '';
    let bestDayPts = 0;

    for (const [date, dayMatches] of Object.entries(matchesByDate)) {
      for (const userId of approvedIds) {
        const userPreds = predByUser[userId] ?? {};
        let dayTotal = 0;
        for (const m of dayMatches) {
          const pred = userPreds[m.id];
          const result = results[m.id];
          if (pred && result) {
            const isKO = isMatchKO(data, m.id);
            dayTotal += scorePrediction(
              { team1: pred.team1_score, team2: pred.team2_score },
              { team1: result.team1_score, team2: result.team2_score },
              isKO,
              pred.advancer,
              result.advancer,
            );
          }
        }
        if (dayTotal > bestDayPts) {
          bestDayPts = dayTotal;
          bestDayPlayer = userId;
          bestDayDate = date;
        }
      }
    }

    // ---------- 3. Oracle — longest prediction streak (consecutive matches with ≥1pt) ----------
    let oraclePlayer = '';
    let oracleStreak = 0;

    for (const userId of approvedIds) {
      const userPreds = predByUser[userId] ?? {};
      let currentStreak = 0;
      let maxStreak = 0;
      for (const m of chronoMatches) {
        const pred = userPreds[m.id];
        const result = results[m.id];
        if (pred && result) {
          const isKO = isMatchKO(data, m.id);
          const pts = scorePrediction(
            { team1: pred.team1_score, team2: pred.team2_score },
            { team1: result.team1_score, team2: result.team2_score },
            isKO,
            pred.advancer,
            result.advancer,
          );
          if (pts >= 1) {
            currentStreak++;
            if (currentStreak > maxStreak) maxStreak = currentStreak;
          } else {
            currentStreak = 0;
          }
        } else {
          // No prediction counts as breaking the streak
          currentStreak = 0;
        }
      }
      if (maxStreak > oracleStreak) {
        oracleStreak = maxStreak;
        oraclePlayer = userId;
      }
    }

    // ---------- 4. Underdog Whisperer — correct predictions against majority ----------
    const underdogCounts: Record<string, number> = {};

    for (const m of chronoMatches) {
      const result = results[m.id];
      if (!result) continue;
      const actualOutcome = getOutcome(result.team1_score, result.team2_score);

      // Count predictions per outcome for this match
      const outcomeCounts: Record<string, number> = { t1: 0, draw: 0, t2: 0 };
      let totalPreds = 0;
      const matchPreds: Array<{ userId: string; outcome: string }> = [];

      for (const userId of approvedIds) {
        const pred = predByUser[userId]?.[m.id];
        if (!pred) continue;
        const predOutcome = getOutcome(pred.team1_score, pred.team2_score);
        outcomeCounts[predOutcome]++;
        totalPreds++;
        matchPreds.push({ userId, outcome: predOutcome });
      }

      if (totalPreds === 0) continue;

      // Determine majority (>50% predicted this outcome)
      let majorityOutcome: string | null = null;
      for (const [outcome, count] of Object.entries(outcomeCounts)) {
        if (count > totalPreds / 2) {
          majorityOutcome = outcome;
          break;
        }
      }

      // No clear majority → skip this match
      if (!majorityOutcome) continue;

      // Credit players who predicted differently AND were correct
      for (const { userId, outcome } of matchPreds) {
        if (outcome !== majorityOutcome && outcome === actualOutcome) {
          underdogCounts[userId] = (underdogCounts[userId] ?? 0) + 1;
        }
      }
    }

    // ---------- 5. Hit Rate King — highest % of predictions scoring any points (min 10 predictions) ----------
    let hitRatePlayer = '';
    let hitRatePct = 0;

    for (const userId of approvedIds) {
      const userPreds = predByUser[userId] ?? {};
      let scored = 0;
      let total = 0;
      for (const m of chronoMatches) {
        const pred = userPreds[m.id];
        const result = results[m.id];
        if (pred && result) {
          total++;
          const isKO = isMatchKO(data, m.id);
          const pts = scorePrediction(
            { team1: pred.team1_score, team2: pred.team2_score },
            { team1: result.team1_score, team2: result.team2_score },
            isKO,
            pred.advancer,
            result.advancer,
          );
          if (pts >= 1) scored++;
        }
      }
      if (total >= 10) {
        const pct = scored / total;
        if (pct > hitRatePct) {
          hitRatePct = pct;
          hitRatePlayer = userId;
        }
      }
    }

    // ---------- Assemble awards ----------
    const getName = (userId: string) => profiles[userId]?.display_name ?? 'Unknown';

    const awardsList: Award[] = [];

    // Sharpshooter
    const sharpshooterEntry = Object.entries(exactCounts).sort((a, b) => b[1] - a[1])[0];
    if (sharpshooterEntry && sharpshooterEntry[1] > 0) {
      awardsList.push({
        emoji: '\uD83C\uDFAF',
        name: 'Sharpshooter',
        winner: getName(sharpshooterEntry[0]),
        stat: `${sharpshooterEntry[1]} exact`,
      });
    }

    // Best Day
    if (bestDayPlayer && bestDayPts > 0) {
      const dateObj = new Date(bestDayDate + 'T00:00:00');
      const dateLabel = dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      awardsList.push({
        emoji: '\uD83D\uDD25',
        name: 'Best Day',
        winner: getName(bestDayPlayer),
        stat: `${dateLabel}, ${bestDayPts}pts`,
      });
    }

    // Oracle
    if (oraclePlayer && oracleStreak > 0) {
      awardsList.push({
        emoji: '\uD83D\uDD2E',
        name: 'Oracle',
        winner: getName(oraclePlayer),
        stat: `${oracleStreak} matches`,
      });
    }

    // Underdog Whisperer
    const underdogEntry = Object.entries(underdogCounts).sort((a, b) => b[1] - a[1])[0];
    if (underdogEntry && underdogEntry[1] > 0) {
      awardsList.push({
        emoji: '\uD83D\uDC3A',
        name: 'Underdog Whisperer',
        winner: getName(underdogEntry[0]),
        stat: `${underdogEntry[1]} upset${underdogEntry[1] === 1 ? '' : 's'}`,
      });
    }

    // Hit Rate King
    if (hitRatePlayer && hitRatePct > 0) {
      awardsList.push({
        emoji: '\uD83D\uDC51',
        name: 'Hit Rate King',
        winner: getName(hitRatePlayer),
        stat: `${Math.round(hitRatePct * 100)}%`,
      });
    }

    return awardsList.length > 0 ? awardsList : null;
  }, [dataQ.data, predsQ.data, resultsQ.data, profilesQ.data]);

  const loading = dataQ.isLoading || predsQ.isLoading || resultsQ.isLoading || profilesQ.isLoading;

  if (loading) return null;

  // Not enough matches yet
  if (awards === null) {
    const results = resultsQ.data;
    const hasData = dataQ.data && results;
    if (!hasData) return null;
    const finishedCount = Object.keys(results).length;
    if (finishedCount > 0 && finishedCount < 5) {
      return (
        <div className="awards-section">
          <div className="awards-locked">
            Awards unlock after more matches
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="awards-section">
      <div className="awards-header">
        <span className="awards-title">Season Awards</span>
      </div>
      <div className="awards-grid">
        {awards.map(award => (
          <div className="award-card" key={award.name}>
            <span className="award-emoji">{award.emoji}</span>
            <div className="award-info">
              <span className="award-name">{award.name}</span>
              <span className="award-winner">{award.winner}</span>
              <span className="award-stat">{award.stat}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
