#!/usr/bin/env node
// Throwaway: classify detected noteheads by local ink shape to see what the
// false positives are (round noteheads vs elongated stems/beams/ledger lines).
import { readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPdfToPages, makeRenderPageCallback } from '../scripts/lib/renderPdfPages.mjs'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { buildMeasureBoxesForSystem } from '../src/features/omr/buildOmrMeasureGrid.js'
import { detectNoteheadsInMeasure } from '../src/features/omr/detectOmrNoteheads.js'
import { isInk } from '../src/features/omr/omrInk.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function inkAt(img, x, y, thr) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false
  return isInk(img.data, (y * img.width + x) * 4, thr)
}
// contiguous run width/height through (cx,cy)
function extent(img, cx, cy, thr) {
  let w = 1, h = 1
  for (let x = cx - 1; x >= 0 && inkAt(img, x, cy, thr); x -= 1) w += 1
  for (let x = cx + 1; x < img.width && inkAt(img, x, cy, thr); x += 1) w += 1
  for (let y = cy - 1; y >= 0 && inkAt(img, cx, y, thr); y -= 1) h += 1
  for (let y = cy + 1; y < img.height && inkAt(img, cx, y, thr); y += 1) h += 1
  return { w, h }
}

const pdf = process.argv[2]
const rendered = await renderPdfToPages(pdf, { rootDir: ROOT })
const renderPage = makeRenderPageCallback(rendered.pages)
const img = await renderPage(pdf, 1)
const bounds = detectContentBounds(img)
const { systems, inkThreshold } = detectStaffLineSystems(img, bounds, { stavesPerSystem: 2, countBarlines: true })

let measureStart = 1
const buckets = { round: 0, tall: 0, wide: 0, blob: 0, total: 0 }
for (let s = 0; s < systems.length; s += 1) {
  const boxes = buildMeasureBoxesForSystem({
    page: 1, systemIndex: s, system: systems[s], contentBounds: bounds, imageData: img,
    measureNumberStart: measureStart, darkThreshold: Math.min(inkThreshold, Math.max(145, inkThreshold - 22)),
  })
  measureStart += boxes.length
  for (const box of boxes) {
    const heads = detectNoteheadsInMeasure(img, box, inkThreshold, {})
    for (const hd of heads) {
      const { w, h } = extent(img, hd.cx, hd.cy, inkThreshold)
      buckets.total += 1
      const ar = w / Math.max(1, h)
      if (h >= 14 && ar < 0.6) buckets.tall += 1            // stem-like
      else if (w >= 12 && ar > 1.8) buckets.wide += 1       // beam/ledger-like
      else if (w >= 3 && h >= 3 && ar >= 0.5 && ar <= 2.0) buckets.round += 1 // notehead-like
      else buckets.blob += 1
    }
  }
}
console.log(JSON.stringify({ piece: basename(dirname(pdf)) || basename(pdf), inkThreshold, ...buckets,
  roundPct: Math.round(100 * buckets.round / Math.max(1, buckets.total)),
  elongatedPct: Math.round(100 * (buckets.tall + buckets.wide) / Math.max(1, buckets.total)) }))
