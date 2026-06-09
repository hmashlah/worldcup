/* ── Our World Cup 2026 ── client logic ── */

const STORAGE_KEY = "wc2026-our-picks-v1";
let DATA = null;
let SCORES = loadScores();

function loadScores() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}
function saveScores() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SCORES));
}

function setScore(id, side, val) {
  if (!SCORES[id]) SCORES[id] = {};
  SCORES[id][side] = val === "" ? null : Number(val);
  saveScores();
}
function getScore(id, side) {
  return SCORES[id]?.[side] ?? null;
}
function bothScores(id) {
  const s = SCORES[id];
  if (!s) return null;
  if (s.s1 == null || s.s2 == null) return null;
  return s;
}

/* ── Init ──────────────────────────── */
async function init() {
  const res = await fetch("./data.json");
  DATA = await res.json();
  renderGroups();
  renderBracket();
  renderChampion();
  bindTabs();
  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Clear every score and start fresh?")) return;
    SCORES = {};
    saveScores();
    renderGroups();
    renderBracket();
    renderChampion();
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(t => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      document.getElementById("tab-" + t.dataset.tab).classList.add("active");
    });
  });
}

/* ── Helpers ───────────────────────── */
function flag(team) {
  const code = DATA.flag_map[team];
  if (!code) return "";
  return `<span class="fi fi-${code}"></span>`;
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ── Group stage ───────────────────── */
function renderGroups() {
  const grid = document.getElementById("groupsGrid");
  grid.innerHTML = "";
  for (const g of DATA.groups) {
    grid.appendChild(renderGroupCard(g));
  }
  // After rendering, recompute "best 3rd" tags across all groups.
  highlightBestThirds();
}

function computeStandings(group) {
  const teams = {};
  for (const t of group.teams) {
    teams[t] = { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
  }
  const matches = DATA.group_matches[group.name];
  for (const m of matches) {
    const sc = bothScores(m.id);
    if (!sc) continue;
    const a = teams[m.team1], b = teams[m.team2];
    a.P++; b.P++;
    a.GF += sc.s1; a.GA += sc.s2;
    b.GF += sc.s2; b.GA += sc.s1;
    if (sc.s1 > sc.s2)      { a.W++; a.Pts += 3; b.L++; }
    else if (sc.s1 < sc.s2) { b.W++; b.Pts += 3; a.L++; }
    else                    { a.D++; b.D++; a.Pts++; b.Pts++; }
  }
  for (const t of Object.values(teams)) t.GD = t.GF - t.GA;
  return Object.values(teams).sort((x, y) =>
    y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.team.localeCompare(y.team)
  );
}

function renderGroupCard(group) {
  const card = document.createElement("div");
  card.className = "group-card";
  card.dataset.group = group.name;

  const standings = computeStandings(group);

  const title = document.createElement("div");
  title.className = "group-title";
  title.textContent = group.name;
  card.appendChild(title);

  // Standings table
  const table = document.createElement("table");
  table.className = "standings";
  table.innerHTML = `
    <thead><tr>
      <th class="team-col">Team</th>
      <th>P</th><th>W</th><th>D</th><th>L</th>
      <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
    </tr></thead>
    <tbody>
      ${standings.map((t, i) => {
        const cls = i < 2 ? "qualified" : (i === 2 ? "third-tied" : "");
        return `<tr class="${cls}" data-team="${t.team}">
          <td class="team-col">${flag(t.team)}<span>${t.team}</span></td>
          <td>${t.P}</td><td>${t.W}</td><td>${t.D}</td><td>${t.L}</td>
          <td>${t.GF}</td><td>${t.GA}</td><td>${t.GD > 0 ? "+" + t.GD : t.GD}</td>
          <td class="pts">${t.Pts}</td>
        </tr>`;
      }).join("")}
    </tbody>
  `;
  card.appendChild(table);

  // Match list
  const list = document.createElement("div");
  list.className = "match-list";
  for (const m of DATA.group_matches[group.name]) {
    list.appendChild(renderGroupMatch(m));
  }
  card.appendChild(list);

  return card;
}

function renderGroupMatch(m) {
  const row = document.createElement("div");
  row.className = "match-row-wrap";
  const sc = SCORES[m.id] || {};
  row.innerHTML = `
    <div class="match-row">
      <div class="team left">${flag(m.team1)}<span class="name">${m.team1}</span></div>
      <div class="score-input">
        <input type="number" min="0" max="20" data-match="${m.id}" data-side="s1" value="${sc.s1 ?? ""}" />
        <span class="dash">–</span>
        <input type="number" min="0" max="20" data-match="${m.id}" data-side="s2" value="${sc.s2 ?? ""}" />
      </div>
      <div class="team right"><span class="name">${m.team2}</span>${flag(m.team2)}</div>
    </div>
    <div class="match-meta"><span>${fmtDate(m.date)} · ${m.time}</span><span>${m.ground}</span></div>
  `;
  row.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", e => {
      setScore(e.target.dataset.match, e.target.dataset.side, e.target.value);
      // Recompute everything that depends on group results
      renderGroups();
      renderBracket();
      renderChampion();
    });
  });
  return row;
}

/* ── Best 3rd-placed teams ─────────── */
// 8 best 3rd-placed teams advance. We compute the 12 third-placed teams
// (one per group), rank them by Pts, GD, GF, and mark top 8 as qualified.
function getThirdPlacedRanking() {
  const thirds = [];
  for (const g of DATA.groups) {
    const standings = computeStandings(g);
    if (standings[2] && standings[2].P > 0) {
      thirds.push({ group: g.name, ...standings[2] });
    }
  }
  thirds.sort((a, b) =>
    b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team)
  );
  return thirds;
}

function highlightBestThirds() {
  const thirds = getThirdPlacedRanking();
  const top8 = new Set(thirds.slice(0, 8).map(t => t.group));
  document.querySelectorAll(".group-card").forEach(card => {
    const gname = card.dataset.group;
    const thirdRow = card.querySelector("tr.third-tied");
    if (!thirdRow) return;
    if (top8.has(gname)) {
      thirdRow.classList.remove("third-tied");
      thirdRow.classList.add("qualified");
    }
  });
}

/* ── Bracket ───────────────────────── */
// Map placeholder slot ("1A", "2B", "3A/B/C/D/F") → resolved team name (or null).
function resolveSlot(token) {
  if (!token) return null;
  // Direct team name (later rounds we'll patch via winners)
  if (DATA.flag_map[token]) return token;

  // Group-finishing slot e.g. "1A" / "2C"
  const direct = /^([12])([A-L])$/.exec(token);
  if (direct) {
    const pos = parseInt(direct[1], 10) - 1;
    const gname = "Group " + direct[2];
    const group = DATA.groups.find(g => g.name === gname);
    if (!group) return null;
    const standings = computeStandings(group);
    // Need ALL group matches played to commit a final position
    if (standings.every(t => t.P === 3)) return standings[pos].team;
    return null;
  }

  // 3rd-place slot e.g. "3A/B/C/D/F" — we need the top-3rd-place team
  // among the listed groups, drawn from the top-8 ranking.
  const thirdMatch = /^3([A-L/]+)$/.exec(token);
  if (thirdMatch) {
    const allowed = new Set(thirdMatch[1].split("/"));
    const ranking = getThirdPlacedRanking();
    if (ranking.length < 8) return null;
    // Only the top 8 third-placed teams qualify.
    const top8 = ranking.slice(0, 8);
    // Need all 12 thirds known (i.e. every group fully played) before assigning slots.
    // If not all groups have finished all 3 matches, we can't be sure which 8 advance.
    const allGroupsDone = DATA.groups.every(g => computeStandings(g).every(t => t.P === 3));
    if (!allGroupsDone) return null;
    for (const t of top8) {
      const letter = t.group.split(" ")[1];
      if (allowed.has(letter)) {
        // Use first matching one — FIFA's actual table maps which 3rd-placer
        // goes to which slot deterministically; with full results that maps the
        // top-ranked third in the allowed set to this slot.
        return t.team;
      }
    }
    return null;
  }

  // Knockout-winner slot e.g. "W74" / "L101"
  const wm = /^W(\d+)$/.exec(token);
  if (wm) return koWinner(parseInt(wm[1], 10));
  const lm = /^L(\d+)$/.exec(token);
  if (lm) return koLoser(parseInt(lm[1], 10));

  return null;
}

function koMatchById(id) {
  return DATA.ko_matches.find(m => m.id === id);
}
function koMatchByNum(n) {
  return DATA.ko_matches.find(m => m.num === n);
}
function koWinner(num) {
  const m = koMatchByNum(num);
  if (!m) return null;
  const t1 = resolveSlot(m.team1);
  const t2 = resolveSlot(m.team2);
  const sc = bothScores(m.id);
  if (!sc || !t1 || !t2) return null;
  if (sc.s1 > sc.s2) return t1;
  if (sc.s2 > sc.s1) return t2;
  return null; // Tie without a tiebreaker → user should bump one
}
function koLoser(num) {
  const m = koMatchByNum(num);
  if (!m) return null;
  const t1 = resolveSlot(m.team1);
  const t2 = resolveSlot(m.team2);
  const sc = bothScores(m.id);
  if (!sc || !t1 || !t2) return null;
  if (sc.s1 < sc.s2) return t1;
  if (sc.s2 < sc.s1) return t2;
  return null;
}

function renderBracket() {
  const wrap = document.getElementById("bracketWrap");
  wrap.innerHTML = "";

  const cols = [
    { title: "Round of 32",  cls: "r32",   round: "Round of 32" },
    { title: "Round of 16",  cls: "r16",   round: "Round of 16" },
    { title: "Quarter-finals", cls: "qf",  round: "Quarter-final" },
    { title: "Semi-finals",  cls: "sf",    round: "Semi-final" },
    { title: "Final",        cls: "final", round: "Final", extra: "Match for third place" },
  ];

  const bracket = document.createElement("div");
  bracket.className = "bracket";

  for (const c of cols) {
    const col = document.createElement("div");
    col.className = "bracket-col " + c.cls;
    const t = document.createElement("div");
    t.className = "col-title";
    t.textContent = c.title;
    col.appendChild(t);
    const matches = DATA.ko_matches.filter(m => m.round === c.round || m.round === c.extra);
    for (const m of matches) col.appendChild(renderKoMatch(m));
    bracket.appendChild(col);
  }
  wrap.appendChild(bracket);
}

function prettySlot(token) {
  if (!token) return "TBD";
  const direct = /^([12])([A-L])$/.exec(token);
  if (direct) return `${direct[1] === "1" ? "Winner" : "Runner-up"} Group ${direct[2]}`;
  const third = /^3([A-L/]+)$/.exec(token);
  if (third) return `3rd-place ${third[1].replace(/\//g, "/")}`;
  const wm = /^W(\d+)$/.exec(token);
  if (wm) return `Winner of M${wm[1]}`;
  const lm = /^L(\d+)$/.exec(token);
  if (lm) return `Loser of M${lm[1]}`;
  return token;
}

function renderKoMatch(m) {
  const t1 = resolveSlot(m.team1);
  const t2 = resolveSlot(m.team2);
  const sc = SCORES[m.id] || {};
  const winner = (() => {
    if (sc.s1 == null || sc.s2 == null) return null;
    if (sc.s1 > sc.s2) return 1;
    if (sc.s2 > sc.s1) return 2;
    return null;
  })();

  const div = document.createElement("div");
  div.className = "ko-match" + (m.round === "Final" ? " final-match" : "");
  div.innerHTML = `
    <div class="ko-row ${winner === 1 ? "winner" : ""}">
      <div class="team-name">
        ${t1 ? flag(t1) + `<span class="name">${t1}</span>` : `<span class="placeholder">${prettySlot(m.team1)}</span>`}
      </div>
      <input type="number" min="0" max="20" data-match="${m.id}" data-side="s1" value="${sc.s1 ?? ""}" />
    </div>
    <div class="ko-row ${winner === 2 ? "winner" : ""}">
      <div class="team-name">
        ${t2 ? flag(t2) + `<span class="name">${t2}</span>` : `<span class="placeholder">${prettySlot(m.team2)}</span>`}
      </div>
      <input type="number" min="0" max="20" data-match="${m.id}" data-side="s2" value="${sc.s2 ?? ""}" />
    </div>
    <div class="ko-meta">${m.num ? "Match " + m.num + " · " : ""}${fmtDate(m.date)} · ${m.ground}</div>
  `;
  div.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", e => {
      setScore(e.target.dataset.match, e.target.dataset.side, e.target.value);
      renderBracket();
      renderChampion();
    });
  });
  return div;
}

/* ── Champion ──────────────────────── */
function renderChampion() {
  const finalM = DATA.ko_matches.find(m => m.round === "Final");
  const thirdM = DATA.ko_matches.find(m => m.round === "Match for third place");
  const t1 = finalM ? resolveSlot(finalM.team1) : null;
  const t2 = finalM ? resolveSlot(finalM.team2) : null;
  const fsc = finalM ? bothScores(finalM.id) : null;
  let champ = null, runner = null;
  if (fsc && t1 && t2) {
    if (fsc.s1 > fsc.s2)      { champ = t1; runner = t2; }
    else if (fsc.s2 > fsc.s1) { champ = t2; runner = t1; }
  }
  const tt1 = thirdM ? resolveSlot(thirdM.team1) : null;
  const tt2 = thirdM ? resolveSlot(thirdM.team2) : null;
  const tsc = thirdM ? bothScores(thirdM.id) : null;
  let third = null;
  if (tsc && tt1 && tt2) {
    if (tsc.s1 > tsc.s2)      third = tt1;
    else if (tsc.s2 > tsc.s1) third = tt2;
  }

  const champEl = document.getElementById("championName");
  const subEl = document.getElementById("championSub");
  const podiumChamp = document.getElementById("podiumChamp");
  const runnerEl = document.getElementById("runnerUp");
  const thirdEl = document.getElementById("thirdPlace");

  if (champ) {
    champEl.innerHTML = `${flag(champ)} ${champ}`;
    subEl.textContent = `defeated ${runner} in the final`;
  } else {
    champEl.textContent = "—";
    subEl.textContent = "Fill in the final to crown a winner";
  }
  podiumChamp.innerHTML = champ ? `${flag(champ)} ${champ}` : "—";
  runnerEl.innerHTML  = runner ? `${flag(runner)} ${runner}` : "—";
  thirdEl.innerHTML   = third  ? `${flag(third)} ${third}`   : "—";
}

init();
