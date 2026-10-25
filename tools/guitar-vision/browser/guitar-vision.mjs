// Corranzo Guitar Vision — browser-compatible PDF -> TAB -> MusicXML.
//
// License: project code. Runtime dependencies:
//   pdfjs-dist (Apache-2.0)  text + raster
// No Python, no PyMuPDF, no model weights, no external services.
//
// Stages: text extraction -> TAB staff geometry -> string/fret events ->
// rhythm (SMuFL noteheads + stems/beams) -> MusicXML.
//
// The module works in a browser and in Node. Node callers pass
// `createCanvas` (e.g. @napi-rs/canvas); browsers use document canvas.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const TUNING = [64, 59, 55, 50, 45, 40] // string 1 (high E) .. 6 (low E)
const SMUFL_NOTEHEADS = {
  '\ue0a0': ['whole', 4.0],
  '\ue0a2': ['half', 2.0],
  '\ue0a3': ['half', 2.0],
  '\ue0a4': ['quarter', 1.0],
}
const TYPE_BASES = [[4.0, 'whole'], [2.0, 'half'], [1.0, 'quarter'],
  [0.5, 'eighth'], [0.25, '16th'], [0.125, '32nd']]

// ---------------------------------------------------------------- extract
export async function loadPdf(data) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  return doc
}

export async function extractPage(doc, pageNo = 1, dpi = 150, createCanvas) {
  const page = await doc.getPage(pageNo)
  const scale = dpi / 72
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas ? createCanvas(viewport.width, viewport.height)
    : Object.assign(document.createElement('canvas'),
      { width: viewport.width, height: viewport.height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, viewport.width, viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const gray = new Uint8Array(canvas.width * canvas.height)
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    gray[j] = (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) | 0
  }
  const tc = await page.getTextContent()
  const items = []
  for (const it of tc.items) {
    const text = (it.str || '').trim()
    if (!text) continue
    const m = it.transform
    const x0 = m[4] * scale
    const y0 = viewport.height - (m[5] + (it.height || 0)) * scale
    items.push({
      text,
      font: it.fontName || '',
      size: Math.round((it.height || 0) * scale * 10) / 10,
      bbox: [x0, y0, x0 + (it.width || 0) * scale, y0 + (it.height || 0) * scale],
      cx: x0 + (it.width || 0) * scale / 2,
      cy: y0 + (it.height || 0) * scale / 2,
    })
  }
  return { gray, width: canvas.width, height: canvas.height, items, dpi }
}

// --------------------------------------------------------------- geometry
export function otsu(gray) {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  let total = gray.length, sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let wb = 0, sb = 0, best = 128, bestVar = -1
  for (let t = 0; t < 256; t++) {
    wb += hist[t]
    if (!wb) continue
    const wf = total - wb
    if (!wf) break
    sb += t * hist[t]
    const mb = sb / wb, mf = (sum - sb) / wf
    const v = wb * wf * (mb - mf) ** 2
    if (v > bestVar) { bestVar = v; best = t }
  }
  return best < 80 ? 128 : best
}

function longestRun(row, start, end) {
  let best = 0, cur = 0
  for (let x = start; x < end; x++) {
    if (row[x]) { cur++; if (cur > best) best = cur } else cur = 0
  }
  return best
}

export function lineBands(gray, width, height, thr, minrunFrac = 0.06) {
  const minrun = Math.max(width * minrunFrac, 40)
  const rows = []
  const row = new Uint8Array(width)
  for (let y = 0; y < height; y++) {
    const off = y * width
    for (let x = 0; x < width; x++) row[x] = gray[off + x] <= thr ? 1 : 0
    if (longestRun(row, 0, width) >= minrun) rows.push(y)
  }
  const bands = []
  if (!rows.length) return bands
  let start = rows[0], prev = rows[0]
  for (const r of rows.slice(1)) {
    if (r - prev > 3) { bands.push((start + prev) / 2); start = r }
    prev = r
  }
  bands.push((start + prev) / 2)
  return bands
}

export function tabStaves(bands) {
  const out = []
  for (let i = 0; i + 6 <= bands.length; i++) {
    const m = bands.slice(i, i + 6)
    const gaps = []
    for (let k = 1; k < 6; k++) gaps.push(m[k] - m[k - 1])
    const mg = gaps.reduce((a, b) => a + b, 0) / 5
    if (mg < 4 || mg > 80) continue
    const cv = Math.sqrt(gaps.reduce((a, g) => a + (g - mg) ** 2, 0) / 5) / mg
    if (cv > 0.18) continue
    out.push({ top: m[0], bot: m[5], gap: mg })
  }
  return out
}

export function digitItems(items) {
  const out = []
  for (const it of items) {
    if (!/^\d+$/.test(it.text)) continue
    const v = parseInt(it.text, 10)
    if (v < 0 || v > 24) continue
    const [x0, y0, x1, y1] = it.bbox
    const w = x1 - x0, h = y1 - y0
    if (h <= 0 || w > 3.2 * h || h > 40) continue
    out.push({ ...it, fret: v, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 })
  }
  return out
}

export function dominantDigitGroup(digits) {
  if (!digits.length) return digits
  const key = d => `${d.font}|${Math.round(d.size / 2)}`
  const counts = new Map()
  for (const d of digits) counts.set(key(d), (counts.get(key(d)) || 0) + 1)
  let best = null, n = -1
  for (const [k, c] of counts) if (c > n) { n = c; best = k }
  return digits.filter(d => key(d) === best)
}

export function filterStavesByDigits(staves, digits, minSupport = 3) {
  const keep = []
  for (const s of staves) {
    const m = 0.6 * s.gap
    const inside = digits.filter(d => s.top - m <= d.cy && d.cy <= s.bot + m)
    if (inside.length < minSupport) continue
    const lines = Array.from({ length: 6 }, (_, k) => s.top + k * s.gap)
    const tol = 0.3 * s.gap
    const res = inside.map(d => Math.min(...lines.map(l => Math.abs(d.cy - l))))
    const aligned = res.filter(r => r <= tol).length
    keep.push({ ...s, digit_support: inside.length, aligned, resid: res.reduce((a, b) => a + b, 0) })
  }
  const filtered = keep.filter(s => s.aligned >= 0.5 * s.digit_support)
  filtered.sort((a, b) => a.resid - b.resid)
  const chosen = []
  for (const s of filtered) {
    if (chosen.some(c => !(s.bot < c.top - 2 || s.top > c.bot + 2))) continue
    chosen.push(s)
  }
  chosen.sort((a, b) => a.top - b.top)
  return chosen
}

export function staffBarlines(gray, width, staff, otsuThr) {
  const ink = (x, y) => gray[y * width + x] <= otsuThr
  const top = Math.round(staff.top), bot = Math.round(staff.bot)
  const span = bot - top + 1
  if (span < 10) return []
  const cols = []
  for (let x = 0; x < width; x++) {
    let n = 0
    for (let y = top; y <= bot; y++) if (ink(x, y)) n++
    if (n / span >= 0.75) cols.push(x)
  }
  const merged = []
  let prev = -99
  for (const c of cols) {
    if (c - prev <= 3) { prev = c; continue }
    merged.push(c); prev = c
  }
  const out = []
  prev = -999
  for (const c of merged) {
    if (c - prev < 15) { prev = c; continue }
    out.push(c); prev = c
  }
  return out
}

function bisectLeft(arr, v) {
  let lo = 0, hi = arr.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid }
  return lo
}

export function assignEvents(items, staves, barlines) {
  const digits = digitItems(items)
  const per = {}
  for (let i = 0; i < staves.length; i++) per[i] = Math.max(1, (barlines[i] || []).length - 1)
  const offset = {}
  let acc = 0
  for (const i of Object.keys(per).map(Number).sort((a, b) => a - b)) { offset[i] = acc; acc += per[i] }
  const events = []
  for (const d of digits) {
    let best = null
    for (let i = 0; i < staves.length; i++) {
      const s = staves[i], m = 0.6 * s.gap
      if (s.top - m <= d.cy && d.cy <= s.bot + m) { best = i; break }
    }
    if (best === null) continue
    const s = staves[best]
    const string = Math.round((d.cy - s.top) / s.gap) + 1
    if (string < 1 || string > 6) continue
    const bars = barlines[best] || []
    const measure = offset[best] + Math.max(1, bisectLeft(bars, d.cx))
    events.push({ staff: best, string, fret: d.fret, measure, x: d.cx, y: d.cy, font: d.font })
  }
  events.sort((a, b) => a.staff - b.staff || a.measure - b.measure || a.x - b.x || a.string - b.string)
  return events
}

// ----------------------------------------------------------------- rhythm
export function notationNoteheads(items) {
  // A PDF text run may contain several SMuFL glyphs plus spaces
  // (e.g. "\uE0A4 \uE0A4 \uE0A4"). PDF.js exposes the run width but not
  // per-character advances. Derive the notehead advance from standalone
  // runs, then solve the space advance from the run width; positions are
  // cumulative. This is font/page derived, not a fixed offset.
  const single = []
  for (const it of items) {
    const txt = it.text || ''
    if (txt.length === 1 && SMUFL_NOTEHEADS[txt]) single.push(it.bbox[2] - it.bbox[0])
  }
  single.sort((a, b) => a - b)
  const advNote = single.length ? single[single.length >> 1] : 0
  const out = []
  for (const it of items) {
    const txt = it.text || ''
    if (!txt) continue
    const chars = [...txt]
    if (!chars.some(ch => SMUFL_NOTEHEADS[ch])) continue
    const [x0, y0, x1, y1] = it.bbox
    const width = x1 - x0
    const nH = chars.filter(ch => SMUFL_NOTEHEADS[ch]).length
    const nS = chars.filter(ch => ch === ' ').length
    let advSpace = 0
    let noteAdv = advNote
    if (chars.length === 1) {
      noteAdv = width || advNote
    } else if (nS > 0 && noteAdv > 0) {
      advSpace = (width - nH * noteAdv) / nS
      if (!(advSpace >= 0) || advSpace > noteAdv * 2) advSpace = 0
    } else {
      noteAdv = width / Math.max(chars.length, 1)
    }
    let cursor = x0
    for (const ch of chars) {
      const adv = ch === ' ' ? (advSpace || noteAdv) : noteAdv
      if (SMUFL_NOTEHEADS[ch]) {
        const [kind, base] = SMUFL_NOTEHEADS[ch]
        out.push({ kind, base, box: [cursor, y0, cursor + adv, y1],
          cx: cursor + adv / 2, cy: (y0 + y1) / 2, w: adv, h: y1 - y0,
          split: chars.length > 1, sourceIndex: out.length })
      }
      cursor += adv
    }
  }
  out.sort((a, b) => a.cx - b.cx)
  return out
}

export function timeSignature(items) {
  const glyphs = []
  for (const it of items) {
    const ch = (it.text || '').trim()[0]
    if (!ch) continue
    const cp = ch.codePointAt(0)
    if (cp >= 0xE080 && cp <= 0xE089) {
      const [x0, y0, x1, y1] = it.bbox
      glyphs.push({ digit: cp - 0xE080, x0, cy: (y0 + y1) / 2, h: y1 - y0 })
    }
  }
  if (!glyphs.length) return [[4, 4], 'default']
  const h = Median(glyphs.map(g => g.h))
  const rows = []
  for (const g of glyphs.sort((a, b) => a.cy - b.cy || a.x0 - b.x0)) {
    const r = rows.find(r => Math.abs(g.cy - r.cy) <= 0.5 * h)
    if (r) { r.digits.push(g); r.cy = r.digits.reduce((a, d) => a + d.cy, 0) / r.digits.length } else rows.push({ cy: g.cy, digits: [g] })
  }
  for (const r of rows) r.text = r.digits.sort((a, b) => a.x0 - b.x0).map(d => d.digit).join('')
  rows.sort((a, b) => a.cy - b.cy)
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1]
    if (Math.abs(a.digits[0].x0 - b.digits[0].x0) <= 0.8 * h && b.cy - a.cy >= 0.2 * h && b.cy - a.cy <= 1.8 * h) {
      const num = parseInt(a.text, 10), den = parseInt(b.text, 10)
      if (num >= 1 && num <= 32 && den >= 1 && den <= 32) return [[num, den], 'smufl-glyphs']
    }
  }
  return [[4, 4], 'default']
}

function Median(a) { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0 }

export function noteheadColumns(noteheads) {
  if (!noteheads.length) return []
  const tol = Math.max(2, 0.6 * Median(noteheads.map(n => n.w)))
  const cols = []
  for (const n of [...noteheads].sort((a, b) => a.cx - b.cx)) {
    const last = cols[cols.length - 1]
    if (last && n.cx - last.cx <= tol) {
      last.members.push(n)
      last.x0 = Math.min(last.x0, n.box[0]); last.x1 = Math.max(last.x1, n.box[2])
      last.y0 = Math.min(last.y0, n.box[1]); last.y1 = Math.max(last.y1, n.box[3])
    } else cols.push({ cx: n.cx, x0: n.box[0], x1: n.box[2], y0: n.box[1], y1: n.box[3], members: [n] })
  }
  return cols
}

function bridgedRun(gray, width, height, x, start, step) {
  // Count ink rows while bridging small gaps (anti-aliasing / staff
  // crossings), mirroring the raster research probe.
  let ink = 0, gap = 0, y = start
  while (y >= 0 && y < height) {
    if (gray[y * width + x] <= 200) { ink++; gap = 0 }
    else { gap++; if (gap > 6) break }
    y += step
  }
  return ink
}
export function detectBeams(gray, width, height, thr = 128) {
  // Beam mask: pixels belonging to horizontal ink runs >= 60px, then
  // components with 3..25px thickness. Mirrors the verified Python
  // (5x60 opening + height filter); staff lines are 1-2px and die.
  const run = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    let x = 0
    const off = y * width
    while (x < width) {
      if (gray[off + x] <= thr) {
        let e = x
        while (e < width && gray[off + e] <= thr) e++
        if (e - x >= 60) for (let k = x; k < e; k++) run[off + k] = 1
        x = e
      } else x++
    }
  }
  const seen = new Uint8Array(width * height)
  const mask = new Uint8Array(width * height)
  const stack = []
  for (let i = 0; i < run.length; i++) {
    if (!run[i] || seen[i]) continue
    stack.length = 0; stack.push(i); seen[i] = 1
    const pix = []
    let minY = height, maxY = 0
    while (stack.length) {
      const j = stack.pop(); pix.push(j)
      const y = (j / width) | 0, x = j % width
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const k = ny * width + nx
        if (run[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      }
    }
    const h = maxY - minY + 1
    if (pix.length >= 60 && h >= 3 && h <= 25) for (const j of pix) mask[j] = 1
  }
  return mask
}

export function columnEvidence(col, gray, beamMask, width, height, minRun, sideTol, gapEst) {
  const ink = y => gray[y * width] <= 128
  let best = { run: 0, stem: false, beams: 0, flags: 0, x: 0, tip: 0, up: true, span: [0, 0] }
  for (const m of col.members) {
    const [x0, y0, x1, y1] = m.box.map(Math.round)
    for (const [edge, up] of [[x1, true], [x0, false]]) {
      for (let x = Math.max(Math.round(edge - sideTol), 0); x <= Math.min(Math.round(edge + sideTol), width - 1); x++) {
        const start = up ? y0 : y1
        let run = 0, gap = 0, yy = start
        while (yy >= 0 && yy < height) {
          if (gray[yy * width + x] <= 128) { run++; gap = 0 }
          else { gap++; if (gap > 6) break }
          yy += up ? -1 : 1
        }
        if (run > best.run) {
          best = {
            run, stem: run >= minRun, beams: 0, flags: 0, x,
            tip: up ? y0 - run : y1 + run, up,
            span: up ? [y0 - run, y0] : [y1, y1 + run],
          }
        }
      }
    }
  }
  if (!best.stem) return best
  // Beams: distinct beam-mask row groups along the full stem column.
  let groups = 0, prev = -99
  const yLo = Math.max(Math.min(...best.span) - 4, 0)
  const yHi = Math.min(Math.max(...best.span) + 4, height - 1)
  for (let y = yLo; y <= yHi; y++) {
    let hit = false
    for (let x = Math.max(best.x - 6, 0); x <= Math.min(best.x + 6, width - 1); x++) {
      if (beamMask[y * width + x]) { hit = true; break }
    }
    if (hit) { if (y - prev > 3) groups++; prev = y }
  }
  best.beams = groups
  // Flags: ink beside the stem tip, beyond the measured stem width.
  // Sample the stem on a clean section near the notehead end; a staff
  // line crossing one sample would otherwise be measured as the stem.
  const fw = Math.max(12, Math.round(0.4 * gapEst))
  const fh = Math.max(12, Math.round(0.3 * gapEst))
  const runLen = Math.max(best.run, 1)
  const base = best.up ? Math.max(...best.span) - Math.max(2, runLen / 5 | 0)
    : Math.min(...best.span) + Math.max(2, runLen / 5 | 0)
  const widths = []
  for (const dy of [-6, -3, 0, 3, 6]) {
    const y = base + dy
    if (y < 0 || y >= height) continue
    let w = 1
    if (best.up) { while (best.x + w < width && ink(y * width + best.x + w)) w++ }
    else { while (best.x - w >= 0 && ink(y * width + best.x - w)) w++ }
    if (ink(y * width + best.x)) widths.push(w)
  }
  let wstem = widths.length ? Math.min(...widths) : 1
  wstem = Math.min(wstem, Math.max(2, Math.round(0.2 * gapEst)))
  const fx0 = best.x + wstem + 1
  const fx1 = Math.min(fx0 + fw, width)
  const fy0 = best.up ? best.tip + 2 : best.tip - 2 - fh
  const fy1 = best.up ? best.tip + 2 + fh : best.tip - 2
  let inkCount = 0
  for (let y = Math.max(fy0, 0); y < Math.min(fy1, height); y++) {
    let row = 0
    for (let x = fx0; x < fx1; x++) if (gray[y * width + x] <= 128) row++
    if (row > 0 && row < 0.8 * (fx1 - fx0)) inkCount += row
  }
  best.flags = inkCount >= 5 ? 1 : 0
  return best
}

export function durationFromEvidence(col, ev) {
  const bases = [...new Set(col.members.map(m => m.base))].sort((a, b) => b - a)
  const base = bases[0]
  const ambiguous = bases.length > 1
  const beams = ev.beams || 0
  const flags = ev.flags || 0
  let dur, conf
  if (base >= 4) { dur = 4; conf = true }
  else if (base >= 2) { dur = 2; conf = true }
  else {
    const steps = Math.min(Math.max(beams, flags), 3)
    const conflict = beams > 0 && flags > 0
    dur = 1 / (2 ** steps)
    conf = !!ev.stem && !conflict
  }
  return { duration: dur, beams, flags, stem: !!ev.stem,
    confident: conf && !ambiguous, ambiguous, beam_flag_conflict: beams > 0 && flags > 0 }
}

function attachRhythm(events, items, staves, gray, width, height, beamMask) {
  const [ts, tsSource] = timeSignature(items)
  const beats = ts[0] * 4 / ts[1]
  const noteheads = notationNoteheads(items)
  const source = noteheads.length ? 'smufl-glyphs' : 'none'
  const noteByStaff = new Map()
  for (const g of noteheads) {
    let best = null, bd = Infinity
    for (let i = 0; i < staves.length; i++) {
      const s = staves[i], d = g.cy < s.top ? s.top - g.cy : g.cy > s.bot ? g.cy - s.bot : 0
      if (d < bd) { bd = d; best = i }
    }
    if (best !== null) { if (!noteByStaff.has(best)) noteByStaff.set(best, []); noteByStaff.get(best).push(g) }
  }
  // onsets from TAB events
  const groups = new Map()
  for (const e of events) {
    const k = `${e.staff}|${e.measure}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(e)
  }
  const onsets = []
  for (const [k, evs] of groups) {
    const [staff, measure] = k.split('|').map(Number)
    evs.sort((a, b) => a.x - b.x)
    let cur = [evs[0]]
    for (const e of evs.slice(1)) {
      if (e.x - cur[cur.length - 1].x <= 1.5) cur.push(e)
      else { onsets.push({ staff, measure, x: cur.reduce((a, v) => a + v.x, 0) / cur.length, events: cur }); cur = [e] }
    }
    onsets.push({ staff, measure, x: cur.reduce((a, v) => a + v.x, 0) / cur.length, events: cur })
  }
  onsets.sort((a, b) => a.staff - b.staff || a.measure - b.measure || a.x - b.x)
  const raw = new Map()
  const pairing = []
  for (let si = 0; si < staves.length; si++) {
    const os_ = onsets.filter(o => o.staff === si)
    const cols = noteheadColumns(noteByStaff.get(si) || [])
    const exact = os_.length === cols.length
    pairing.push({ staff: si, onsets: os_.length, columns: cols.length, exact })
    for (let i = 0; i < os_.length; i++) {
      const o = os_[i]
      const c = exact ? cols[i] : null
      // Written value from the SMuFL notehead plus stem/beam/flag
      // evidence, exactly as in the verified research probe. With no
      // notation counterpart the duration is genuinely unknown (null).
      let dur = null, beams = 0, flags = 0, stem = false, conf = false
      if (c) {
        const s = staves[si]
        const gaps = []
        if (i) gaps.push(c.cx - cols[i - 1].cx)
        if (i + 1 < cols.length) gaps.push(cols[i + 1].cx - c.cx)
        const side = Math.max(3, Math.min(16, 0.45 * Math.min(...(gaps.length ? gaps : [s.gap]))))
        const ev = columnEvidence(c, gray, beamMask, width, height, 1.6 * s.gap, side, s.gap)
        const d = durationFromEvidence(c, ev)
        dur = d.duration; beams = d.beams; flags = d.flags
        stem = d.stem; conf = d.confident
      }
      raw.set(`${si}|${o.measure}|${o.x.toFixed(2)}`, { duration: dur, beams, flags, stem, confident: conf })
      for (const e of o.events) e.rhythm = raw.get(`${si}|${o.measure}|${o.x.toFixed(2)}`)
    }
  }
  // measure validation
  const byMeasure = new Map()
  for (const o of onsets) {
    if (!byMeasure.has(o.measure)) byMeasure.set(o.measure, [])
    byMeasure.get(o.measure).push(o)
  }
  let valid = 0
  const report = {}
  for (const [m, os_] of [...byMeasure].sort((a, b) => a[0] - b[0])) {
    const keys = os_.map(o => `${o.staff}|${m}|${o.x.toFixed(2)}`)
    const total = keys.reduce((a, k) => a + raw.get(k).duration, 0)
    const complete = Math.abs(total - beats) <= 0.02
    if (complete) valid++
    if (!complete) for (const k of keys) raw.get(k).confident = false
    report[m] = { onsets: os_.length, quarters: +total.toFixed(3), expected: beats, complete }
  }
  const confident = onsets.filter(o => raw.get(`${o.staff}|${o.measure}|${o.x.toFixed(2)}`).confident).length
  return {
    stats: {
      time_signature: `${ts[0]}/${ts[1]}`, time_signature_source: tsSource,
      noteheads: noteheads.length, notehead_source: source,
      onsets: onsets.length, onsets_confident: confident,
      duration_source: 'smufl-notehead+stem/beam/flag evidence',
      measures_complete: valid, measures_total: byMeasure.size,
      staff_pairing: pairing,
      voice_ownership: pairing.every(p => p.exact) ? 'single-voice' : 'unresolved-multi-voice',
    },
    beats,
  }
}

// --------------------------------------------------------------- musicxml
function midiName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const n = names[((midi % 12) + 12) % 12]
  return [n[0], n.includes('#') ? 1 : 0, Math.floor(midi / 12) - 1]
}
function typeFor(q) {
  for (const [base, name] of TYPE_BASES) {
    for (const dots of [0, 1, 2]) if (Math.abs(q - base * 1.5 ** dots) <= 0.011) return [name, dots]
  }
  return [null, 0]
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function toMusicXML(events, { divisions = 480, timeSig = [4, 4], rhythmSource = 'none' } = {}) {
  const measures = new Map()
  for (const e of events) {
    if (!measures.has(e.measure)) measures.set(e.measure, [])
    measures.get(e.measure).push(e)
  }
  const nums = [...measures.keys()].sort((a, b) => a - b)
  const first = nums[0]
  const rows = []
  rows.push('<?xml version="1.0" encoding="UTF-8"?>')
  rows.push('<score-partwise version="4.0">')
  rows.push('<identification><miscellaneous>')
  rows.push(`<miscellaneous-field name="rhythm-source">${esc(rhythmSource)}</miscellaneous-field>`)
  rows.push(`<miscellaneous-field name="rhythm-time-signature">${timeSig[0]}/${timeSig[1]}</miscellaneous-field>`)
  rows.push('</miscellaneous></identification>')
  rows.push('<part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>')
  rows.push('<part id="P1">')
  for (const m of nums) {
    rows.push(`<measure number="${m}">`)
    rows.push('<attributes>')
    rows.push(`<divisions>${divisions}</divisions>`)
    if (m === first) {
      rows.push('<key><fifths>0</fifths></key>')
      rows.push(`<time><beats>${timeSig[0]}</beats><beat-type>${timeSig[1]}</beat-type></time>`)
      rows.push('<clef><sign>TAB</sign><line>5</line></clef>')
      rows.push('<staff-details><staff-lines>6</staff-lines>')
      for (let sn = 1; sn <= 6; sn++) {
        const [step, alter, octave] = midiName(TUNING[sn - 1])
        rows.push(`<staff-tuning number="${sn}"><tuning-step>${step}</tuning-step>${alter ? '<tuning-alter>1</tuning-alter>' : ''}<tuning-octave>${octave}</tuning-octave></staff-tuning>`)
      }
      rows.push('</staff-details>')
    }
    rows.push('</attributes>')
    const notes = measures.get(m).sort((a, b) => a.x - b.x || a.string - b.string)
    let prevX = null
    for (const e of notes) {
      const rt = e.rhythm || {}
      const q = rt.duration
      rows.push('<note>')
      if (prevX !== null && Math.abs(e.x - prevX) <= 1.5) rows.push('<chord/>')
      prevX = e.x
      const midi = TUNING[e.string - 1] + e.fret
      const [step, alter, octave] = midiName(midi)
      rows.push(`<pitch><step>${step}</step>${alter ? '<alter>1</alter>' : ''}<octave>${octave}</octave></pitch>`)
      if (q == null) {
        rows.push(`<duration>${divisions}</duration>`)
        rows.push('<footnote>duration not recovered (declared placeholder, not measured rhythm)</footnote>')
      } else {
        rows.push(`<duration>${Math.round(q * divisions)}</duration>`)
        if (!rt.confident) rows.push('<footnote>duration unverified (notation evidence incomplete)</footnote>')
      }
      rows.push('<voice>1</voice>')
      if (q != null) {
        const [name, dots] = typeFor(q)
        if (name) {
          rows.push(`<type>${name}</type>`)
          for (let i = 0; i < dots; i++) rows.push('<dot/>')
        }
      }
      rows.push(`<notations><technical><string>${e.string}</string><fret>${e.fret}</fret></technical></notations>`)
      rows.push('</note>')
    }
    rows.push('</measure>')
  }
  rows.push('</part></score-partwise>')
  return rows.join('\n')
}

// ------------------------------------------------------- notation rhythm
// Standalone rhythm analysis for notation-only pages (no TAB digits).
// Used to validate beam/flag classification against MusicXML references.
export async function analyzeNotationRhythm(data, { dpi = 150, pageNo = 1, createCanvas } = {}) {
  const doc = await loadPdf(data)
  const page = await extractPage(doc, pageNo, dpi, createCanvas)
  const beamMask = detectBeams(page.gray, page.width, page.height)
  let nh = notationNoteheads(page.items)
  if (!nh.length) return { rows: [], noteheads: 0, systems: 0 }
  const h = Median(nh.map(n => n.h))
  nh = [...nh].sort((a, b) => a.cy - b.cy)
  const systems = [[nh[0]]]
  for (const n of nh.slice(1)) {
    if (n.cy - systems[systems.length - 1][systems[systems.length - 1].length - 1].cy > 6 * h) systems.push([n])
    else systems[systems.length - 1].push(n)
  }
  const rows = []
  systems.forEach((sys, si) => {
    const cols = noteheadColumns(sys)
    const gap = h / 2
    cols.forEach((c, i) => {
      const gaps = []
      if (i) gaps.push(c.cx - cols[i - 1].cx)
      if (i + 1 < cols.length) gaps.push(cols[i + 1].cx - c.cx)
      const side = Math.max(3, Math.min(16, 0.45 * Math.min(...(gaps.length ? gaps : [gap]))))
      const ev = columnEvidence(c, page.gray, beamMask, page.width, page.height, 1.6 * gap, side, gap)
      const d = durationFromEvidence(c, ev)
      rows.push({ system: si, x: +c.cx.toFixed(1), ...d })
    })
  })
  return { rows, noteheads: nh.length, systems: systems.length }
}

// ------------------------------------------------------------------- main
export async function recognizePdf(data, { dpi = 150, pageNo = 1, createCanvas } = {}) {
  const t0 = Date.now()
  const doc = await loadPdf(data)
  const page = await extractPage(doc, pageNo, dpi, createCanvas)
  const otsuThr = otsu(page.gray)
  let bands = lineBands(page.gray, page.width, page.height, 128)
  let staves = filterStavesByDigits(tabStaves(bands), dominantDigitGroup(digitItems(page.items)))
  let threshold = 128
  if (!staves.length) {
    bands = lineBands(page.gray, page.width, page.height, otsuThr)
    staves = filterStavesByDigits(tabStaves(bands), dominantDigitGroup(digitItems(page.items)))
    threshold = otsuThr
  }
  const barlines = {}
  for (let i = 0; i < staves.length; i++) barlines[i] = staffBarlines(page.gray, page.width, staves[i], otsuThr)
  const events = assignEvents(page.items, staves, barlines)
  const beamMask = detectBeams(page.gray, page.width, page.height)
  const rhythm = attachRhythm(events, page.items, staves, page.gray, page.width, page.height, beamMask)
  const [ts] = timeSignature(page.items)
  const recovered = rhythm.stats.onsets > 0 &&
    rhythm.stats.staff_pairing.every(p => p.exact) &&
    rhythm.stats.measures_total > 0 &&
    rhythm.stats.measures_complete === rhythm.stats.measures_total
  const xml = toMusicXML(events, { timeSig: ts,
    rhythmSource: recovered ? 'smufl-notehead+stem/beam/flag' : 'unrecovered-placeholder' })
  return {
    events, xml, staves, barlines, items: page.items,
    summary: {
      text_items: page.items.length, staff_bands: bands.length, tab_staves: staves,
      events: events.length, barlines,
      rhythm_recovered: recovered,
      playable: recovered,
      rhythm: rhythm.stats,
      runtime_ms: Date.now() - t0,
      threshold,
    },
  }
}
