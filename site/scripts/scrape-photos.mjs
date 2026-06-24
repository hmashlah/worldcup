#!/usr/bin/env node
/**
 * Scrape player photos from Wikidata/Wikimedia Commons.
 * Reads squads.json, queries Wikidata for photos, adds photo_url field.
 *
 * Usage: node site/scripts/scrape-photos.mjs
 * 
 * Rate-limited: 50 players per batch with 1s delay between batches.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQUADS_PATH = path.resolve(__dirname, '../public/data/squads.json');

function getThumbUrl(filename) {
  const normalized = filename.replace(/ /g, '_');
  const md5 = crypto.createHash('md5').update(normalized).digest('hex');
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(normalized)}/250px-${encodeURIComponent(normalized)}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchBatch(titles, retries = 3) {
  const params = new URLSearchParams({
    action: 'wbgetentities',
    sites: 'enwiki',
    titles: titles.join('|'),
    props: 'claims|sitelinks',
    format: 'json',
    origin: '*',
  });

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`);
      if (res.status === 429) {
        const wait = (attempt + 1) * 10000;
        console.log(`\n  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        console.log(`\n  HTTP ${res.status}, retrying...`);
        await sleep(5000);
        continue;
      }

      const data = await res.json();
      const results = {};

      for (const [, entity] of Object.entries(data.entities || {})) {
        if (entity.missing !== undefined) continue;
        const title = entity.sitelinks?.enwiki?.title;
        if (!title) continue;
        const claims = entity.claims || {};
        const p18 = claims.P18;
        if (p18 && p18.length > 0) {
          const filename = p18[0]?.mainsnak?.datavalue?.value;
          if (filename) {
            results[title] = getThumbUrl(filename);
          }
        }
      }

      return results;
    } catch (e) {
      console.log(`\n  Error: ${e.message}, retrying...`);
      await sleep(5000);
    }
  }
  return {};
}

async function main() {
  const squads = JSON.parse(fs.readFileSync(SQUADS_PATH, 'utf-8'));

  // Collect all player names as Wikipedia article titles (skip those with photos already)
  const allPlayers = [];
  for (const [team, data] of Object.entries(squads)) {
    for (const player of data.players) {
      if (player.photo_url) continue; // Already have photo
      allPlayers.push({ team, name: player.name, wikiTitle: player.name.replace(/ /g, '_') });
    }
  }

  console.log(`Fetching photos for ${allPlayers.length} players...`);

  // Process in batches of 50
  const BATCH_SIZE = 20; // Smaller batches to avoid rate limits
  const photoMap = {}; // name -> url
  let found = 0;

  for (let i = 0; i < allPlayers.length; i += BATCH_SIZE) {
    const batch = allPlayers.slice(i, i + BATCH_SIZE);
    const titles = batch.map(p => p.wikiTitle);

    try {
      const results = await fetchBatch(titles);

      // Build a lowercase lookup for fuzzy matching
      const lowerResults = {};
      for (const [title, url] of Object.entries(results)) {
        lowerResults[title.toLowerCase()] = url;
      }

      for (const player of batch) {
        const url = lowerResults[player.name.toLowerCase()] || lowerResults[player.wikiTitle.toLowerCase().replace(/_/g, ' ')];
        if (url) {
          photoMap[`${player.name}|||${player.team}`] = url;
          found++;
        }
      }
    } catch (e) {
      console.error(`\nBatch ${i} failed:`, e.message);
    }

    const progress = Math.min(i + BATCH_SIZE, allPlayers.length);
    process.stdout.write(`\r  [${progress}/${allPlayers.length}] ${found} photos found`);

    // Save progress every 100 players
    if (progress % 100 === 0 || progress === allPlayers.length) {
      for (const [team, data] of Object.entries(squads)) {
        for (const player of data.players) {
          const key = `${player.name}|||${team}`;
          if (photoMap[key]) player.photo_url = photoMap[key];
        }
      }
      fs.writeFileSync(SQUADS_PATH, JSON.stringify(squads, null, 2));
    }

    if (i + BATCH_SIZE < allPlayers.length) {
      await sleep(5000); // 5s between batches — stay under Wikidata rate limits
    }
  }

  console.log(`\n\nFound ${found}/${allPlayers.length} photos (${Math.round(found / allPlayers.length * 100)}%)`);

  // Write back to squads.json
  for (const [team, data] of Object.entries(squads)) {
    for (const player of data.players) {
      const key = `${player.name}|||${team}`;
      player.photo_url = photoMap[key] || null;
    }
  }

  fs.writeFileSync(SQUADS_PATH, JSON.stringify(squads, null, 2));
  console.log(`Updated ${SQUADS_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
