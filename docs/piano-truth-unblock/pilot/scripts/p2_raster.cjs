#!/usr/bin/env node
/* P2 rasteriser: SVG -> PNG at fixed width, deterministic settings.
 *
 * Usage: node p2_raster.cjs <worklist.json> [--width 2480] [--limit N]
 * Worklist: [{ "svg": "...", "png": "..." }, ...]
 * Uses sharp from the pilot's node_modules (npm install sharp).
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const worklist = process.argv[2];
  if (!worklist) { console.error('usage: node p2_raster.cjs <worklist.json> [--width N] [--limit N]'); process.exit(2); }
  let width = 2480, limit = 0;
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--width') width = parseInt(process.argv[++i], 10);
    if (process.argv[i] === '--limit') limit = parseInt(process.argv[++i], 10);
  }
  const sharp = require('sharp');
  let items = JSON.parse(fs.readFileSync(worklist, 'utf8'));
  items = items.filter(it => !fs.existsSync(it.png));
  if (limit) items = items.slice(0, limit);
  console.log(`[raster] ${items.length} pages, width=${width}`);
  let done = 0;
  for (const it of items) {
    fs.mkdirSync(path.dirname(it.png), { recursive: true });
    await sharp(it.svg, { density: 96, limitInputPixels: false })
      .resize({ width, fit: 'inside' })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .toFile(it.png);
    done++;
    if (done % 100 === 0) console.log(`[raster] ${done}/${items.length}`);
  }
  console.log(`[raster] done ${done}/${items.length}`);
}

main().catch(e => { console.error('[raster] FAIL', e.message); process.exit(1); });
