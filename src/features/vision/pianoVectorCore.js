#!/usr/bin/env node
/**
 * PDF.js-only vector OMR for piano notation (research prototype).
 *
 * Extracts staff lines, barlines, stems, beams and dots from the PDF.js
 * operator list, and SMuFL glyphs from getTextContent. Coordinates are page
 * points with a top-left origin (y = pageHeight - pdfY), matching the Python
 * research extractor. Emits the shared corranzo-notation-ir/1 JSON and a
 * rhythm-bearing MusicXML.
 *
 * Usage: node pdfjs_vector_omr.mjs <pdf> [out.musicxml]
 */

const STEP_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const BOTTOM = { treble: ['E', 4], bass: ['G', 2] }
const TYPE_Q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125 }
const TYPE_OF_BEAMS = { 0: 'quarter', 1: 'eighth', 2: '16th', 3: '32nd' }
const REST_TYPE = { 0xe4e3: 'whole', 0xe4e4: 'half', 0xe4e5: 'quarter', 0xe4e6: 'eighth', 0xe4e7: '16th', 0xe4e8: '32nd' }
const TIME_DIGIT = {}
for (let i = 0; i <= 9; i++) TIME_DIGIT[0xe080 + i] = String(i)

function groupLines(ys, tol = 2) {
  const s = [...ys].sort((a, b) => a - b)
  const out = []
  let cur = []
  for (const y of s) {
    if (!cur.length || y - cur[cur.length - 1] <= tol) cur.push(y)
    else { out.push(cur); cur = [y] }
  }
  if (cur.length) out.push(cur)
  return out
}


function decodePath(args) {
  // PDF.js 4.x: [kindArray, coordsArray]. 5.4.x: [paintOp, [pathData], minMax]
  if (Array.isArray(args[0])) {
    const kind = args[0]
    const c = args[1] || []
    const pops = kind.map((k) => k === 13 ? 0 : k === 14 ? 1 : k === 15 ? 2 : 3)
    return { paint: null, ops: pops, coords: c }
  }
  const paint = args[0]
  const data = args[1]
  if (!data || !data[0] || data[0] === null) return null
  const obj = data[0]
  const flat = Object.keys(obj).sort((a, b) => +a - +b).map((k) => obj[k])
  const pops = []
  const coords = []
  let i = 0
  while (i < flat.length) {
    const op = flat[i++]
    pops.push(op)
    if (op === 0 || op === 1) { coords.push(flat[i++], flat[i++]) }
    else if (op === 2) { for (let k = 0; k < 6; k++) coords.push(flat[i++]) }
    else if (op === 3) { /* close */ }
    else break
  }
  return { paint, ops: pops, coords }
}

export async function extractFromData(pdfjsLib, data, pageNo = 1) {
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise
  const page = await doc.getPage(pageNo)
  const vp = page.getViewport({ scale: 1 })
  const W = vp.width
  const H = vp.height
  const OPS = pdfjsLib.OPS
  const rev = {}
  for (const [k, v] of Object.entries(OPS)) rev[v] = k

  const ops = await page.getOperatorList()
  let lw = 0
  let ctm = [1, 0, 0, 1, 0, 0]
  const staffLines = []
  const vlines = []
  const beams = []
  const dots = []
  const timeGlyphX = []
  let curvePaths = 0
  for (let i = 0; i < ops.fnArray.length; i++) {
    const name = rev[ops.fnArray[i]] || String(ops.fnArray[i])
    const args = ops.argsArray[i]
    if (name === 'transform') ctm = args
    if (name === 'setLineWidth') lw = args[0]
    if (name === 'constructPath') {
      const decoded = decodePath(args)
      if (decoded) {
        const { paint, ops: pops, coords: c } = decoded
        const pt = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4],
                              ctm[1] * x + ctm[3] * y + ctm[5]]
        // A curved path larger than an augmentation dot is a slur or tie.
        // The core does not transcribe ties, so expose the evidence instead
        // of silently serializing re-attacked notes.
        if (pops.includes(2) && c.length >= 8) {
          const xs = [], ys = []
          for (let k = 0; k + 1 < c.length; k += 2) {
            const [px, py] = pt(c[k], c[k + 1]); xs.push(px); ys.push(py)
          }
          if (Math.max(...xs) - Math.min(...xs) > 6 ||
              Math.max(...ys) - Math.min(...ys) > 6) curvePaths += 1
        }
        const isLine = pops.length === 2 && pops[0] === 0 && pops[1] === 1
        if (isLine && c.length >= 4) {
          const [x0, y0] = pt(c[0], c[1])
          const [x1, y1] = pt(c[2], c[3])
          const w = Math.abs(x1 - x0)
          const h = Math.abs(y1 - y0)
          if (h < 1.5 && w > 0.4 * W && lw < 0.9) {
            staffLines.push(+(H - y0).toFixed(1))
          } else if (w < 1.5 && h > 0.02 * H) {
            vlines.push({ x: +x0.toFixed(1), y0: +(H - Math.max(y0, y1)).toFixed(1),
                          y1: +(H - Math.min(y0, y1)).toFixed(1), lw })
          } else if (w >= 4 && w <= 12 && h >= 3 && h <= 8) {
            beams.push({ x0: +Math.min(x0, x1).toFixed(1), x1: +Math.max(x0, x1).toFixed(1),
                         y: +((H - y0) + (H - y1)) / 2 })
          }
        } else if ((paint === 22 || paint === 23 ||
                    (Array.isArray(args[0]) && args[0][0] === 13 && args[0].includes(15))) &&
                   pops.includes(2) && c.length >= 8) {
          // filled curve (augmentation dot): point extents
          const xs = [], ys = []
          for (let k = 0; k + 1 < c.length; k += 2) {
            const [px, py] = pt(c[k], c[k + 1]); xs.push(px); ys.push(py)
          }
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2
          if (Math.max(...xs) - Math.min(...xs) <= 5) {
            dots.push({ x: +cx.toFixed(1), y: +(H - cy).toFixed(1) })
          }
        }
      }
    }
  }

  const tc = await page.getTextContent()
  const textMarks = []
  for (const it of tc.items) {
    if (!it.str || it.str.trim() === '') continue
    const tr = pdfjsLib.Util.transform(vp.transform, it.transform)
    textMarks.push({ s: it.str.trim(), x: +tr[4].toFixed(1), y: +tr[5].toFixed(1) })
  }
  const glyphs = []
  for (const it of tc.items) {
    if (!it.str) continue
    const code = it.str.codePointAt(0)
    if (!(code >= 0xe000 && code <= 0xf8ff)) continue
    const tr = pdfjsLib.Util.transform(vp.transform, it.transform)
    const x = tr[4]
    const y = tr[5] // PDF.js viewport transform already uses top-left
    const h = it.height || 0
    const w = h * 0.7
    glyphs.push({ code, x: +x.toFixed(1), y: +y.toFixed(1),
                  cy: +(y - 0.27 * h).toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) })
    if (TIME_DIGIT[code] != null) timeGlyphX.push({ x: +x.toFixed(1), y: +y.toFixed(1), d: TIME_DIGIT[code] })
  }

  const staffY = groupLines(staffLines, 1).map((g) => g[0])
  const staves = []
  for (let i = 0; i + 4 < staffY.length;) {
    const g = staffY.slice(i, i + 5)
    const gaps = g.slice(1).map((y, k) => y - g[k])
    if (Math.max(...gaps) - Math.min(...gaps) <= 2 && 3 <= gaps.reduce((a, b) => a + b, 0) / 4 <= 40) {
      staves.push(g); i += 5
    } else i += 1
  }
  if (!staves.length) return { route: 'image', error: 'no staff systems' }

  // pair staves into grand-staff systems by vertical proximity
  const systems = []
  for (const g of staves) {
    const top = g[0], bottom = g[g.length - 1], gap = (bottom - top) / 4
    const last = systems[systems.length - 1]
    if (last && top - last.bottom < 10 * last.gap) {
      last.staves.push(g); last.bottom = bottom
    } else {
      systems.push({ staves: [g], top, bottom, gap })
    }
  }

  const notes = []
  const rests = []
  const unresolved = []
  const clefs = {}
  let globalMeasure = 0
  const systemInfo = []
  for (let si = 0; si < systems.length; si++) {
    const sys = systems[si]
    const g0 = sys.staves[0]
    const gap = sys.gap
    const sh = g0[g0.length - 1] - g0[0]
    const barsRaw = [...new Set(vlines.filter((v) => v.lw >= 0.95 &&
      v.y0 <= g0[0] + 0.05 * sh && v.y1 >= g0[g0.length - 1] - 0.05 * sh)
      .map((v) => v.x))].sort((a, b) => a - b)
    const bars = []
    for (const b of barsRaw) if (!bars.length || b - bars[bars.length - 1] > gap) bars.push(b)
    const count = Math.max(1, bars.length - 1)
    systemInfo.push({ system: si, base: globalMeasure, count })
    const base = globalMeasure
    globalMeasure += count
    const measureOf = (x) => base + Math.max(0, bars.filter((b) => b < x).length - 1)
    // time signature: two stacked SMuFL time digits near the system start
    let beats = null, unit = null
    const startX = bars.length ? bars[0] : 0
    const times = timeGlyphX.filter((t) => t.x >= startX && t.x <= startX + 4 * gap &&
      t.y >= g0[0] - 4 * gap && t.y <= g0[g0.length - 1] + 4 * gap)
      .sort((a, b) => a.y - b.y)
    if (times.length >= 2) { beats = +times[0].d; unit = +times[1].d }

    for (let sti = 0; sti < sys.staves.length; sti++) {
      const g = sys.staves[sti]
      const stems = vlines.filter((v) => v.lw < 0.95 &&
        1.8 * gap <= (v.y1 - v.y0) && (v.y1 - v.y0) <= 6.5 * gap &&
        g[0] - gap <= (v.y0 + v.y1) / 2 && (v.y0 + v.y1) / 2 <= g[g.length - 1] + gap)
      const clefGlyphs = glyphs.filter((gl) => gl.h >= 2.0 * gap && gl.w >= 1.3 * gap &&
        g[0] - 4 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 4 * gap &&
        gl.x <= (bars.length ? bars[0] : gl.x) + 3 * gap)
      let clef = 'treble'
      if (clefGlyphs.length) {
        const cb = clefGlyphs.sort((a, b) => a.x - b.x)[0]
        clef = ((cb.cy + 0.5 * cb.h) - g[g.length - 1] > 0.6 * gap) ? 'treble' : 'bass'
      }
      clefs[sti] = clef
      // key signature: SMuFL accidental flats/sharps between clef and notes
      const clefGlyph = clefGlyphs.sort((a, b) => a.x - b.x)[0]
      const keyGlyphs = clefGlyph ? glyphs.filter((gl) =>
        (gl.code === 0xe260 || gl.code === 0xe262) &&
        gl.x > clefGlyph.x + clefGlyph.w && gl.x < clefGlyph.x + 12 * gap &&
        g[0] - 2 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 2 * gap) : []
      const sharps = keyGlyphs.filter((gl) => gl.code === 0xe262).length
      const flats = keyGlyphs.filter((gl) => gl.code === 0xe260).length
      let keyFifths = 0
      if (sharps && !flats && sharps <= 7) keyFifths = sharps
      else if (flats && !sharps && flats <= 7) keyFifths = -flats
      else if (sharps || flats) keyFifths = null
      const keyAlter = (letter, fifths) => {
        if (fifths == null) return 0
        const sharpOrder = [3, 0, 4, 1, 5, 2, 6] // F C G D A E B
        const flatOrder = [6, 2, 5, 1, 4, 0, 3]  // B E A D G C F
        if (fifths > 0) return sharpOrder.slice(0, fifths).includes(letter) ? 1 : 0
        if (fifths < 0) return flatOrder.slice(0, -fifths).includes(letter) ? -1 : 0
        return 0
      }
      const bottom = BOTTOM[clef]
      const bottomIdx = STEP_NAMES.indexOf(bottom[0]) + 7 * bottom[1]
      const heads = glyphs.filter((gl) => (gl.code >= 0xe0a0 && gl.code <= 0xe0ff) &&
        g[0] - 3.5 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 3.5 * gap)
      const accGlyphs = glyphs.filter((gl) => [0xe260, 0xe261, 0xe262].includes(gl.code) &&
        !keyGlyphs.includes(gl) &&
        g[0] - 2 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 2 * gap)
      for (const hd of heads) {
        const ag = accGlyphs.find((a) => a.x <= hd.x && a.x >= hd.x - 2 * gap &&
          Math.abs(a.cy - hd.cy) <= 0.6 * gap)
        if (ag) hd.acc = ag.code === 0xe262 ? 1 : ag.code === 0xe260 ? -1 : 0
      }
      const clusters = []
      for (const hd of heads) {
        const hcx = hd.x + hd.w / 2
        let c = clusters.find((c) => Math.abs(c.cx - hcx) <= 1.5)
        if (!c) { c = { cx: hcx, items: [] }; clusters.push(c) }
        c.items.push(hd)
        c.cx = c.items.reduce((a, b) => a + b.x + b.w / 2, 0) / c.items.length
      }
      for (const c of clusters) {
        let best = null
        for (const st of stems) {
          if (!c.items.every((hd) => st.y0 <= hd.cy + 0.9 * gap && st.y1 >= hd.cy - 0.9 * gap)) continue
          const d = Math.abs(st.x - c.cx)
          if (d <= 1.4 * gap && (!best || d < best.d)) best = { d, x: st.x }
        }
        for (const hd of c.items) {
          if (!best) {
            if (hd.code === 0xe0a2) {
              // whole note (no stem)
              const step = Math.round(2 * (g[g.length - 1] - hd.cy) / gap)
              const cidx = bottomIdx + step
              const letter = ((cidx % 7) + 7) % 7
              const acc = hd.acc != null ? hd.acc : keyAlter(letter, keyFifths)
              const midi = STEP_SEMI[STEP_NAMES[letter]] + 12 * (Math.floor(cidx / 7) + 1) + acc
              notes.push({ midi, x: hd.x, cx: +(hd.x + hd.w / 2).toFixed(1), y: hd.cy, staff: sti,
                measure: measureOf(hd.x), clef, kind: 'note', type: 'whole',
                dots: 0, dur_q: '4', stem_x: null, beam_count: null,
                accidental: acc || 0, key_fifths: keyFifths,
                confidence: 0.7, provenance: 'pdfjs-vector' })
            } else {
              unresolved.push({ kind: 'note', x: hd.x, y: hd.cy, staff: sti,
                reason: 'no-stem' })
            }
            continue
          }
          const bc = beamLevels(best.x, beams, g, gap)
          let dtype
          if (hd.code === 0xe0a2) dtype = 'whole'
          else if (hd.code === 0xe0a3) dtype = 'half'
          else dtype = TYPE_OF_BEAMS[Math.min(bc, 3)]
          const dotsN = dots.filter((d) => d.x >= hd.x + hd.w - 1 && d.x <= hd.x + hd.w + 2 * gap &&
            Math.abs(d.y - hd.cy) <= 0.6 * gap).length
          const step = Math.round(2 * (g[g.length - 1] - hd.cy) / gap)
          const cidx = bottomIdx + step
          const letter = ((cidx % 7) + 7) % 7
          const acc = hd.acc != null ? hd.acc : keyAlter(letter, keyFifths)
          const midi = STEP_SEMI[STEP_NAMES[letter]] + 12 * (Math.floor(cidx / 7) + 1) + acc
          notes.push({ midi, x: hd.x, cx: +(hd.x + hd.w / 2).toFixed(1), y: hd.cy, staff: sti,
            measure: measureOf(hd.x), clef, kind: 'note', type: dtype,
            dots: dotsN, dur_q: String(TYPE_Q[dtype] * (dotsN ? 1.5 : 1)),
            stem_x: best.x, beam_count: bc, accidental: acc || 0,
            key_fifths: keyFifths, confidence: 0.9,
            provenance: 'pdfjs-vector' })
        }
      }
    }
    // rests (SMuFL 0xE4E0-0xE4FF) for every staff in this system
    for (let sti = 0; sti < sys.staves.length; sti++) {
      const g = sys.staves[sti]
      for (const gl of glyphs) {
        if (!(gl.code >= 0xe4e0 && gl.code <= 0xe4ff)) continue
        if (!(g[0] - 3.5 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 3.5 * gap)) continue
        const rtype = REST_TYPE[gl.code]
        const dotsN = dots.filter((d) => d.x >= gl.x + gl.w - 1 && d.x <= gl.x + gl.w + 2 * gap &&
          Math.abs(d.y - gl.cy) <= 0.6 * gap).length
        if (!rtype) {
          rests.push({ x: gl.x, y: gl.cy, staff: sti, measure: measureOf(gl.x),
            kind: 'rest', type: null, dots: null, dur_q: null, confidence: 0.4,
            unresolved: 'rest-glyph', provenance: 'pdfjs-vector' })
        } else {
          rests.push({ x: gl.x, y: gl.cy, staff: sti, measure: measureOf(gl.x),
            kind: 'rest', type: rtype, dots: dotsN,
            dur_q: String(TYPE_Q[rtype] * (dotsN ? 1.5 : 1)), confidence: 0.8,
            provenance: 'pdfjs-vector' })
        }
      }
    }
    // tuplet marks: a '3' above the staff marks the chord at that x as 3:2
    const marks = textMarks.filter((t) => t.s === '3' && t.y < g0[0] - 1.0 * gap)
    for (const n of notes) {
      if (n.measure < base || n.measure >= base + count) continue
      if (marks.some((t) => Math.abs(t.x - (n.cx || n.x)) <= 0.4 * gap)) {
        n.tuplet = [3, 2]
        n.dur_q = String(parseFloat(n.dur_q) * 2 / 3)
      }
    }
    sys.beats = beats; sys.unit = unit
  }

  // chords by x coincidence
  const byX = new Map()
  for (const n of notes) {
    const key = `${n.measure}:${n.staff}:${Math.round((n.cx || n.x) / 2)}`
    if (!byX.has(key)) byX.set(key, [])
    byX.get(key).push(n)
  }
  for (const grp of byX.values()) {
    if (grp.length > 1) {
      grp.sort((a, b) => a.midi - b.midi)
      grp.forEach((n, j) => { n.chord_id = `c:${grp[0].measure}:${grp[0].staff}:${Math.round(grp[0].x)}`; n.chord_root = j === 0; n.chord_size = grp.length })
    }
  }
  for (const n of notes) { if (!n.chord_id) { n.chord_id = null; n.chord_root = true; n.chord_size = 1 } }

  const keyVals = notes.map((n) => n.key_fifths)
  const key = keyVals.length && keyVals.every((v) => v === keyVals[0]) ? keyVals[0] : null
  return { page: pageNo, size: [W, H], staves: staves.length,
    clefs, notes, rests, unresolved, key,
    curveCount: curvePaths,
    unresolvedNotes: unresolved.length,
    unresolvedRests: rests.filter((rest) => !rest.type || !rest.dur_q).length,
    key_source: key === 0 ? 'no-key-glyph' : key == null ? 'unresolved' : 'glyph-sequence',
    systems: systemInfo.map((s, i) => ({ ...s, beats: systems[i].beats, unit: systems[i].unit })),
    meter: systems.every((s) => s.beats && s.unit) ? { beats: systems[0].beats, unit: systems[0].unit } : null,
    route: notes.length ? 'vector' : 'image',
    schema: 'corranzo-notation-ir/1',
    credits: ['Key signature: no key glyphs -> C major inferred from absence; verify.',
      'Time signature decoded from SMuFL digits when present; otherwise unresolved.',
      'Rest durations from SMuFL rest glyphs; unknown glyphs omitted.',
      'Articulations/dynamics are not yet transcribed.'] }
}

function beamLevels(stemX, beams, g, gap) {
  const local = beams.filter((b) => b.y >= g[0] - 4 * gap && b.y <= g[g.length - 1] + 4 * gap)
  const left = local.filter((b) => Math.abs(b.x1 - stemX) <= 1.5)
  const right = local.filter((b) => Math.abs(b.x0 - stemX) <= 1.5)
  return Math.max(left.length, right.length)
}

function diatonic(midi) {
  const names = [0, 2, 4, 5, 7, 9, 11]
  const pc = midi % 12
  if (names.includes(pc)) return names.indexOf(pc) + 7 * (Math.floor(midi / 12) - 1)
  for (let k = 1; k < 3; k++) if (names.includes((midi - k + 12) % 12)) return names.indexOf((midi - k + 12) % 12) + 7 * (Math.floor((midi - k) / 12) - 1)
  return 0
}

export function toMusicXML(ir, divisions = 480) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="4.0">',
    '<miscellaneous><miscellaneous-field name="corranzo_notation_ir">corranzo-notation-ir/1</miscellaneous-field></miscellaneous>']
  for (const c of ir.credits) out.push(`<credit><credit-words>${esc(c)}</credit-words></credit>`)
  out.push('<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">')
  const byMeasure = new Map()
  for (const e of [...ir.notes, ...ir.rests]) {
    if (!byMeasure.has(e.measure)) byMeasure.set(e.measure, [])
    byMeasure.get(e.measure).push(e)
  }
  const staves = [...new Set([...ir.notes, ...ir.rests].map((e) => e.staff))].sort()
  for (const mi of [...byMeasure.keys()].sort((a, b) => a - b)) {
    out.push(`<measure number="${mi + 1}">`)
    out.push(`<attributes><divisions>${divisions}</divisions>`)
    if (ir.key != null) out.push(`<key><fifths>${ir.key}</fifths></key>`)
    if (ir.meter) out.push(`<time><beats>${ir.meter.beats}</beats><beat-type>${ir.meter.unit}</beat-type></time>`)
    for (const st of staves) {
      const clef = ir.clefs[st] || 'treble'
      out.push(`<clef number="${st + 1}"><sign>${clef === 'treble' ? 'G' : 'F'}</sign><line>${clef === 'treble' ? 2 : 4}</line></clef>`)
    }
    out.push('</attributes>')
    let firstStaff = true
    for (const st of staves) {
      const evs = (byMeasure.get(mi) || []).filter((e) => e.staff === st)
      if (!evs.length) continue
      if (!firstStaff) {
        const sum = evs.filter((e) => e.chord_root !== false).reduce((a, e) => a + (e.dur_q ? parseFloat(e.dur_q) : 0), 0)
        out.push(`<backup><duration>${Math.max(1, Math.round(sum * divisions))}</duration></backup>`)
      }
      firstStaff = false
      evs.sort((a, b) => a.x - b.x || (a.midi || 0) - (b.midi || 0))
      for (const e of evs) {
        if (e.kind === 'rest' && (!e.type || !e.dur_q)) continue
        out.push('<note>')
        if (e.kind === 'rest') out.push('<rest/>')
        else {
          if (e.chord_root === false) out.push('<chord/>')
          out.push(`<pitch><step>${STEP_NAMES[diatonic(e.midi) % 7]}</step>${e.accidental ? `<alter>${e.accidental}</alter>` : ''}<octave>${Math.floor(diatonic(e.midi) / 7)}</octave></pitch>`)
        }
        out.push(`<duration>${Math.round(parseFloat(e.dur_q) * divisions)}</duration><type>${e.type}</type>`)
        for (let d = 0; d < (e.dots || 0); d++) out.push('<dot/>')
        if (e.tuplet) out.push(`<time-modification><actual-notes>${e.tuplet[0]}</actual-notes><normal-notes>${e.tuplet[1]}</normal-notes></time-modification>`)
        out.push(`<voice>${st + 1}</voice><staff>${st + 1}</staff></note>`)
      }
    }
    out.push('</measure>')
  }
  out.push('</part></score-partwise>')
  return out.join('\n')
}


/** Recognize one page of a vector piano PDF. No reference metadata is read. */
export async function recognizePianoVectorPdf(data, { pageNo = 1, pdfjsLib }) {
  if (!pdfjsLib) throw new Error('recognizePianoVectorPdf requires a pdfjsLib')
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  return extractFromData(pdfjsLib, bytes, pageNo)
}

function measureBeatCount(meter) {
  if (!meter || !(meter.beats > 0) || !(meter.unit > 0)) return null
  return (meter.beats * 4) / meter.unit
}

/**
 * Decide whether the vector result is trustworthy enough to become a
 * playable practice score. The extractor is deliberately conservative:
 * unknown key/time, unresolved glyphs, slurs/ties and invalid measure fill
 * all block practice. The score can still be reviewed/engraved as a draft.
 */
export function assessPianoVectorIr(ir) {
  const issues = []
  if (!ir || ir.route !== 'vector' || !(ir.notes?.length > 0)) {
    issues.push('no-vector-notes')
  }
  if (!ir?.meter) issues.push('time-signature-unknown')
  if (ir?.key == null) issues.push('key-signature-unknown')
  if (ir?.unresolvedNotes > 0) issues.push('unresolved-noteheads')
  if (ir?.unresolvedRests > 0) issues.push('unresolved-rests')
  if (ir?.curveCount > 0) issues.push('ties-or-slurs-not-transcribed')

  const beats = measureBeatCount(ir?.meter)
  const badMeasures = []
  if (beats != null && ir?.notes?.length) {
    const byMeasure = new Map()
    for (const event of [...(ir.notes ?? []), ...(ir.rests ?? [])]) {
      if (event.kind === 'rest' && (!event.type || !event.dur_q)) continue
      if (event.chord_root === false) continue
      const key = `${event.measure}:${event.staff}`
      byMeasure.set(key, (byMeasure.get(key) ?? 0) + Number(event.dur_q ?? 0))
    }
    for (const [key, quarters] of byMeasure) {
      if (Math.abs(quarters - beats) > 0.02) badMeasures.push(key)
    }
    if (badMeasures.length) issues.push('measure-duration-invalid')
  } else if (ir?.notes?.length) {
    issues.push('measure-duration-unverifiable')
  }

  const practiceReady = issues.length === 0
  return {
    engine: 'piano-vector',
    route: ir?.route ?? 'unsupported',
    noteCount: ir?.notes?.length ?? 0,
    restCount: ir?.rests?.length ?? 0,
    measureCount: new Set((ir?.notes ?? []).map((note) => note.measure)).size,
    key: ir?.key ?? null,
    meter: ir?.meter ?? null,
    curveCount: ir?.curveCount ?? 0,
    unresolvedNotes: ir?.unresolvedNotes ?? 0,
    unresolvedRests: ir?.unresolvedRests ?? 0,
    badMeasures,
    issues,
    practiceReady,
    completeFidelity: practiceReady,
    voiceOwnership: 'staff-only',
    warnings: issues.map((issue) => {
      switch (issue) {
        case 'no-vector-notes': return 'No readable vector piano notes were found.'
        case 'time-signature-unknown': return 'The time signature could not be verified.'
        case 'key-signature-unknown': return 'The key signature is ambiguous; accidentals may be wrong.'
        case 'unresolved-noteheads': return 'Some noteheads had no trustworthy stem/voice evidence.'
        case 'unresolved-rests': return 'Some rests could not be resolved.'
        case 'ties-or-slurs-not-transcribed': return 'Ties/slurs are not transcribed; repeated attacks may be wrong.'
        case 'measure-duration-invalid': return 'One or more measures do not fill the stated meter.'
        case 'measure-duration-unverifiable': return 'Measure timing could not be validated.'
        default: return issue
      }
    }),
  }
}
