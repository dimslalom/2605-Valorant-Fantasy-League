/**
 * Syncs a Google Sheet to src/data/cards.json.
 *
 * Sheet column order (row 1 = header, skipped):
 *   id, player, org, region, tier, edition, rating, role,
 *   agents (comma-separated), photo,
 *   aim, positioning, ability, mentality, synergy,
 *   power_name, power_description, power_effect, power_value, power_duration,
 *   palette
 *
 * Usage:
 *   GOOGLE_SHEET_ID=<id> GOOGLE_API_KEY=<key> node scripts/sheet-to-json.js
 */

import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY = process.env.GOOGLE_API_KEY;
const OUTPUT_PATH = resolve(__dirname, '../src/data/cards.json');

if (!SHEET_ID || !API_KEY) {
  console.error('Missing GOOGLE_SHEET_ID or GOOGLE_API_KEY environment variables.');
  process.exit(1);
}

async function fetchSheet() {
  const sheets = google.sheets({ version: 'v4', auth: API_KEY });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1',
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) {
    console.error('Sheet is empty or has only a header row.');
    process.exit(1);
  }

  // Skip header row (index 0)
  const cards = rows.slice(1).map((row) => {
    const [
      id, player, org, region, tier, edition, rating, role,
      agentsRaw, photo,
      aim, positioning, ability, mentality, synergy,
      power_name, power_description, power_effect, power_value, power_duration,
      palette,
    ] = row;

    return {
      id,
      player,
      org,
      region,
      tier,
      edition,
      rating: Number(rating),
      role,
      agents: agentsRaw ? agentsRaw.split(',').map((a) => a.trim()) : [],
      photo: photo || '/photos/placeholder.jpg',
      stats: {
        aim: Number(aim),
        positioning: Number(positioning),
        ability: Number(ability),
        mentality: Number(mentality),
        synergy: Number(synergy),
      },
      power: {
        name: power_name,
        description: power_description,
        effect: power_effect,
        value: Number(power_value),
        duration: Number(power_duration),
      },
      palette,
    };
  });

  writeFileSync(OUTPUT_PATH, JSON.stringify(cards, null, 2));
  console.log(`Written ${cards.length} cards to ${OUTPUT_PATH}`);
}

fetchSheet().catch((err) => {
  console.error('Error fetching sheet:', err.message);
  process.exit(1);
});
