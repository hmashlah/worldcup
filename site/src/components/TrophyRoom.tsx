import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useProfiles } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';
import { scorePrediction } from '@/lib/scoring';
import { isMatchKO, getOutcome } from '@/lib/utils';
import { allMatches } from '@/lib/days';

interface Trophy {
  emoji: string;
  title: string;
  winner: string;
  detail: string;
  date?: string;
}

export function TrophyRoom() {
  const dataQ = useTournamentData();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const profilesQ = useProfiles();

  const trophies = useMemo<Trophy[] | null>(() => {
    const data = dataQ.data;
    const results = resultsQ.data;
    const profiles = profilesQ.data;
    if (!data || !predsQ.data || !results || !profiles) return null;
    const predictions = predsQ.data as PredictionRow[];

    const approvedIds = new Set(
      Object.values(profiles).filter(p => p.approved).map(p => p.user_id),
    );
    const getName = (uid: string) => profiles[uid]?.display_name ?? 'Unknown';

    // Get finished matches in chronological order
    const chronoMatches = allMatches(data).filter(m => results[m.id]);
    if (chronoMatches.length < 3) return null;

    // Build prediction lookup: userId -> matchId -> PredictionRow
    const predByUser: Record<string, Record<string, PredictionRow>> = {};
    for (const p of predictions) {
      if (!approvedIds.has(p.user_id)) continue;
      if (!predByUser[p.user_id]) predByUser[p.user_id] = {};
      predByUser[p.user_id][p.match_id] = p;
    }

    // Group matches by date
    const matchesByDate: Record<string, typeof chronoMatches> = {};
    for (const m of chronoMatches) {
      if (!matchesByDate[m.date]) matchesByDate[m.date] = [];
      matchesByDate[m.date].push(m);
    }
    const sortedDates = Object.keys(matchesByDate).sort();

    const trophyList: Trophy[] = [];

    // ─── Per-matchday: Matchday King ───────────────────────────────
    for (const date of sortedDates) {
      const dayMatches = matchesByDate[date];
      let bestPlayer = '';
      let bestPts = 0;

      for (const userId of approvedIds) {
        const userPreds = predByUser[userId] ?? {};
        let dayTotal = 0;
        for (const m of dayMatches) {
          const pred = userPreds[m.id];
          const result = results[m.id];
          if (pred && result) {
            dayTotal += scorePrediction(
              { team1: pred.team1_score, team2: pred.team2_score },
              { team1: result.team1_score, team2: result.team2_score },
              isMatchKO(data, m.id),
              pred.advancer,
              result.advancer,
            );
          }
        }
        if (dayTotal > bestPts) {
          bestPts = dayTotal;
          bestPlayer = userId;
        }
      }

      if (bestPlayer && bestPts > 0) {
        const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        trophyList.push({
          emoji: '👑',
          title: 'Matchday King',
          winner: getName(bestPlayer),
          detail: `${bestPts}pts`,
          date: dateLabel,
        });
      }
    }

    // ─── Psychic — first exact score on a shock result (team2 win or draw where >60% picked team1) ───
    for (const m of chronoMatches) {
      const result = results[m.id];
      if (!result) continue;
      const actualOutcome = getOutcome(result.team1_score, result.team2_score);

      // Count outcome predictions
      let t1Count = 0, totalPreds = 0;
      for (const userId of approvedIds) {
        const pred = predByUser[userId]?.[m.id];
        if (!pred) continue;
        totalPreds++;
        if (getOutcome(pred.team1_score, pred.team2_score) === 't1') t1Count++;
      }

      // Is it a shock? (majority predicted t1 but actual wasn't t1)
      if (totalPreds < 3 || t1Count <= totalPreds * 0.6 || actualOutcome === 't1') continue;

      // Find who got it exact
      for (const userId of approvedIds) {
        const pred = predByUser[userId]?.[m.id];
        if (pred && pred.team1_score === result.team1_score && pred.team2_score === result.team2_score) {
          const dateLabel = new Date(m.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          trophyList.push({
            emoji: '🔮',
            title: 'Psychic',
            winner: getName(userId),
            detail: `${m.team1} ${result.team1_score}-${result.team2_score} ${m.team2}`,
            date: dateLabel,
          });
          break; // Only first person
        }
      }
    }

    // ─── Contrarian — picked against consensus and was right ─────────
    for (const m of chronoMatches) {
      const result = results[m.id];
      if (!result) continue;
      const actualOutcome = getOutcome(result.team1_score, result.team2_score);

      const outcomeCounts: Record<string, number> = { t1: 0, draw: 0, t2: 0 };
      let totalPreds = 0;
      const matchPreds: Array<{ userId: string; outcome: string }> = [];

      for (const userId of approvedIds) {
        const pred = predByUser[userId]?.[m.id];
        if (!pred) continue;
        const o = getOutcome(pred.team1_score, pred.team2_score);
        outcomeCounts[o]++;
        totalPreds++;
        matchPreds.push({ userId, outcome: o });
      }

      if (totalPreds < 4) continue;

      // Find minority outcome that matches actual
      const majorityPct = Math.max(...Object.values(outcomeCounts)) / totalPreds;
      if (majorityPct < 0.6) continue; // No clear majority

      for (const { userId, outcome } of matchPreds) {
        const pct = outcomeCounts[outcome] / totalPreds;
        if (pct <= 0.25 && outcome === actualOutcome) {
          const dateLabel = new Date(m.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          trophyList.push({
            emoji: '🎲',
            title: 'Contrarian',
            winner: getName(userId),
            detail: `${m.team1} vs ${m.team2}`,
            date: dateLabel,
          });
          break;
        }
      }
    }

    // ─── Cursed — longest streak without any points ──────────────────
    let cursedPlayer = '';
    let cursedStreak = 0;

    for (const userId of approvedIds) {
      const userPreds = predByUser[userId] ?? {};
      let currentDry = 0;
      let maxDry = 0;
      for (const m of chronoMatches) {
        const pred = userPreds[m.id];
        const result = results[m.id];
        if (pred && result) {
          const pts = scorePrediction(
            { team1: pred.team1_score, team2: pred.team2_score },
            { team1: result.team1_score, team2: result.team2_score },
            isMatchKO(data, m.id),
            pred.advancer,
            result.advancer,
          );
          if (pts === 0) {
            currentDry++;
            if (currentDry > maxDry) maxDry = currentDry;
          } else {
            currentDry = 0;
          }
        }
      }
      if (maxDry > cursedStreak) {
        cursedStreak = maxDry;
        cursedPlayer = userId;
      }
    }

    if (cursedPlayer && cursedStreak >= 3) {
      trophyList.push({
        emoji: '💀',
        title: 'Cursed',
        winner: getName(cursedPlayer),
        detail: `${cursedStreak} matches with 0pts`,
      });
    }

    // ─── Comeback Kid — biggest single-day points swing (worst day → next day best improvement) ───
    let comebackPlayer = '';
    let comebackSwing = 0;
    let comebackDate = '';

    for (let i = 1; i < sortedDates.length; i++) {
      const prevDate = sortedDates[i - 1];
      const currDate = sortedDates[i];
      const prevMatches = matchesByDate[prevDate];
      const currMatches = matchesByDate[currDate];

      for (const userId of approvedIds) {
        const userPreds = predByUser[userId] ?? {};
        let prevPts = 0, currPts = 0;
        for (const m of prevMatches) {
          const pred = userPreds[m.id]; const result = results[m.id];
          if (pred && result) prevPts += scorePrediction({ team1: pred.team1_score, team2: pred.team2_score }, { team1: result.team1_score, team2: result.team2_score }, isMatchKO(data, m.id), pred.advancer, result.advancer);
        }
        for (const m of currMatches) {
          const pred = userPreds[m.id]; const result = results[m.id];
          if (pred && result) currPts += scorePrediction({ team1: pred.team1_score, team2: pred.team2_score }, { team1: result.team1_score, team2: result.team2_score }, isMatchKO(data, m.id), pred.advancer, result.advancer);
        }
        const swing = currPts - prevPts;
        if (swing > comebackSwing && prevPts === 0 && currPts > 0) {
          comebackSwing = swing;
          comebackPlayer = userId;
          comebackDate = currDate;
        }
      }
    }

    if (comebackPlayer && comebackSwing > 0) {
      const dateLabel = new Date(comebackDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      trophyList.push({
        emoji: '🚀',
        title: 'Comeback Kid',
        winner: getName(comebackPlayer),
        detail: `0 → ${comebackSwing}pts`,
        date: dateLabel,
      });
    }

    // ─── The Wall — most correct clean sheet predictions (0-X or X-0) ───
    const wallCounts: Record<string, number> = {};
    for (const userId of approvedIds) {
      const userPreds = predByUser[userId] ?? {};
      let count = 0;
      for (const m of chronoMatches) {
        const pred = userPreds[m.id];
        const result = results[m.id];
        if (!pred || !result) continue;
        const resultHasCS = result.team1_score === 0 || result.team2_score === 0;
        const predHasCS = pred.team1_score === 0 || pred.team2_score === 0;
        if (resultHasCS && predHasCS && (
          (pred.team1_score === result.team1_score && pred.team2_score === result.team2_score) ||
          (pred.team1_score === 0 && result.team1_score === 0) ||
          (pred.team2_score === 0 && result.team2_score === 0)
        )) {
          count++;
        }
      }
      wallCounts[userId] = count;
    }
    const wallEntry = Object.entries(wallCounts).sort((a, b) => b[1] - a[1])[0];
    if (wallEntry && wallEntry[1] >= 2) {
      trophyList.push({
        emoji: '🧱',
        title: 'The Wall',
        winner: getName(wallEntry[0]),
        detail: `${wallEntry[1]} clean sheets called`,
      });
    }

    return trophyList.length > 0 ? trophyList : null;
  }, [dataQ.data, predsQ.data, resultsQ.data, profilesQ.data]);

  if (!trophies || trophies.length === 0) return null;

  return (
    <div className="trophy-room">
      <div className="trophy-room-header">
        <span className="trophy-room-title">Trophy Room</span>
        <span className="trophy-room-subtitle">Matchday highlights & milestones</span>
      </div>
      <div className="trophy-grid">
        {trophies.map((t, i) => (
          <div className="trophy-card" key={`${t.title}-${i}`}>
            <span className="trophy-emoji">{t.emoji}</span>
            <div className="trophy-info">
              <span className="trophy-title">{t.title}</span>
              <span className="trophy-winner">{t.winner}</span>
              <span className="trophy-detail">{t.detail}</span>
            </div>
            {t.date && <span className="trophy-date">{t.date}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
