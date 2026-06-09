import { useEffect, useState, useCallback } from 'react';
import { Flag } from '@/components/Flag';
import { useAuth } from '@/contexts/AuthContext';
import { useMyPredictions, useUpsertPrediction } from '@/hooks/usePredictions';
import { useResults, useUpsertResult } from '@/hooks/useResults';
import { isLocked, parseKickoff } from '@/lib/time';
import { scorePrediction } from '@/lib/scoring';

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
    isKO = false, roundLabel,
  } = p;
  const { user, isAdmin } = useAuth();
  const myPredsQ = useMyPredictions();
  const resultsQ = useResults();
  const upsertPred = useUpsertPrediction();
  const upsertRes = useUpsertResult();

  const locked = isLocked(date, time);
  const myPred = myPredsQ.data?.[matchId];
  const result = resultsQ.data?.[matchId];

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
    if (!user || locked) return;
    const x = parseInt(a, 10), y = parseInt(b, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const finalAdv = overrides?.advancer ?? adv;
    if (myPred && myPred.team1_score === x && myPred.team2_score === y && (myPred.advancer ?? '') === finalAdv) return;
    upsertPred.mutate({ match_id: matchId, team1_score: x, team2_score: y, advancer: finalAdv || null });
  }, [user, locked, a, b, adv, myPred, matchId, upsertPred]);

  const saveResult = useCallback((overrides?: { advancer?: string }) => {
    if (!isAdmin) return;
    const x = parseInt(actA, 10), y = parseInt(actB, 10);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const finalAdv = overrides?.advancer ?? actAdv;
    if (result && result.team1_score === x && result.team2_score === y && (result.advancer ?? '') === finalAdv) return;
    upsertRes.mutate({ match_id: matchId, team1_score: x, team2_score: y, advancer: finalAdv || null });
  }, [isAdmin, actA, actB, actAdv, result, matchId, upsertRes]);

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

  return (
    <div className={`mc ${locked ? 'mc-locked' : ''}`}>
      {/* PREDICTION row — always the user's own pick, even for admin */}
      <div className="mc-row">
        <div className="mc-team mc-left">
          {team1IsResolved
            ? <><Flag team={team1} /><span className="mc-name">{labelLeft}</span></>
            : <span className="mc-placeholder">{labelLeft}</span>}
        </div>
        <div className="mc-scores">
          <input
            className="mc-input" type="number" min={0} max={20} inputMode="numeric"
            disabled={!user || locked}
            value={a}
            onChange={e => setA(e.target.value)}
            onBlur={() => savePred()}
            aria-label={`your prediction ${labelLeft}`}
          />
          <span className="mc-dash">–</span>
          <input
            className="mc-input" type="number" min={0} max={20} inputMode="numeric"
            disabled={!user || locked}
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

      {/* Knockout advancer for the user's prediction */}
      {isKO && team1IsResolved && team2IsResolved && (
        <div className="mc-advancer">
          <span className="mc-advancer-label">your pick advances</span>
          {[team1, team2].map(t => (
            <button
              key={t}
              type="button"
              className={`mc-advancer-pill ${adv === t ? 'on' : ''}`}
              disabled={!user || locked}
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

      {/* ACTUAL row — admin gets inputs, others see read-only result */}
      {isAdmin ? (
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
        result && (
          <div className="mc-actual">
            <span className="mc-actual-label">final</span>
            <span className="mc-actual-score">{result.team1_score} – {result.team2_score}</span>
          </div>
        )
      )}

      <div className="mc-meta">
        <span className="mc-meta-time">
          {kickoffStr} {locked && <span className="mc-lock">· 🔒</span>}
        </span>
        {roundLabel && <span className="mc-meta-round">{roundLabel}</span>}
        <span className="mc-meta-ground">{ground}</span>
      </div>
    </div>
  );
}
