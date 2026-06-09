// Domain types matching the shape produced by site/build-data.py.

export type Score = { team1: number; team2: number };

export type GroupName = string; // "Group A" .. "Group L"

export interface Group {
  name: GroupName;
  teams: string[];
}

export interface GroupMatch {
  id: string;        // "G-A-1"
  date: string;      // "2026-06-11"
  time: string;      // "13:00 UTC-6"
  team1: string;
  team2: string;
  ground: string;
  matchday: string;  // "Matchday 1"
}

export type RoundName =
  | 'Round of 32'
  | 'Round of 16'
  | 'Quarter-final'
  | 'Semi-final'
  | 'Match for third place'
  | 'Final';

export interface KoMatch {
  id: string;        // "M73" / "M-Final" / "M-3rd"
  num: number | null;
  round: RoundName;
  date: string;
  time: string;
  team1: string;     // "1A" | "2B" | "3A/B/C/D/F" | "W74" | "L101"
  team2: string;
  ground: string;
}

export interface TournamentData {
  groups: Group[];
  group_matches: Record<GroupName, GroupMatch[]>;
  ko_matches: KoMatch[];
  flag_map: Record<string, string>;
}

/**
 * A flat map of match-id → score. Used as the source of truth for
 * computeStandings, resolveSlot, and the bracket cascade. We accept either
 * the user's predictions or the admin-entered actuals so the same logic
 * powers both views.
 */
export type ScoreMap = Record<string, Score>;

/**
 * Optional per-knockout-match advancer override. When a knockout ends in a
 * draw (extra time / penalties), the score alone can't determine who
 * advances — this map lets the caller specify the advancing team.
 */
export type AdvancerMap = Record<string, string | null>;
