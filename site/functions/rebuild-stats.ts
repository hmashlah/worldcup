/**
 * POST /rebuild-stats — Force rebuild of player/team stats.
 * Use this when stats are out of sync or after manual corrections.
 * Auth: x-wc26-secret header.
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WC26_WEBHOOK_SECRET: string;
}

interface MatchMapEntry {
  fd_id: number;
  home: string;
  away: string;
  date: string;
  same_order_as_fd: boolean;
}
type MatchMap = Record<string, MatchMapEntry>;

const FD_TEAM_ALIASES: Record<string, string> = {
  'Cape Verde Islands': 'Cape Verde',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Congo DR': 'DR Congo',
  'Czechia': 'Czech Republic',
  'United States': 'USA',
};
function normTeam(name: string): string {
  return FD_TEAM_ALIASES[name] ?? name;
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const secret = ctx.request.headers.get('x-wc26-secret');
  if (secret !== ctx.env.WC26_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const host = new URL(ctx.request.url).origin;
  const mapRes = await fetch(`${host}/data/fd-match-map.json`);
  if (!mapRes.ok) return Response.json({ error: 'Failed to load match map' }, { status: 500 });
  const matchMap = await mapRes.json() as MatchMap;

  const url = ctx.env.SUPABASE_URL;
  const key = ctx.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  };

  // Fetch all match results
  const resultsRes = await fetch(`${url}/rest/v1/wc26_match_results?select=match_id,team1_score,team2_score,match_detail`, { headers });
  if (!resultsRes.ok) return Response.json({ error: 'Failed to fetch results' }, { status: 500 });
  const rows = await resultsRes.json() as Array<{
    match_id: string;
    team1_score: number;
    team2_score: number;
    match_detail: Record<string, unknown> | null;
  }>;

  // ── Rebuild player stats ──────────────────────────────────────────
  interface PlayerStat { name: string; team: string; goals: number; penalties: number; own_goals: number; yellow_cards: number; red_cards: number; motm: number; appearances: number }
  const playerStats: Record<string, PlayerStat> = {};
  const ensurePlayer = (name: string, team: string): PlayerStat => {
    const k = `${name}|||${team}`;
    if (!playerStats[k]) playerStats[k] = { name, team, goals: 0, penalties: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, motm: 0, appearances: 0 };
    return playerStats[k];
  };

  // ── Rebuild team stats ────────────────────────────────────────────
  interface TeamStat { team: string; goals_for: number; goals_against: number; penalties: number; yellow_cards: number; red_cards: number }
  const teamStats: Record<string, TeamStat> = {};
  const ensureTeam = (team: string): TeamStat => {
    if (!teamStats[team]) teamStats[team] = { team, goals_for: 0, goals_against: 0, penalties: 0, yellow_cards: 0, red_cards: 0 };
    return teamStats[team];
  };

  for (const row of rows) {
    const mapEntry = matchMap[row.match_id];
    if (!mapEntry) continue;
    const homeTeam = normTeam(mapEntry.home);
    const awayTeam = normTeam(mapEntry.away);
    const resolveTeam = (t: string) => t === 'home' ? homeTeam : awayTeam;

    // Team goals
    const home = ensureTeam(homeTeam);
    const away = ensureTeam(awayTeam);
    home.goals_for += row.team1_score;
    home.goals_against += row.team2_score;
    away.goals_for += row.team2_score;
    away.goals_against += row.team1_score;

    if (row.match_detail) {
      const d = row.match_detail as {
        goals?: Array<{ team: string; name: string; kind: string }>;
        cards?: Array<{ team: string; name: string; type: string }>;
        motm?: { name: string; team: string };
      };

      if (d.goals) {
        for (const g of d.goals) {
          const name = g.name?.trim();
          if (!name) continue;
          const team = resolveTeam(g.team);
          const p = ensurePlayer(name, team);
          if (g.kind === 'own-goal') p.own_goals++;
          else { p.goals++; if (g.kind === 'penalty') { p.penalties++; ensureTeam(team).penalties++; } }
        }
      }

      if (d.cards) {
        for (const c of d.cards) {
          const name = c.name?.trim();
          if (!name) continue;
          const team = resolveTeam(c.team);
          const p = ensurePlayer(name, team);
          const t = ensureTeam(team);
          if (c.type === 'yellow') { p.yellow_cards++; t.yellow_cards++; }
          else if (c.type === 'red' || c.type === 'second-yellow') { p.red_cards++; t.red_cards++; }
        }
      }

      if (d.motm?.name) {
        ensurePlayer(d.motm.name.trim(), resolveTeam(d.motm.team)).motm++;
      }
    }
  }

  // Write player stats
  await fetch(`${url}/rest/v1/wc26_player_stats?name=not.is.null`, { method: 'DELETE', headers });
  const playerRows = Object.values(playerStats);
  if (playerRows.length > 0) {
    await fetch(`${url}/rest/v1/wc26_player_stats`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(playerRows),
    });
  }

  // Write team stats
  await fetch(`${url}/rest/v1/wc26_team_stats?team=not.is.null`, { method: 'DELETE', headers });
  const teamRows = Object.values(teamStats);
  if (teamRows.length > 0) {
    await fetch(`${url}/rest/v1/wc26_team_stats`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(teamRows),
    });
  }

  return Response.json({
    players: playerRows.length,
    teams: teamRows.length,
  });
};
