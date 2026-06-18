import { useEffect, useState, useCallback } from 'react';
import { Flag } from '@/components/Flag';
import { ConsensusPick } from '@/components/ConsensusPick';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPredictions, useUpsertPrediction } from '@/hooks/usePredictions';
import { useResults, useUpsertResult, useDeleteResult } from '@/hooks/useResults';
import { useLiveMatches } from '@/hooks/useLiveMatches';
import { useNow } from '@/hooks/useNow';
import { isLocked, parseKickoff, fmtShortDate } from '@/lib/time';
import { scorePrediction } from '@/lib/scoring';
import { useUI } from '@/lib/ui-store';

/** Reduce country-name pairs that differ between data.json and FD to a
 *  single canonical lowercased string, so the live-score orientation
 *  check works without a full alias map round-trip. */
function normalizeNation(name: string): string {
  const ALIASES: Record<string, string> = {
    'czechia': 'czech republic',
    'bosnia-herzegovina': 'bosnia & herzegovina',
    'cape verde islands': 'cape verde',
    'congo dr': 'dr congo',
    'united states': 'usa',
  };
  const lower = name.trim().toLowerCase();
  return ALIASES[lower] ?? lower;
}

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
  const { user, isAdmin } = useAuth();
  const adminMode = useUI(s => s.adminMode);
  // The admin can toggle out of admin mode to see the site as a regular user
  // (no actual-result inputs, no admin tab). Effective admin = both true.
  const adminActive = isAdmin && adminMode;
  const myPredsQ = useMyPredictions();
  const resultsQ = useResults();
  const liveQ = useLiveMatches();
  const upsertPred = useUpsertPrediction();
  const upsertRes = useUpsertResult();
  const deleteRes = useDeleteResult();

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
  const [actA, setActA] = useState('');
  const [actB, setActB] = useState('');
  const [actAdv, setActAdv] = useState('');

  useEffect(() => {
    setA(myPred ? String(myPred.team1_score) : '');
    setB(myPred ? String(myPred.team2_score) : '');
    setAdv(myPred?.advancer ?? '');
  }, [myPred?.team1_score, myPred?.team2_score, myPred?.advancer]);
  useEffect(() => {
    setActA(result ? String(result.team1_score) : '');
    setActB(result ? String(result.team2_score) : '');
    setActAdv(result?.advancer ?? '');
  }, [result?.team1_score, result?.team2_score, result?.advancer]);

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

  const saveResult = useCallback((overrides?: { advancer?: string }) => {
    if (!adminActive) return;
    const x = parseInt(actA, 10), y = parseInt(actB, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const finalAdv = overrides?.advancer ?? actAdv;
    if (result && result.team1_score === x && result.team2_score === y && (result.advancer ?? '') === finalAdv) return;
    upsertRes.mutate({ match_id: matchId, team1_score: x, team2_score: y, advancer: finalAdv || null });
  }, [adminActive, actA, actB, actAdv, result, matchId, upsertRes]);

  const clearResult = useCallback(() => {
    if (!adminActive || !result) return;
    setActA(''); setActB(''); setActAdv('');
    deleteRes.mutate(matchId);
  }, [adminActive, result, matchId, deleteRes]);

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
    return {
      left: sameOrder ? ft.home : ft.away,
      right: sameOrder ? ft.away : ft.home,
      phase: live.payload.status === 'PAUSED' ? 'HT' : 'live',
    };
  })();

  return (
    <div className={`mc ${locked ? 'mc-locked' : ''}`}>
      {user ? (
        /* PREDICTION row — the user's own pick, even for admin. */
        <div className="mc-row">
          <div className="mc-team mc-left">
            {team1IsResolved
              ? <><Flag team={team1} /><span className="mc-name">{labelLeft}</span></>
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
              ? <><span className="mc-name">{labelRight}</span><Flag team={team2} /></>
              : <span className="mc-placeholder">{labelRight}</span>}
          </div>
          {result && myPred && (
            <span className={`mc-points pts-${earned}`}>+{earned}</span>
          )}
        </div>
      ) : (
        /* GUEST header — teams + a quiet 'vs' where the score inputs
           would sit. No prediction inputs, no points chip. The score
           reveal still happens via the LIVE / FINAL rows below. */
        <div className="mc-row mc-row-guest">
          <div className="mc-team mc-left">
            {team1IsResolved
              ? <><Flag team={team1} /><span className="mc-name">{labelLeft}</span></>
              : <span className="mc-placeholder">{labelLeft}</span>}
          </div>
          <div className="mc-scores mc-scores-guest">vs</div>
          <div className="mc-team mc-right">
            {team2IsResolved
              ? <><span className="mc-name">{labelRight}</span><Flag team={team2} /></>
              : <span className="mc-placeholder">{labelRight}</span>}
          </div>
        </div>
      )}

      {/* Knockout advancer — only for signed-in users. */}
      {user && isKO && team1IsResolved && team2IsResolved && (
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

      {/* LIVE row — when this match is in progress. Shown to everyone
          including admin (admin still gets the actual-input row below
          to type the final once it ends). Mutually exclusive with the
          "final" read-only row since a finished match isn't live. */}
      {liveScore && (
        <div className="mc-live">
          <span className="mc-live-score-pill">{liveScore.phase}</span>
          <span className="mc-live-score">
            {liveScore.left ?? '–'} – {liveScore.right ?? '–'}
          </span>
        </div>
      )}

      {/* ACTUAL row — admin gets inputs (when admin mode is on), others see read-only result */}
      {adminActive ? (
        <div className="mc-actual mc-actual-admin">
          <span className="mc-actual-label">actual</span>
          <div className="mc-scores">
            <input
              className="mc-input mc-input-actual" type="number" min={0} max={20} inputMode="numeric"
              value={actA}
              onChange={e => setActA(e.target.value)}
              onBlur={() => saveResult()}
              aria-label={`actual ${labelLeft}`}
            />
            <span className="mc-dash">–</span>
            <input
              className="mc-input mc-input-actual" type="number" min={0} max={20} inputMode="numeric"
              value={actB}
              onChange={e => setActB(e.target.value)}
              onBlur={() => saveResult()}
              aria-label={`actual ${labelRight}`}
            />
          </div>
          {result && (
            <button
              type="button"
              className="mc-actual-clear"
              onClick={clearResult}
              disabled={deleteRes.isPending}
              title="Remove this actual result"
              aria-label="Clear actual result"
            >
              clear
            </button>
          )}
          {isKO && team1IsResolved && team2IsResolved && (
            <div className="mc-advancer mc-advancer-admin">
              <span className="mc-advancer-label">advanced</span>
              {[team1, team2].map(t => (
                <button
                  key={t}
                  type="button"
                  className={`mc-advancer-pill ${actAdv === t ? 'on' : ''}`}
                  onClick={() => {
                    setActAdv(t);
                    saveResult({ advancer: t });
                  }}
                >
                  <Flag team={t} /> {t}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        result && !live && (
          <div className="mc-actual">
            <span className="mc-actual-label">final</span>
            <span className="mc-actual-score">{result.team1_score} – {result.team2_score}</span>
          </div>
        )
      )}

      {/* Consensus pick — visible on locked matches for signed-in users */}
      {user && locked && team1IsResolved && team2IsResolved && (
        <ConsensusPick matchId={matchId} team1={team1} team2={team2} />
      )}

      <div className="mc-meta">
        <span className="mc-meta-time">
          {showDate && <>{fmtShortDate(date)} · </>}{kickoffStr} {locked && <span className="mc-lock">· 🔒</span>}
        </span>
        {live && <span className="mc-live-pill">live</span>}
        {roundLabel && <span className="mc-meta-round">{roundLabel}</span>}
        <span className="mc-meta-ground">{ground}</span>
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
    </div>
  );
}
