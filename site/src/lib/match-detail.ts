/**
 * Consolidated match enrichment data from all sources (OpenLigaDB,
 * Wikipedia, football-data.org). Stored as JSONB in the `match_detail`
 * column on `wc26_match_results`.
 */

export interface MatchDetailGoal {
  team: 'home' | 'away';
  name: string;
  minute: number;
  extraTime?: number;
  kind: 'goal' | 'penalty' | 'own-goal';
}

export interface MatchDetailPlayer {
  name: string;
  number?: number;
  position?: string;
  captain?: boolean;
}

export interface MatchDetailSub {
  name: string;
  number?: number;
  minuteIn: number;
  replaced?: string;
}

export interface MatchDetailCard {
  team: 'home' | 'away';
  name: string;
  minute: number;
  type: 'yellow' | 'red' | 'second-yellow';
}

export interface MatchDetailLineups {
  home: {
    starting: MatchDetailPlayer[];
    subs: MatchDetailSub[];
  };
  away: {
    starting: MatchDetailPlayer[];
    subs: MatchDetailSub[];
  };
}

export interface MatchDetailReferee {
  name: string;
  nationality?: string;
  assistants?: string[];
  var?: string;
}

export interface MatchDetail {
  goals: MatchDetailGoal[];
  halfTime?: { home: number; away: number };
  attendance?: number;
  motm?: { name: string; team: 'home' | 'away' };
  referee?: MatchDetailReferee;
  lineups?: MatchDetailLineups;
  cards?: MatchDetailCard[];
  venue?: { stadium: string; city: string };
}
