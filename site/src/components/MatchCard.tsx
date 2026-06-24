import { useEffect, useState, useCallback } from 'react';
import { Flag } from '@/components/Flag';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPredictions, useUpsertPrediction } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useLiveMatches } from '@/hooks/useLiveMatches';
import { useNow } from '@/hooks/useNow';
import { isLocked, parseKickoff, fmtShortDate } from '@/lib/time';
import { scorePrediction } from '@/lib/scoring';
import { normalizeNation } from '@/lib/utils';
import { useUI } from '@/lib/ui-store';
import { PicksRevealModal } from '@/components/PicksRevealModal';

interface Props {
  matchId: string;
  team1: string;
  team2: string;
  team1IsResolved: boolean;
  team2IsResolved: boolean;
  team1Placeholder?: string;
  team2Placeholder?: string;
  date: string;
  time: string;
  ground: string;
  isKO?: boolean;
  /** Show the round name (e.g. "Round of 16") in meta. */
  roundLabel?: string;
  /** Show the calendar date alongside the kickoff time in meta. Off by default
   *  because callers like DayView already group matches under a date header. */
  showDate?: boolean;
}

/**
 * Compact match card.
 *
 * Top row = the user's PREDICTION (for everyone, including admin):
 *   flag · team1 · [score] – [score] · team2 · flag · +pts chip
 *
 * For admin, an "actual" row appears right under prediction inputs with
 * its own pair of inputs writing to match_results. For non-admin, after
 * an actual exists, that same row shows the result as plain text.
 *
 * Knockouts add an advancer row (radio pills) below the scores.
 */
export function MatchCard(p: Props) {
  const {
    matchId, team1, team2, team1IsResolved, team2IsResolved,
    team1Placeholder, team2Placeholder, date, time, ground,
    isKO = false, roundLabel, showDate = false,
  } = p;
  const { user } = useAuth();
  const myPredsQ = useMyPredictions();
  const resultsQ = useResults();
  const liveQ = useLiveMatches();
  const upsertPred = useUpsertPrediction();

  // In spectator mode, treat as if not logged in for prediction UI
  const showPredictions = !!user;

  // Re-render every 30s so a card open at 12:59 visibly locks at kickoff
  // without needing user interaction.
  const now = useNow(30_000);
  const locked = isLocked(date, time, now);
  const myPred = myPredsQ.data?.[matchId];
  const result = resultsQ.data?.[matchId];
  const live = liveQ.data?.[matchId];

  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [adv, setAdv] = useState('');
  const [picksOpen, setPicksOpen] = useState(false);

  useEffect(() => {
    setA(myPred ? String(myPred.team1_score) : '');
    setB(myPred ? String(myPred.team2_score) : '');
    setAdv(myPred?.advancer ?? '');
  }, [myPred?.team1_score, myPred?.team2_score, myPred?.advancer]);

  const savePred = useCallback((overrides?: { advancer?: string }) => {
    if (!user) return;
    // Re-check the lock against the live clock — `locked` from render could
    // be up to ~30s stale, and a determined user could trigger save (blur,
    // Enter) within that window.
    if (isLocked(date, time)) return;
    const x = parseInt(a, 10), y = parseInt(b, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const finalAdv = overrides?.advancer ?? adv;
    if (myPred && myPred.team1_score === x && myPred.team2_score === y && (myPred.advancer ?? '') === finalAdv) return;
    upsertPred.mutate({ match_id: matchId, team1_score: x, team2_score: y, advancer: finalAdv || null });
  }, [user, date, time, a, b, adv, myPred, matchId, upsertPred]);

  const earned = scorePrediction(
    myPred ? { team1: myPred.team1_score, team2: myPred.team2_score } : null,
    result ? { team1: result.team1_score, team2: result.team2_score } : null,
    isKO,
    myPred?.advancer,
    result?.advancer,
  );

  const labelLeft = team1IsResolved ? team1 : (team1Placeholder ?? team1);
  const labelRight = team2IsResolved ? team2 : (team2Placeholder ?? team2);
  const kickoffDate = parseKickoff(date, time);
  const kickoffStr = kickoffDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Hide the Details link on KO matches with a TBD slot — without both
  // teams confirmed, the head-to-head section has nothing meaningful to
  // show. Group-stage cards always have both teams resolved.
  const showDetails = team1IsResolved && team2IsResolved;
  const openMatch = useUI(s => s.openMatch);
  const openTeam = useUI(s => s.openTeam);

  // Live score for this match, if any. FD's home/away may not match our
  // team1/team2 — flip the displayed scoreline if it doesn't.
  const liveScore = (() => {
    if (!live) return null;
    const ft = live.payload.score?.fullTime;
    if (!ft) return null;
    const fdHomeName = (live.payload.homeTeam?.name ?? '').toLowerCase();
    const ourTeam1 = team1.toLowerCase();
    // Cheap orientation check — if FD home matches our team1, scoreline
    // is in our orientation; otherwise flip. Doesn't need the full alias
    // map because every team name in the live payload comes back from
    // the same FD instance and our team1 was matched against FD at
    // mapping-build time anyway.
    const sameOrder = fdHomeName === ourTeam1
      || normalizeNation(fdHomeName) === normalizeNation(ourTeam1);

    // Compute approximate match minute from kickoff time.
    // FD free tier doesn't provide the minute field, so we derive it.
    // Real-time stoppages: 3 min drink break per half + 15 min HT break.
    // Total real time for 90 match minutes:
    //   1H: 48 min (45 play + 3 drink) + HT: 15 min + 2H: 48 min (45 play + 3 drink) = 111 min
    const phase = (() => {
      if (live.payload.status === 'PAUSED') return 'HT';
      const kickoffMs = new Date(live.payload.utcDate).getTime();
      const elapsedMin = Math.floor((now - kickoffMs) / 60_000);
      const ht = live.payload.score?.halfTime;
      const inSecondHalf = ht && ht.home !== null && ht.away !== null;
      if (inSecondHalf) {
        // 2H starts at real elapsed ~63 min (48 min 1H + 15 min HT)
        // Match minute = 45 + (elapsed - 63) adjusted for 2H drink break at ~30 min into 2H
        const secondHalfElapsed = elapsedMin - 63;
        let matchMin = 45 + secondHalfElapsed;
        // Subtract drink break after ~30 real min into 2H (i.e. around 75')
        if (secondHalfElapsed > 33) matchMin -= 3;
        matchMin = Math.max(46, matchMin);
        return matchMin > 90 ? `90+${matchMin - 90}'` : `${matchMin}'`;
      }
      // First half: subtract drink break after ~30 real min
      let matchMin = elapsedMin;
      if (matchMin > 33) matchMin -= 3;
      matchMin = Math.max(1, Math.min(matchMin, 45));
      return matchMin >= 45 ? '45+' : `${matchMin}'`;
    })();

    return {
      left: sameOrder ? ft.home : ft.away,
      right: sameOrder ? ft.away : ft.home,
      phase,
    };
  })();

  return (
    <div className={`mc ${locked ? 'mc-locked' : ''}`}>
      {showPredictions ? (
        /* PREDICTION row — the user's own pick. */
        <div className="mc-row mc-row-guest">
          <div className="mc-team mc-left">
            {team1IsResolved
              ? <><Flag team={team1} /><span className="mc-name team-link" onClick={() => openTeam(team1)}>{labelLeft}</span></>
              : <span className="mc-placeholder">{labelLeft}</span>}
          </div>
          <div className="mc-scores">
            <input
              className="mc-input" type="number" min={0} max={20} inputMode="numeric"
              disabled={locked}
              value={a}
              onChange={e => setA(e.target.value)}
              onBlur={() => savePred()}
              aria-label={`your prediction ${labelLeft}`}
            />
            <span className="mc-dash">–</span>
            <input
              className="mc-input" type="number" min={0} max={20} inputMode="numeric"
              disabled={locked}
              value={b}
              onChange={e => setB(e.target.value)}
              onBlur={() => savePred()}
              aria-label={`your prediction ${labelRight}`}
            />
          </div>
          <div className="mc-team mc-right">
            {team2IsResolved
              ? <><span className="mc-name team-link" onClick={() => openTeam(team2)}>{labelRight}</span><Flag team={team2} /></>
              : <span className="mc-placeholder">{labelRight}</span>}
          </div>
        </div>
      ) : (
        /* GUEST / SPECTATOR header — teams + a quiet 'vs'. No prediction
           inputs, no points chip. */
        <div className="mc-row mc-row-guest">
          <div className="mc-team mc-left">
            {team1IsResolved
              ? <><Flag team={team1} /><span className="mc-name team-link" onClick={() => openTeam(team1)}>{labelLeft}</span></>
              : <span className="mc-placeholder">{labelLeft}</span>}
          </div>
          <div className="mc-scores mc-scores-guest">vs</div>
          <div className="mc-team mc-right">
            {team2IsResolved
              ? <><span className="mc-name team-link" onClick={() => openTeam(team2)}>{labelRight}</span><Flag team={team2} /></>
              : <span className="mc-placeholder">{labelRight}</span>}
          </div>
        </div>
      )}

      {/* Knockout advancer — only in prediction mode. */}
      {showPredictions && isKO && team1IsResolved && team2IsResolved && (
        <div className="mc-advancer">
          <span className="mc-advancer-label">your pick advances</span>
          {[team1, team2].map(t => (
            <button
              key={t}
              type="button"
              className={`mc-advancer-pill ${adv === t ? 'on' : ''}`}
              disabled={locked}
              onClick={() => {
                setAdv(t);
                savePred({ advancer: t });
              }}
            >
              <Flag team={t} /> {t}
            </button>
          ))}
        </div>
      )}

      {/* LIVE row — match in progress, same centered layout as FT */}
      {liveScore && (
        <div className="mc-result mc-result-live">
          <span className="mc-result-label mc-live-label">{liveScore.phase}</span>
          <span className="mc-result-score mc-live-score">
            {liveScore.left ?? '–'} – {liveScore.right ?? '–'}
          </span>
        </div>
      )}

      {/* Result — centered final score with FT label above + points chip */}
      {result && !live && (
        <div className="mc-result">
          <span className="mc-result-label">FT</span>
          <span className="mc-result-score">{result.team1_score} – {result.team2_score}</span>
          {showPredictions && myPred && (
            <span className={`mc-points pts-${earned}`}>+{earned}</span>
          )}
        </div>
      )}

      <div className="mc-ground">{ground}</div>

      <div className="mc-meta">
        <span className="mc-meta-time">
          {showDate && <>{fmtShortDate(date)} · </>}{kickoffStr}
          {showPredictions && (
            locked
              ? <span className="mc-lock"> · 🔒</span>
              : (() => {
                  const diff = kickoffDate.getTime() - now;
                  if (diff <= 0) return null;
                  const d = Math.floor(diff / 86_400_000);
                  const h = Math.floor((diff % 86_400_000) / 3_600_000);
                  const m = Math.floor((diff % 3_600_000) / 60_000);
                  let label: string;
                  if (d > 0) label = `${d}d ${h}h`;
                  else if (h > 0) label = `${h}h ${m}m`;
                  else label = `${m}m`;
                  return <span className="mc-countdown"> · locks in {label}</span>;
                })()
          )}
        </span>
        {live && <span className="mc-live-pill">live</span>}
        {roundLabel && <span className="mc-meta-round">{roundLabel}</span>}
        {locked && user && team1IsResolved && team2IsResolved && (
          <button
            type="button"
            className="mc-picks-btn"
            onClick={() => setPicksOpen(true)}
          >
            picks
          </button>
        )}
        {showDetails && (
          <button
            type="button"
            className="mc-details-link"
            onClick={() => openMatch(matchId)}
            aria-label="Match details"
          >
            details →
          </button>
        )}
      </div>
      {picksOpen && (
        <PicksRevealModal
          matchId={matchId}
          team1={team1}
          team2={team2}
          onClose={() => setPicksOpen(false)}
        />
      )}
    </div>
  );
}
