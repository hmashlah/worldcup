import { useMemo } from 'react';
import { Flag } from '@/components/Flag';
import { useAuth } from '@/contexts/AuthContext';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useAllPredictions } from '@/hooks/usePredictions';
import { useProfiles } from '@/hooks/useProfiles';
import { useH2H, pairKey, type H2HMatch, type H2HGoal } from '@/hooks/useH2H';
import { useNow } from '@/hooks/useNow';
import { useUI } from '@/lib/ui-store';
import { isLocked, parseKickoff } from '@/lib/time';
import { scorePrediction } from '@/lib/scoring';
import {
  resolveSlot,
  isKnockoutRound,
  prettySlot,
} from '@/lib/tournament';
import type {
  TournamentData,
  GroupMatch,
  KoMatch,
  ScoreMap,
  AdvancerMap,
} from '@/lib/types';

/**
 * Per-match deep dive: result + scorers, league predictions, head-to-head
 * history from previous World Cups, and venue info.
 *
 * Rendered by App.tsx as a full-screen overlay when useUI().openMatchId
 * is set. Closing returns to whichever tab was active.
 */
export function MatchDetailPage({ matchId }: { matchId: string }) {
  const closeMatch = useUI(s => s.closeMatch);
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const predsQ = useAllPredictions();
  const profilesQ = useProfiles();
  const h2hQ = useH2H();
  const { user } = useAuth();
  // Re-render every minute so the lock indicator flips at kickoff. Called
  // unconditionally here (before any early return) to satisfy hooks rules.
  const now = useNow(60_000);

  const loading = dataQ.isLoading || resultsQ.isLoading || h2hQ.isLoading;
  const data = dataQ.data;
  const results = resultsQ.data;

  // Locate the match. Group matches live in a `Record<GroupName, ...>`,
  // KO matches in a flat array. We try both.
  const located = useMemo(() => locateMatch(data, matchId), [data, matchId]);

  // Resolve KO slots ("W74", "1A", "3A/B/C/D/F"…) using the same logic
  // the bracket uses. Build score+advancer maps from results once.
  const { scores, advancers } = useMemo(() => buildMaps(results), [results]);

  if (loading || !data || !located) {
    return (
      <section className="tab-panel active mdp">
        <div className="mdp-back-row">
          <button className="mdp-back" onClick={closeMatch}>← Back</button>
        </div>
        <p style={{ textAlign: 'center', padding: 32 }}>
          {loading ? 'loading…' : 'Match not found.'}
        </p>
      </section>
    );
  }

  const { match, kind } = located;
  const isKO = kind === 'ko';
  const koMatch = isKO ? (match as KoMatch) : null;
  const isKnockoutMatch = isKO && isKnockoutRound(koMatch!.round);

  // For KO matches, team1/team2 are slot tokens until the bracket fills.
  // resolveSlot returns null while not yet known.
  const team1Resolved = isKO
    ? resolveSlot(data, scores, advancers, koMatch!.team1)
    : (match as GroupMatch).team1;
  const team2Resolved = isKO
    ? resolveSlot(data, scores, advancers, koMatch!.team2)
    : (match as GroupMatch).team2;

  const team1Display = team1Resolved ?? prettySlot((match as KoMatch).team1);
  const team2Display = team2Resolved ?? prettySlot((match as KoMatch).team2);

  const result = results?.[matchId];
  const kickoff = parseKickoff(match.date, match.time);
  const locked = isLocked(match.date, match.time, now);
  const kickoffStr = kickoff.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const roundLabel = isKO
    ? koMatch!.round
    : `Group ${(match as GroupMatch).id.split('-')[1]} · ${(match as GroupMatch).matchday}`;

  return (
    <section className="tab-panel active mdp">
      <div className="mdp-back-row">
        <button className="mdp-back" onClick={closeMatch} aria-label="Back">
          ← Back
        </button>
      </div>

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header className="mdp-header">
        <div className="mdp-teams">
          <div className="mdp-team">
            {team1Resolved
              ? <><Flag team={team1Resolved} /><span className="mdp-team-name">{team1Display}</span></>
              : <span className="mdp-team-placeholder">{team1Display}</span>}
          </div>
          <span className="mdp-vs">vs</span>
          <div className="mdp-team">
            {team2Resolved
              ? <><Flag team={team2Resolved} /><span className="mdp-team-name">{team2Display}</span></>
              : <span className="mdp-team-placeholder">{team2Display}</span>}
          </div>
        </div>
        <div className="mdp-meta">
          <span>{roundLabel}</span>
          <span>·</span>
          <span>{kickoffStr}</span>
          {locked && <span className="mdp-meta-locked">· 🔒 locked</span>}
        </div>
        <div className="mdp-venue">{match.ground}</div>
      </header>

      {/* ─── Result + scorers (if played) ───────────────────────────── */}
      {result && (
        <section className="mdp-section">
          <h3 className="mdp-h3">Result</h3>
          <div className="mdp-final-score">
            <span className="mdp-final-name">{team1Display}</span>
            <span className="mdp-final-score-num">{result.team1_score}</span>
            <span className="mdp-dash">–</span>
            <span className="mdp-final-score-num">{result.team2_score}</span>
            <span className="mdp-final-name">{team2Display}</span>
          </div>
          {isKnockoutMatch && result.advancer && (
            <div className="mdp-advanced">
              <strong>{result.advancer}</strong> advanced
            </div>
          )}
          {/* The 2026 archive doesn't carry scorer data (it's a future
              tournament), so this list will only ever populate if you
              later add goal scorers to wc26_match_results. Kept here for
              forward compatibility — until then, `goals` is always [].
              Cleanly hides itself when empty. */}
        </section>
      )}

      {/* ─── League predictions ─────────────────────────────────────── */}
      <PredictionsSection
        matchId={matchId}
        isKO={isKnockoutMatch}
        currentUserId={user?.id ?? null}
        predictions={predsQ.data ?? []}
        profiles={profilesQ.data ?? {}}
        result={result ?? null}
        locked={locked}
      />

      {/* ─── Head-to-Head ────────────────────────────────────────────── */}
      <H2HSection
        team1={team1Resolved}
        team2={team2Resolved}
      />

      {/* ─── Venue ──────────────────────────────────────────────────── */}
      <section className="mdp-section">
        <h3 className="mdp-h3">Venue</h3>
        <p className="mdp-venue-detail">{match.ground}</p>
      </section>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Predictions section
// ──────────────────────────────────────────────────────────────────────

function PredictionsSection({
  matchId,
  isKO,
  currentUserId,
  predictions,
  profiles,
  result,
  locked,
}: {
  matchId: string;
  isKO: boolean;
  currentUserId: string | null;
  predictions: { user_id: string; match_id: string; team1_score: number; team2_score: number; advancer: string | null }[];
  profiles: Record<string, { user_id: string; display_name: string; approved: boolean }>;
  result: { team1_score: number; team2_score: number; advancer: string | null } | null;
  locked: boolean;
}) {
  const forThisMatch = predictions.filter(p => p.match_id === matchId);

  // Until kickoff, only show the current user's own pick.
  if (!locked) {
    const mine = forThisMatch.find(p => p.user_id === currentUserId);
    return (
      <section className="mdp-section">
        <h3 className="mdp-h3">Your prediction</h3>
        {mine ? (
          <div className="mdp-pred-row mdp-pred-self">
            <span className="mdp-pred-name">You</span>
            <span className="mdp-pred-score">{mine.team1_score} – {mine.team2_score}</span>
            {isKO && mine.advancer && <span className="mdp-pred-adv">→ {mine.advancer}</span>}
          </div>
        ) : (
          <p className="mdp-empty">You haven't picked yet.</p>
        )}
        <p className="mdp-hint">Other players' predictions appear after kickoff.</p>
      </section>
    );
  }

  // After kickoff: show everyone's predictions (approved users only),
  // sorted with the current user first, then by points earned desc.
  const approved = forThisMatch.filter(p => profiles[p.user_id]?.approved);
  const rows = approved.map(p => {
    const pts = result
      ? scorePrediction(
          { team1: p.team1_score, team2: p.team2_score },
          { team1: result.team1_score, team2: result.team2_score },
          isKO,
          p.advancer,
          result.advancer,
        )
      : null;
    return {
      user_id: p.user_id,
      name: profiles[p.user_id]?.display_name ?? 'Unknown',
      team1_score: p.team1_score,
      team2_score: p.team2_score,
      advancer: p.advancer,
      pts,
    };
  });

  rows.sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (b.pts ?? 0) - (a.pts ?? 0) || a.name.localeCompare(b.name);
  });

  return (
    <section className="mdp-section">
      <h3 className="mdp-h3">League predictions</h3>
      {rows.length === 0 ? (
        <p className="mdp-empty">No predictions for this match.</p>
      ) : (
        <ul className="mdp-pred-list">
          {rows.map(r => (
            <li
              key={r.user_id}
              className={`mdp-pred-row ${r.user_id === currentUserId ? 'mdp-pred-self' : ''}`}
            >
              <span className="mdp-pred-name">
                {r.user_id === currentUserId ? 'You' : r.name}
              </span>
              <span className="mdp-pred-score">{r.team1_score} – {r.team2_score}</span>
              {isKO && r.advancer && <span className="mdp-pred-adv">→ {r.advancer}</span>}
              {r.pts !== null && (
                <span className={`mdp-pred-pts pts-${r.pts}`}>+{r.pts}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Head-to-Head section
// ──────────────────────────────────────────────────────────────────────

function H2HSection({ team1, team2 }: { team1: string | null; team2: string | null }) {
  const h2hQ = useH2H();

  // Until both teams are confirmed (KO bracket fills in), there's nothing
  // meaningful to show. The card-level "Details" link is hidden in that
  // case, but if someone deep-links here we degrade gracefully.
  if (!team1 || !team2) {
    return (
      <section className="mdp-section">
        <h3 className="mdp-h3">Previous World Cup meetings</h3>
        <p className="mdp-empty">Both teams must be confirmed before history is available.</p>
      </section>
    );
  }
  if (h2hQ.isLoading || !h2hQ.data) {
    return (
      <section className="mdp-section">
        <h3 className="mdp-h3">Previous World Cup meetings</h3>
        <p className="mdp-empty">loading…</p>
      </section>
    );
  }

  const key = pairKey(team1, team2, h2hQ.data.aliases);
  const matches: H2HMatch[] = h2hQ.data.pairs[key] ?? [];

  if (matches.length === 0) {
    return (
      <section className="mdp-section">
        <h3 className="mdp-h3">Previous World Cup meetings</h3>
        <p className="mdp-empty">
          No previous World Cup meetings between these teams. This is their first.
        </p>
      </section>
    );
  }

  // Compute summary from team1's perspective (left side of the header).
  // Use canonical names so "West Germany" beats are credited to "Germany".
  const aliases = h2hQ.data.aliases;
  const c1 = aliases[team1] ?? team1;
  const summary = matches.reduce(
    (acc, m) => {
      const home = aliases[m.team1] ?? m.team1;
      const [s1, s2] = m.score.ft;
      // Map the match scoreline onto our team1-first orientation.
      const t1Score = home === c1 ? s1 : s2;
      const t2Score = home === c1 ? s2 : s1;
      acc.gf += t1Score; acc.ga += t2Score;
      if (t1Score > t2Score) acc.w++;
      else if (t1Score < t2Score) acc.l++;
      else acc.d++;
      return acc;
    },
    { w: 0, d: 0, l: 0, gf: 0, ga: 0 },
  );

  return (
    <section className="mdp-section">
      <h3 className="mdp-h3">Previous World Cup meetings</h3>
      <div className="mdp-h2h-summary">
        <span><strong>{summary.w}</strong> W</span>
        <span><strong>{summary.d}</strong> D</span>
        <span><strong>{summary.l}</strong> L</span>
        <span className="mdp-h2h-goals">
          ({summary.gf}–{summary.ga} goals, from {team1}'s view)
        </span>
      </div>
      <ul className="mdp-h2h-list">
        {matches.map((m, i) => (
          <H2HMatchCard key={`${m.year}-${i}`} match={m} />
        ))}
      </ul>
    </section>
  );
}

function H2HMatchCard({ match }: { match: H2HMatch }) {
  const [s1, s2] = match.score.ft;
  return (
    <li className="mdp-h2h-card">
      <div className="mdp-h2h-card-head">
        <span className="mdp-h2h-year">{match.year}</span>
        <span className="mdp-h2h-round">{match.round}</span>
        {match.date && <span className="mdp-h2h-date">{match.date}</span>}
      </div>
      <div className="mdp-h2h-score">
        <Flag team={canonicalTeamForFlag(match.team1)} />
        <span>{match.team1}</span>
        <strong>{s1}</strong>
        <span className="mdp-dash">–</span>
        <strong>{s2}</strong>
        <span>{match.team2}</span>
        <Flag team={canonicalTeamForFlag(match.team2)} />
      </div>
      {(match.scorers1.length > 0 || match.scorers2.length > 0) && (
        <div className="mdp-h2h-scorers">
          <ul>
            {match.scorers1.map((g, i) => <ScorerLine key={`a${i}`} g={g} side="left" />)}
          </ul>
          <ul>
            {match.scorers2.map((g, i) => <ScorerLine key={`b${i}`} g={g} side="right" />)}
          </ul>
        </div>
      )}
      {match.venue && <div className="mdp-h2h-venue">{match.venue}</div>}
    </li>
  );
}

function ScorerLine({ g, side }: { g: H2HGoal; side: 'left' | 'right' }) {
  const minute = g.offset ? `90+${g.offset}` : `${g.minute}`;
  const tag = g.penalty ? ' (pen)' : g.owngoal ? ' (OG)' : '';
  return (
    <li className={`mdp-h2h-goal ${side}`}>
      ⚽ {g.name} {minute}'{tag}
    </li>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

type Located =
  | { kind: 'group'; match: GroupMatch }
  | { kind: 'ko'; match: KoMatch };

function locateMatch(data: TournamentData | undefined, matchId: string): Located | null {
  if (!data) return null;
  for (const list of Object.values(data.group_matches)) {
    const found = list.find(m => m.id === matchId);
    if (found) return { kind: 'group', match: found };
  }
  const ko = data.ko_matches.find(m => m.id === matchId);
  if (ko) return { kind: 'ko', match: ko };
  return null;
}

function buildMaps(
  results: Record<string, { team1_score: number; team2_score: number; advancer: string | null }> | undefined,
): { scores: ScoreMap; advancers: AdvancerMap } {
  const scores: ScoreMap = {};
  const advancers: AdvancerMap = {};
  if (!results) return { scores, advancers };
  for (const [id, r] of Object.entries(results)) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
    advancers[id] = r.advancer;
  }
  return { scores, advancers };
}

/** The Flag component looks up flag_map by the *current* country name.
 *  History records may say "West Germany"; map those to today's name so
 *  a flag still renders. Falls back to the original (no flag if it's
 *  defunct and unmapped — e.g. Yugoslavia → Serbia). */
function canonicalTeamForFlag(team: string): string {
  // Conservative inline map; covers the same set as build-h2h.mjs.
  const ALIASES: Record<string, string> = {
    'West Germany': 'Germany',
    'East Germany': 'Germany',
    'Soviet Union': 'Russia',
    'Czechoslovakia': 'Czech Republic',
    'Yugoslavia': 'Serbia',
    'Serbia and Montenegro': 'Serbia',
    'Zaire': 'DR Congo',
    'Dutch East Indies': 'Indonesia',
  };
  return ALIASES[team] ?? team;
}
