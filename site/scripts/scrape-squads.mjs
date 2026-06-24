#!/usr/bin/env node
/**
 * Scrape 2026 FIFA World Cup squads from Wikipedia.
 * Outputs site/public/data/squads.json with all 48 teams' player data.
 * 
 * Usage: node site/scripts/scrape-squads.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(__dirname, '../public/data/squads.json');

// FD team name aliases (Wikipedia → our canonical names)
const TEAM_ALIASES = {
  'Czech Republic': 'Czech Republic',
  'Czechia': 'Czech Republic',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'DR Congo': 'DR Congo',
  'Democratic Republic of the Congo': 'DR Congo',
  'United States': 'USA',
  'Cape Verde': 'Cape Verde',
  'Ivory Coast': 'Ivory Coast',
  'South Korea': 'South Korea',
  'Korea Republic': 'South Korea',
};

function normalizeName(name) {
  return TEAM_ALIASES[name] || name;
}

async function main() {
  console.log('Fetching Wikipedia squads page...');
  const res = await fetch(
    'https://en.wikipedia.org/w/api.php?action=parse&page=2026_FIFA_World_Cup_squads&prop=wikitext&format=json'
  );
  const data = await res.json();
  const wikitext = data.parse.wikitext['*'];

  // Split into team sections by ==Team name== headers
  const lines = wikitext.split('\n');
  const teams = {};
  let currentTeam = null;
  let currentCoach = null;

  for (const line of lines) {
    // Team header: ===Mexico=== (three equals signs)
    const teamMatch = line.match(/^===\s*([^=]+?)\s*===\s*$/);
    if (teamMatch) {
      currentTeam = normalizeName(teamMatch[1].trim());
      currentCoach = null;
      teams[currentTeam] = { coach: null, players: [] };
      continue;
    }

    // Coach: [[Name]] or Coach: {{#invoke:flag|icon|X}} [[Name]]
    const coachMatch = line.match(/^Coach:\s*(?:\{\{[^}]+\}\}\s*)?\[\[([^\]|]+)/);
    if (coachMatch && currentTeam && !teams[currentTeam].coach) {
      teams[currentTeam].coach = coachMatch[1].trim();
      continue;
    }

    // Player row: {{nat fs g player|no=1|pos=GK|name=[[Name]]|...
    const playerMatch = line.match(/\{\{nat fs g? ?player/i);
    if (!playerMatch || !currentTeam) continue;

    const no = line.match(/\|no=(\d+)/);
    const pos = line.match(/\|pos=(\w+)/);
    const nameMatch = line.match(/\|name=\[\[([^\]|]+)/);
    const ageMatch = line.match(/\|age=\{\{birth date and age2?\|(\d{4})\|(\d+)\|(\d+)\|(\d{4})\|(\d+)\|(\d+)/);
    const clubMatch = line.match(/\|club=\[\[([^\]|]+)/);

    if (!nameMatch) continue;

    const player = {
      name: nameMatch[1].trim(),
      team: currentTeam,
      position: pos ? pos[1] : null,
      shirt_number: no ? parseInt(no[1]) : null,
      dob: null,
      club: clubMatch ? clubMatch[1].trim() : null,
    };

    // Parse DOB from {{birth date and age2|ref_year|ref_month|ref_day|birth_year|birth_month|birth_day}}
    if (ageMatch) {
      const [, , , , birthYear, birthMonth, birthDay] = ageMatch;
      player.dob = `${birthYear}-${birthMonth.padStart(2, '0')}-${birthDay.padStart(2, '0')}`;
    }

    teams[currentTeam].players.push(player);
  }

  // Clean up club names (remove disambiguation)
  for (const team of Object.values(teams)) {
    for (const p of team.players) {
      if (p.club) {
        // Remove " (football club)" suffixes
        p.club = p.club.replace(/\s*\(.*\)$/, '');
      }
    }
  }

  const teamCount = Object.keys(teams).length;
  const playerCount = Object.values(teams).reduce((s, t) => s + t.players.length, 0);

  console.log(`Parsed ${teamCount} teams, ${playerCount} players`);

  // Write output
  fs.writeFileSync(OUT_PATH, JSON.stringify(teams, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
