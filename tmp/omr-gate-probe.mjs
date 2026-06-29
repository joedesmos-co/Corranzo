#!/usr/bin/env node
// Throwaway: for one page, replicate the detector's merge then report which shape
// gate rejects each merged blob — to find what is costing recall on Brahms.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPdfToPages, makeRenderPageCallback } from '../scripts/lib/renderPdfPages.mjs'
import { detectContentBounds } from '../src/features/score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../src/features/score-follow/detectStaffLines.js'
import { buildMeasureBoxesForSystem } from '../src/features/omr/buildOmrMeasureGrid.js'
import { isInk, contentPixelBounds } from '../src/features/omr/omrInk.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))
function ssPx(mb, height) {
  const t = mb?.staffLines?.treble, b = mb?.staffLines?.bass
  const lines = Array.isArray(t) && t.length >= 2 ? t : b
  if (Array.isArray(lines) && lines.length >= 2) {
    const ys = [...lines].map((v) => v * height).sort((a, c) => a - c)
    const sp = (ys[ys.length - 1] - ys[0]) / (ys.length - 1)
    if (sp >= 3 && sp <= 48) return sp
  }
  return 8
}
function fill(img, cx, cy, thr, b, hw, hh) {
  let d = 0, t = 0
  for (let y = cy - hh; y <= cy + hh; y++) { if (y < b.top || y > b.bottom) continue
    for (let x = cx - hw; x <= cx + hw; x++) { if (x < b.left || x > b.right) continue; t++; if (isInk(img.data, (y * img.width + x) * 4, thr)) d++ } }
  return t ? d / t : 0
}
function hrun(img, cx, cy, thr, left, right, sh) {
  const ink = (x) => x >= left && x <= right && isInk(img.data, (cy * img.width + x) * 4, thr)
  let c = cx
  if (!ink(c)) { c = -1; for (let dd = 1; dd <= sh; dd++) { if (ink(cx - dd)) { c = cx - dd; break } if (ink(cx + dd)) { c = cx + dd; break } } if (c < 0) return 0 }
  let a = c, z = c; while (a - 1 >= left && ink(a - 1)) a--; while (z + 1 <= right && ink(z + 1)) z++; return z - a + 1
}
function bbox(img, cx, cy, thr, rx, ry) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, n = 0
  for (let y = cy - ry; y <= cy + ry; y++) { if (y < 0 || y >= img.height) continue
    for (let x = cx - rx; x <= cx + rx; x++) { if (x < 0 || x >= img.width) continue; if (isInk(img.data, (y * img.width + x) * 4, thr)) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; n++ } } }
  return n === 0 ? { w: 0, h: 0, n: 0 } : { w: maxX - minX + 1, h: maxY - minY + 1, n }
}

const pdf = process.argv[2]
const rendered = await renderPdfToPages(pdf, { rootDir: ROOT })
const img = await makeRenderPageCallback(rendered.pages)(pdf, 1)
const cb = detectContentBounds(img)
const { systems, inkThreshold } = detectStaffLineSystems(img, cb, { stavesPerSystem: 2, countBarlines: true })
const rej = { hrun: 0, midFill: 0, outerFill: 0, blob: 0, aspect: 0, pass: 0 }
const ssList = []
let mStart = 1
for (let s = 0; s < systems.length; s++) {
  const boxes = buildMeasureBoxesForSystem({ page: 1, systemIndex: s, system: systems[s], contentBounds: cb, imageData: img, measureNumberStart: mStart, darkThreshold: Math.min(inkThreshold, Math.max(145, inkThreshold - 22)) })
  mStart += boxes.length
  for (const mb of boxes) {
    const ss = ssPx(mb, img.height); ssList.push(Math.round(ss))
    const b = contentPixelBounds(img, { x0: mb.playableX0 ?? mb.x0, x1: mb.x1, y0: mb.y0, y1: mb.y1 })
    const midHW = clampInt(ss * 0.75, 2, 12), midHH = clampInt(ss * 0.6, 2, 10)
    const outHW = clampInt(ss * 1.2, midHW + 2, 20), outHH = clampInt(ss * 0.95, midHH + 2, 18)
    const hrunMax = Math.max(12, Math.round(ss * 3)), midMin = 0.3, outMax = 0.86, blobMin = Math.max(3, Math.round(ss * 0.5))
    // crude candidate grid then nearest-merge by 7x5 to mimic detector blobs
    const pts = []
    for (let cy = b.top; cy <= b.bottom; cy += 3) for (let cx = b.left; cx <= b.right; cx += 3) {
      const { dark } = (() => { let d = 0; const h = 2; for (let y = cy - h; y <= cy + h; y++) for (let x = cx - h; x <= cx + h; x++) if (y >= b.top && y <= b.bottom && x >= b.left && x <= b.right && isInk(img.data, (y * img.width + x) * 4, inkThreshold)) d++; return { dark: d } })()
      if (dark >= 10) pts.push({ cx, cy })
    }
    const merged = []
    for (const p of pts) { const e = merged.find((m) => Math.abs(m.cx - p.cx) <= 7 && Math.abs(m.cy - p.cy) <= 5); if (e) { e.cx = Math.round((e.cx + p.cx) / 2); e.cy = Math.round((e.cy + p.cy) / 2) } else merged.push({ ...p }) }
    for (const m of merged) {
      if (hrun(img, m.cx, m.cy, inkThreshold, b.left, b.right, midHW) > hrunMax) { rej.hrun++; continue }
      if (fill(img, m.cx, m.cy, inkThreshold, b, midHW, midHH) < midMin) { rej.midFill++; continue }
      if (fill(img, m.cx, m.cy, inkThreshold, b, outHW, outHH) > outMax) { rej.outerFill++; continue }
      const bb = bbox(img, m.cx, m.cy, inkThreshold, outHW, outHH)
      if (bb.n === 0 || bb.w < blobMin || bb.h < blobMin) { rej.blob++; continue }
      const ar = bb.w / Math.max(1, bb.h)
      if (ar < 0.42 || ar > 2.4) { rej.aspect++; continue }
      rej.pass++
    }
  }
}
const ssSorted = ssList.sort((a, c) => a - c)
console.log(JSON.stringify({ ...rej, ssMedian: ssSorted[Math.floor(ssSorted.length / 2)] }))
