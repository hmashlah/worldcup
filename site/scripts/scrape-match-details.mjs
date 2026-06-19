/**
 * Scrapes rich match detail from Wikipedia group pages for the 2026 World Cup.
 *
 * For each finished match, extracts:
 *   - Attendance, Referee, Man of the Match
 *   - Starting lineups (both teams) with positions, numbers, captain flag
 *   - Yellow/Red cards with minutes
 *   - Substitutions with minutes and replaced player
 *   - Assistant referees and VAR officials
 *   - Venue (stadium + city)
 *   - Goals (same format as WikiGoal)
 *
 * Usage:
 *   node site/scripts/scrape-match-details.mjs
 *
 * Output: site/public/data/match-details.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const DATA_JSON = join(REPO_ROOT, 'site', 'public', 'data.json');
const OUT_PATH = join(REPO_ROOT, 'site', 'public', 'data', 'match-details.json');

const USER_AGENT = 'wc26-prediction-league/1.0 (https://worldcup-1jo.pages.dev; admin@simple-courses.com) match-details';

const GROUP_LETTERS = 'ABCDEFGHIJKL'.split('');

// ──────────────────────────────────────────────────────────────────────
// Team canonicalization (same as existing code)
// ──────────────────────────────────────────────────────────────────────

const TEAM_ALIASES = {
  'United States': 'USA',
  'Czechia': 'Czech Republic',
  'Bosnia-Herzegovina': 'Bosnia & Herzegovina',
  'Bosnia and Herzegovina': 'Bosnia & Herzegovina',
  'Cape Verde Islands': 'Cape Verde',
  'Congo DR': 'DR Congo',
  'Democratic Republic of the Congo': 'DR Congo',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cote d\'Ivoire': 'Ivory Coast',
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'West Germany': 'Germany',
  'East Germany': 'Germany',
  'Soviet Union': 'Russia',
  'CIS': 'Russia',
  'Czechoslovakia': 'Czech Republic',
  'Yugoslavia': 'Serbia',
  'Serbia and Montenegro': 'Serbia',
  'FR Yugoslavia': 'Serbia',
  'Zaire': 'DR Congo',
  'Burma': 'Myanmar',
  'South Vietnam': 'Vietnam',
  'Khmer Republic': 'Cambodia',
};

function canonicalizeTeam(wikiTitle) {
  const stripped = wikiTitle
    .replace(/\s+(?:men[''']s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '')
    .trim();
  return TEAM_ALIASES[stripped] ?? stripped;
}

// ──────────────────────────────────────────────────────────────────────
// HTML helpers
// ──────────────────────────────────────────────────────────────────────

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'");
}

function stripTags(html) {
  return decode(html.replace(/<[^>]*>/g, '')).trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────────────
// Fetch Wikipedia group page
// ──────────────────────────────────────────────────────────────────────

async function fetchGroupPage(letter) {
  const url = `https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_${letter}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

// ──────────────────────────────────────────────────────────────────────
// Parse goals from footballbox (fhgoal / fagoal)
// ──────────────────────────────────────────────────────────────────────

function parseGoalBlock(block, team) {
  const goals = [];
  // Each goal is in an <li> inside the goal cell
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(block)) !== null) {
    const li = m[1];
    const nameM = li.match(/<a[^>]*title="([^"]+)"/) || li.match(/<a[^>]*>([^<]+)</);
    if (!nameM) continue;
    const rawName = decode(nameM[1]).trim()
      .replace(/\s+(?:men[''']s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '')
      .replace(/\s*\([^)]*\)\s*$/, '');
    if (!rawName) continue;

    // Detect OG and penalty
    const isOG = /\(o\.?g\.?\)/i.test(li);
    const isPen = /\(pen\.?\)/i.test(li) || /penalty/i.test(li);

    const minutes = [...li.matchAll(/(\d+)(?:\+(\d+))?\s*[''′']/g)];
    for (const mm of minutes) {
      const minute = parseInt(mm[1], 10);
      const kind = isOG ? 'og' : isPen ? 'pen' : 'goal';
      const goal = { team, name: rawName, minute, kind };
      if (mm[2]) goal.offset = parseInt(mm[2], 10);
      goals.push(goal);
    }
  }
  return goals;
}

// ──────────────────────────────────────────────────────────────────────
// Parse footballbox metadata: attendance, referee, venue
// ──────────────────────────────────────────────────────────────────────

function parseFootballboxMeta(box) {
  const meta = { attendance: null, referee: null, venue: null };

  // Venue from fright div — first line usually contains stadium
  const frightM = box.match(/class="fright"[^>]*>([\s\S]*?)(?:<\/div>\s*){2,}/);
  if (frightM) {
    const frightContent = frightM[1];

    // Venue — itemprop="location" or first text
    const venueM = frightContent.match(/itemprop="location"[^>]*>([\s\S]*?)<\/(?:div|span)>/);
    if (venueM) {
      const venueText = stripTags(venueM[1]);
      const parts = venueText.split(',').map(s => s.trim());
      if (parts.length >= 2) {
        meta.venue = { stadium: parts[0], city: parts.slice(1).join(', ') };
      } else {
        meta.venue = { stadium: venueText, city: '' };
      }
    }

    // Attendance
    const attM = frightContent.match(/Attendance[:\s]*(?:<[^>]*>)*\s*([\d,]+)/i);
    if (attM) {
      meta.attendance = parseInt(attM[1].replace(/,/g, ''), 10);
    }

    // Referee
    const refM = frightContent.match(/Referee[:\s]*(?:<[^>]*>)*\s*(?:<a[^>]*>([^<]+)<\/a>|([^<(]+))\s*\((?:<a[^>]*>)?([^<)]+)/i);
    if (refM) {
      meta.referee = {
        name: decode(refM[1] || refM[2] || '').trim(),
        nationality: decode(refM[3] || '').trim(),
      };
    }
  }

  return meta;
}

// ──────────────────────────────────────────────────────────────────────
// Parse lineup table for one team
// ──────────────────────────────────────────────────────────────────────

function parseLineupTable(tableHtml) {
  const starting = [];
  const subs = [];
  const cards = [];
  let manager = null;
  let inSubs = false;
  let inManager = false;

  // Split into rows
  const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    // Check for section markers
    if (/Substitutions/i.test(row) && /<b>/i.test(row)) {
      inSubs = true;
      inManager = false;
      continue;
    }
    if (/Manager/i.test(row) && /<b>/i.test(row)) {
      inManager = true;
      inSubs = false;
      continue;
    }

    if (inManager) {
      const manM = row.match(/<a[^>]*>([^<]+)<\/a>/) || row.match(/<td[^>]*>([^<]+)<\/td>/);
      if (manM) manager = decode(manM[1]).trim();
      continue;
    }

    // Parse a player row
    const cells = row.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 3) continue;

    const position = stripTags(cells[0]);
    const numberM = cells[1].match(/(\d+)/);
    if (!numberM) continue;
    const number = parseInt(numberM[1], 10);

    const nameCell = cells[2];
    const nameM = nameCell.match(/<a[^>]*(?:title="([^"]+)"[^>]*)?>([^<]*)<\/a>/);
    let name = '';
    if (nameM) {
      // Prefer the displayed text, fall back to title
      name = decode(nameM[2] || nameM[1] || '').trim();
      // Strip "national team" suffixes if title was used
      name = name.replace(/\s+(?:men[''']s\s+)?national\s+(?:football|soccer|association football)\s+team$/i, '').trim();
    } else {
      name = stripTags(nameCell);
    }
    if (!name || !position) continue;

    const captain = /\(c\)/.test(nameCell) || /\(captain\)/i.test(nameCell);

    // Check for cards and substitution in remaining cells
    let yellowCard = null;
    let redCard = null;
    let secondYellow = null;
    let subOff = null;
    let subOn = null;

    for (let i = 3; i < cells.length; i++) {
      const cell = cells[i];
      if (/Yellow_card/i.test(cell) || /title="Booked"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (!minM) {
          // Try without apostrophe — sometimes just the number after the icon
          const minM2 = cell.match(/(?:Yellow_card[^>]*>|Booked[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) yellowCard = parseInt(minM2[1], 10);
        } else {
          yellowCard = parseInt(minM[1], 10);
        }
      }
      if (/Red_card/i.test(cell) || /title="Sent off"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (!minM) {
          const minM2 = cell.match(/(?:Red_card[^>]*>|Sent off[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) redCard = parseInt(minM2[1], 10);
        } else {
          redCard = parseInt(minM[1], 10);
        }
      }
      if (/Yellow-red_card/i.test(cell) || /title="Second yellow"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (minM) secondYellow = parseInt(minM[1], 10);
      }
      if (/Sub_off/i.test(cell) || /title="Substituted off"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (!minM) {
          const minM2 = cell.match(/(?:Sub_off[^>]*>|Substituted off[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) subOff = parseInt(minM2[1], 10);
        } else {
          subOff = parseInt(minM[1], 10);
        }
      }
      if (/Sub_on/i.test(cell) || /title="Substituted on"/i.test(cell)) {
        const minM = cell.match(/(\d+)(?:\+(\d+))?\s*[''′']/);
        if (!minM) {
          const minM2 = cell.match(/(?:Sub_on[^>]*>|Substituted on[^>]*>)\s*(?:&#160;|&nbsp;|\s)*(\d+)/i);
          if (minM2) subOn = parseInt(minM2[1], 10);
        } else {
          subOn = parseInt(minM[1], 10);
        }
      }
    }

    const player = { name, number, position, captain };

    if (inSubs) {
      const sub = { name, number, position, minuteIn: subOn };
      subs.push(sub);
    } else {
      starting.push(player);
      if (subOff !== null) {
        // Record that this player was subbed off — we'll link to the sub later
        player._subbedOffAt = subOff;
      }
    }

    // Cards
    if (yellowCard !== null) {
      cards.push({ name, minute: yellowCard, type: 'yellow' });
    }
    if (redCard !== null) {
      cards.push({ name, minute: redCard, type: 'red' });
    }
    if (secondYellow !== null) {
      cards.push({ name, minute: secondYellow, type: 'second-yellow' });
    }
  }

  // Link subs to the player they replaced (by matching minute)
  for (const sub of subs) {
    const replacedPlayer = starting.find(p => p._subbedOffAt === sub.minuteIn);
    if (replacedPlayer) {
      sub.replaced = replacedPlayer.name;
    }
  }

  // Clean up internal fields
  for (const p of starting) {
    delete p._subbedOffAt;
  }

  return { starting, subs, cards, manager };
}

// ──────────────────────────────────────────────────────────────────────
// Parse a match section (everything between one footballbox and the next)
// ──────────────────────────────────────────────────────────────────────

function parseMatchSection(section) {
  // Extract teams from footballbox
  const homeM = section.match(/class="fhome"[\s\S]*?title="([^"]+)"/);
  const awayM = section.match(/class="faway"[\s\S]*?title="([^"]+)"/);
  if (!homeM || !awayM) return null;

  const home = canonicalizeTeam(decode(homeM[1]));
  const away = canonicalizeTeam(decode(awayM[1]));

  // Score — skip unfinished matches
  const scoreM = section.match(/class="fscore"[^>]*>(?:<a[^>]*>)?\s*(\d+)\s*[–-]\s*(\d+)/);
  if (!scoreM) return null;

  // Date
  let date = null;
  const dateM = section.match(/class="bday[^"]*">(\d{4}-\d{2}-\d{2})/);
  if (dateM) date = dateM[1];

  // Goals
  const homeGoalsBlock = section.match(/class="fhgoal"[\s\S]*?<\/td>/)?.[0] ?? '';
  const awayGoalsBlock = section.match(/class="fagoal"[\s\S]*?<\/td>/)?.[0] ?? '';
  const goals = [
    ...parseGoalBlock(homeGoalsBlock, 'home'),
    ...parseGoalBlock(awayGoalsBlock, 'away'),
  ].sort((a, b) => a.minute - b.minute);

  // Footballbox meta (attendance, referee, venue)
  const meta = parseFootballboxMeta(section);

  // Lineup tables — there should be two, one per team
  // They're typically in a table with two <td valign="top"> cells
  const lineupTables = section.match(/<table[^>]*style="[^"]*font-size:\s*90%[^"]*"[^>]*>[\s\S]*?<\/table>/gi) || [];

  let homeLineup = null;
  let awayLineup = null;

  if (lineupTables.length >= 2) {
    homeLineup = parseLineupTable(lineupTables[0]);
    awayLineup = parseLineupTable(lineupTables[1]);
  } else if (lineupTables.length === 1) {
    // Sometimes both lineups are in a single wrapper table — try splitting by valign
    const wrapper = lineupTables[0];
    const tdCells = wrapper.match(/<td[^>]*valign="top"[^>]*>[\s\S]*?(?=<td[^>]*valign="top"|<\/tr>)/gi) || [];
    if (tdCells.length >= 2) {
      homeLineup = parseLineupTable(tdCells[0]);
      awayLineup = parseLineupTable(tdCells[1]);
    }
  }

  // Post-lineup section: MOTM, assistant referees, VAR
  // The structure is one or two <p> blocks:
  //   <p><b>Man of the Match:</b><br/>Name (Country)</p>
  //   <p><b>Assistant referees:</b><br/>Name<br/>Name
  //   <br/><b>Fourth official:</b><br/>Name
  //   <br/><b>Video assistant referee:</b><br/>Name
  //   ...
  //   </p>
  let motm = null;
  let assistants = [];
  let varRef = null;

  // Man of the Match — grab the <p> block that contains "Man of the Match"
  const motmM = section.match(/<b>Man of the Match:<\/b>[\s\S]*?<\/p>/i);
  if (motmM) {
    const motmBlock = motmM[0];
    // Find the first <a> link after <br /> — that's the player
    const motmNameM = motmBlock.match(/<br\s*\/?>[\s\S]*?<a[^>]*(?:title="([^"]+)"[^>]*)?>([^<]*)<\/a>/);
    if (motmNameM) {
      const motmName = decode(motmNameM[2] || motmNameM[1] || '').trim();
      // Determine which team
      let motmTeam = null;
      if (homeLineup) {
        const inHome = homeLineup.starting.some(p => p.name === motmName) ||
                       homeLineup.subs.some(p => p.name === motmName);
        if (inHome) motmTeam = 'home';
      }
      if (!motmTeam && awayLineup) {
        const inAway = awayLineup.starting.some(p => p.name === motmName) ||
                       awayLineup.subs.some(p => p.name === motmName);
        if (inAway) motmTeam = 'away';
      }
      motm = { name: motmName, team: motmTeam };
    }
  }

  // The officials block is a single <p> containing multiple sections separated by <br />.
  // Structure: <p><b>Assistant referees:</b><sup>...</sup>
  //   <br />Name (Country)
  //   <br />Name (Country)
  //   <br /><b>Fourth official:</b>
  //   <br />Name (Country)
  //   <br /><b>Video assistant referee:</b>
  //   <br />Name (Country)
  //   ...</p>
  // We split by <br /> and parse linearly, tracking current section.
  const officialsM = section.match(/<p><b>[\s\S]*?Assistant referee[\s\S]*?<\/p>/i);
  if (officialsM) {
    const block = officialsM[0];
    const lines = block.split(/<br\s*\/?>/i);
    let currentSection = '';

    for (const line of lines) {
      // Check if this line contains a bold section header
      const boldM = line.match(/<b>[\s\S]*?<\/b>/i);
      if (boldM) {
        const headerText = stripTags(boldM[0]).replace(/[:\s]+$/,'').trim().toLowerCase();
        if (/assistant referees?/i.test(headerText) && !/video/i.test(headerText) && !/reserve/i.test(headerText)) {
          currentSection = 'assistants';
        } else if (/^video assistant referee$/i.test(headerText)) {
          currentSection = 'var';
        } else {
          currentSection = headerText; // fourth official, reserve, etc.
        }
        // Check if there's a name after the bold tag in the same line
        const afterBold = line.slice(line.indexOf(boldM[0]) + boldM[0].length);
        const nameInLine = stripTags(afterBold).replace(/\[\d+\]/g, '').replace(/&#91;\d+&#93;/g, '').trim();
        if (nameInLine && nameInLine.length > 2) {
          if (currentSection === 'assistants') assistants.push(nameInLine);
          else if (currentSection === 'var') varRef = nameInLine;
        }
        continue;
      }

      // This is a name line
      const text = stripTags(line).replace(/\[\d+\]/g, '').replace(/&#91;\d+&#93;/g, '').trim();
      if (!text || text.length <= 1) continue;

      if (currentSection === 'assistants') {
        assistants.push(text);
      } else if (currentSection === 'var' && !varRef) {
        varRef = text;
      }
    }
  }

  // Build cards array with team assignment
  const allCards = [];
  if (homeLineup) {
    for (const c of homeLineup.cards) {
      allCards.push({ team: 'home', ...c });
    }
  }
  if (awayLineup) {
    for (const c of awayLineup.cards) {
      allCards.push({ team: 'away', ...c });
    }
  }
  allCards.sort((a, b) => a.minute - b.minute);

  // Build referee object
  let refereeObj = null;
  if (meta.referee) {
    refereeObj = {
      name: meta.referee.name,
      nationality: meta.referee.nationality,
      assistants,
      var: varRef,
    };
  }

  return {
    home,
    away,
    date,
    goals,
    attendance: meta.attendance,
    motm,
    referee: refereeObj,
    lineups: {
      home: homeLineup ? { starting: homeLineup.starting, subs: homeLineup.subs } : null,
      away: awayLineup ? { starting: awayLineup.starting, subs: awayLineup.subs } : null,
    },
    cards: allCards,
    venue: meta.venue,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Split page HTML into per-match sections
// ──────────────────────────────────────────────────────────────────────

function splitMatchSections(html) {
  // Each match section starts with a footballbox div. We split by finding
  // all footballbox occurrences and grabbing content until the next one
  // (or end of the matches area).
  const sections = [];
  const footballboxRe = /<div [^>]*class="footballbox"[^>]*>/g;
  const indices = [];
  let m;
  while ((m = footballboxRe.exec(html)) !== null) {
    indices.push(m.index);
  }

  for (let i = 0; i < indices.length; i++) {
    const start = indices[i];
    const end = i + 1 < indices.length ? indices[i + 1] : html.length;
    sections.push(html.slice(start, end));
  }

  return sections;
}

// ──────────────────────────────────────────────────────────────────────
// Match ID mapping
// ──────────────────────────────────────────────────────────────────────

function loadMatchMap() {
  const data = JSON.parse(readFileSync(DATA_JSON, 'utf8'));
  const matches = [];
  for (const [groupName, groupMatches] of Object.entries(data.group_matches)) {
    for (const gm of groupMatches) {
      matches.push({
        id: gm.id,
        team1: gm.team1,
        team2: gm.team2,
        date: gm.date,
      });
    }
  }
  return matches;
}

function findMatchId(matchMap, home, away, date) {
  // Try exact team pair + date match (with ±1 day tolerance)
  for (const m of matchMap) {
    const t1 = m.team1;
    const t2 = m.team2;

    // Check team pair matches (in either order)
    const teamsMatch =
      (t1 === home && t2 === away) ||
      (t1 === away && t2 === home);
    if (!teamsMatch) continue;

    if (!date || !m.date) {
      // If no date available, match by teams only (risky but fallback)
      return m.id;
    }

    // ±1 day tolerance for timezone differences
    const d1 = new Date(m.date);
    const d2 = new Date(date);
    const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) {
      return m.id;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const matchMap = loadMatchMap();
  const results = {};
  let totalMatches = 0;

  for (const letter of GROUP_LETTERS) {
    console.log(`Fetching Group ${letter}...`);
    const html = await fetchGroupPage(letter);

    const sections = splitMatchSections(html);
    let finishedCount = 0;

    for (const section of sections) {
      const parsed = parseMatchSection(section);
      if (!parsed) continue;

      const matchId = findMatchId(matchMap, parsed.home, parsed.away, parsed.date);
      if (!matchId) {
        // Could not map to our match IDs — skip
        continue;
      }

      finishedCount++;
      results[matchId] = {
        goals: parsed.goals,
        attendance: parsed.attendance,
        motm: parsed.motm,
        referee: parsed.referee,
        lineups: parsed.lineups,
        cards: parsed.cards,
        venue: parsed.venue,
      };
    }

    console.log(`  found ${finishedCount} finished matches`);
    totalMatches += finishedCount;

    // Be nice to Wikipedia — 1 second between fetches
    if (letter !== 'L') {
      await sleep(1000);
    }
  }

  // Write output
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({ matches: results }, null, 2));
  console.log(`\nTotal: ${totalMatches} matches enriched`);
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
