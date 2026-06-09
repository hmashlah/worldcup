import { useEffect, useState, useCallback } from 'react';
import { Flag } from '@/components/Flag';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPredictions, useUpsertPrediction } from '@/hooks/usePredictions';
import { useResults, useUpsertResult } from '@/hooks/useResults';
import { isLocked, fmtShortDate, parseKickoff } from '@/lib/time';
import { scorePrediction } from '@/lib/scoring';

interface Props {
  matchId: string;
  team1: string; // resolved team name (post slot resolution); may be a placeholder string
  team2: string;
  team1IsResolved: boolean;
  team2IsResolved: boolean;
  team1Placeholder?: string; // shown when team1IsResolved is false
  team2Placeholder?: string;
  date: string;
  time: string;
  ground: string;
  isKO?: boolean;
  /** For knockouts: list of [team1Resolved, team2Resolved] for advancer radio. */
  // (Resolved teams are already passed in via team1/team2 when isKO=true.)
  /** Compact layout — used inside KO cards. */
  variant?: 'group' | 'ko';
  /** Show meta (date / ground) line. Default true. */
  showMeta?: boolean;
  /** Show actual-result column. Default true. Hidden on knockout cards
   * inside the bracket (rendered in a separate detail view). */
}

export function MatchRow(props: Props) {
  const {
    matchId, team1, team2, team1IsResolved, team2IsResolved,
    team1Placeholder, team2Placeholder,
    date, time, ground, isKO = false, variant = 'group', showMeta = true,
  } = props;
  const { user, isAdmin } = useAuth();
  const myPredsQ = useMyPredictions();
  const resultsQ = useResults();
  const upsertPred = useUpsertPrediction();
  const upsertRes = useUpsertResult();

  const locked = isLocked(date, time);
  const myPred = myPredsQ.data?.[matchId];
  const result = resultsQ.data?.[matchId];

  // Local input state for predictions (so typing isn't laggy and we can debounce save).
  const [predA, setPredA] = useState<string>('');
  const [predB, setPredB] = useState<string>('');
  const [advancer, setAdvancer] = useState<string>('');

  useEffect(() => {
    setPredA(myPred ? String(myPred.team1_score) : '');
    setPredB(myPred ? String(myPred.team2_score) : '');
    setAdvancer(myPred?.advancer ?? '');
  }, [myPred?.team1_score, myPred?.team2_score, myPred?.advancer]);

  // Local state for actuals (admin only).
  const [actA, setActA] = useState<string>('');
  const [actB, setActB] = useState<string>('');
  const [actAdv, setActAdv] = useState<string>('');
  useEffect(() => {
    setActA(result ? String(result.team1_score) : '');
    setActB(result ? String(result.team2_score) : '');
    setActAdv(result?.advancer ?? '');
  }, [result?.team1_score, result?.team2_score, result?.advancer]);

  const savePrediction = useCallback(() => {
    if (!user || locked) return;
    const a = parseInt(predA, 10);
    const b = parseInt(predB, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    if (myPred && myPred.team1_score === a && myPred.team2_score === b
        && (myPred.advancer ?? '') === advancer) return;
    upsertPred.mutate({ match_id: matchId, team1_score: a, team2_score: b, advancer: advancer || null });
  }, [user, locked, predA, predB, advancer, myPred, matchId, upsertPred]);

  const saveResult = useCallback(() => {
    if (!isAdmin) return;
    const a = parseInt(actA, 10);
    const b = parseInt(actB, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    if (result && result.team1_score === a && result.team2_score === b
        && (result.advancer ?? '') === actAdv) return;
    upsertRes.mutate({ match_id: matchId, team1_score: a, team2_score: b, advancer: actAdv || null });
  }, [isAdmin, actA, actB, actAdv, result, matchId, upsertRes]);

  const earned = scorePrediction(
    myPred ? { team1: myPred.team1_score, team2: myPred.team2_score } : null,
    result ? { team1: result.team1_score, team2: result.team2_score } : null,
    isKO,
    myPred?.advancer,
    result?.advancer,
  );

  const labelLeft  = team1IsResolved ? team1 : (team1Placeholder ?? team1);
  const labelRight = team2IsResolved ? team2 : (team2Placeholder ?? team2);

  return (
    <div className={`mr ${variant === 'ko' ? 'mr-ko' : 'mr-group'} ${locked ? 'mr-locked' : ''}`}>
      <div className="mr-row mr-fixture">
        <div className="mr-team mr-left">
          {team1IsResolved
            ? <><Flag team={team1} /><span className="mr-name">{labelLeft}</span></>
            : <span className="mr-placeholder">{labelLeft}</span>}
        </div>
        <span className="mr-vs">vs</span>
        <div className="mr-team mr-right">
          {team2IsResolved
            ? <><span className="mr-name">{labelRight}</span><Flag team={team2} /></>
            : <span className="mr-placeholder">{labelRight}</span>}
        </div>
      </div>

      <div className="mr-grid">
        {/* Your prediction */}
        <div className={`mr-cell mr-pred ${!user ? 'mr-disabled' : ''}`}>
          <div className="mr-cell-label">your pick</div>
          <div className="mr-score-input">
            <input
              type="number" min={0} max={20} inputMode="numeric"
              value={predA} disabled={!user || locked}
              onChange={e => setPredA(e.target.value)}
              onBlur={savePrediction}
              aria-label={`your prediction ${labelLeft}`}
            />
            <span className="mr-dash">–</span>
            <input
              type="number" min={0} max={20} inputMode="numeric"
              value={predB} disabled={!user || locked}
              onChange={e => setPredB(e.target.value)}
              onBlur={savePrediction}
              aria-label={`your prediction ${labelRight}`}
            />
          </div>
          {locked && user && !myPred && (
            <div className="mr-locked-note">locked — no pick</div>
          )}
        </div>

        {/* Actual result */}
        <div className="mr-cell mr-actual">
          <div className="mr-cell-label">actual</div>
          {isAdmin ? (
            <div className="mr-score-input">
              <input
                type="number" min={0} max={20} inputMode="numeric"
                value={actA}
                onChange={e => setActA(e.target.value)}
                onBlur={saveResult}
                aria-label={`actual ${labelLeft}`}
              />
              <span className="mr-dash">–</span>
              <input
                type="number" min={0} max={20} inputMode="numeric"
                value={actB}
                onChange={e => setActB(e.target.value)}
                onBlur={saveResult}
                aria-label={`actual ${labelRight}`}
              />
            </div>
          ) : (
            <div className="mr-score-readonly">
              {result ? (
                <span className="mr-score-text">{result.team1_score} – {result.team2_score}</span>
              ) : (
                <span className="mr-pending">pending</span>
              )}
            </div>
          )}

          {result && myPred && (
            <span className={`mr-points pts-${earned}`}>+{earned}</span>
          )}
        </div>
      </div>

      {/* Knockouts: who advances? */}
      {isKO && team1IsResolved && team2IsResolved && (
        <div className="mr-advancer">
          <span className="mr-advancer-label">{isAdmin ? 'Advances:' : 'You think advances:'}</span>
          {[team1, team2].map(t => (
            <label key={t} className={`mr-advancer-opt ${(isAdmin ? actAdv : advancer) === t ? 'on' : ''}`}>
              <input
                type="radio"
                name={`adv-${matchId}-${isAdmin ? 'a' : 'p'}`}
                checked={(isAdmin ? actAdv : advancer) === t}
                onChange={() => {
                  if (isAdmin) {
                    setActAdv(t);
                    // Save immediately
                    const a = parseInt(actA, 10); const b = parseInt(actB, 10);
                    if (!Number.isNaN(a) && !Number.isNaN(b)) {
                      upsertRes.mutate({ match_id: matchId, team1_score: a, team2_score: b, advancer: t });
                    }
                  } else if (user && !locked) {
                    setAdvancer(t);
                    const a = parseInt(predA, 10); const b = parseInt(predB, 10);
                    if (!Number.isNaN(a) && !Number.isNaN(b)) {
                      upsertPred.mutate({ match_id: matchId, team1_score: a, team2_score: b, advancer: t });
                    }
                  }
                }}
                disabled={!user || (locked && !isAdmin)}
              />
              <Flag team={t} /> {t}
            </label>
          ))}
        </div>
      )}

      {showMeta && (
        <div className="mr-meta">
          <span>
            {fmtShortDate(date)} · {parseKickoff(date, time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {locked && <span className="mr-lock"> · 🔒 locked</span>}
          </span>
          <span>{ground}</span>
        </div>
      )}
    </div>
  );
}
