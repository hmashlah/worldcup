import { useQuery } from '@tanstack/react-query';

export interface H2HGoal {
  name: string;
  minute: number;
  penalty?: boolean;
  owngoal?: boolean;
  /** Some archive entries use `offset: 9` to mean stoppage time (9 = 90+9). */
  offset?: number;
}

export interface H2HMatch {
  /** Competition name: "World Cup" | "Euros" | "Copa America" | "AFCON"
   *  | "Asian Cup" | "Confederations Cup". Older WC archive entries use
   *  the literal "World Cup" added at build time. */
  competition: string;
  year: number;
  /** Normalized round name where available. Older Wikipedia tournaments
   *  often have an empty string here — the UI falls back to year+
   *  competition only. */
  round: string;
  /** ISO date "YYYY-MM-DD" — may be null on the very oldest editions. */
  date: string | null;
  venue: string | null;
  /** Original team1/team2 strings as they appeared at the time
   *  ("West Germany" rather than "Germany"). The pair *key* is canonical;
   *  these strings are for display so we don't rewrite history. */
  team1: string;
  team2: string;
  score: { ft: [number, number]; ht?: [number, number] };
  scorers1: H2HGoal[];
  scorers2: H2HGoal[];
}

export interface H2HData {
  source_years: number[];
  aliases: Record<string, string>;
  pairs: Record<string, H2HMatch[]>;
}

/** Static asset built at compile time; one fetch + cached forever. */
export function useH2H() {
  return useQuery<H2HData>({
    queryKey: ['h2h-data'],
    queryFn: async () => {
      const res = await fetch('/data/h2h.json');
      if (!res.ok) throw new Error('Failed to load h2h.json');
      return res.json();
    },
    staleTime: Infinity,
  });
}

/** Build the canonical pair-key used to look up `data.pairs`. Mirrors the
 *  build-time logic in scripts/build-h2h.mjs. */
export function pairKey(team1: string, team2: string, aliases: Record<string, string>): string {
  const c1 = aliases[team1] ?? team1;
  const c2 = aliases[team2] ?? team2;
  return [c1, c2].sort().join('|');
}
