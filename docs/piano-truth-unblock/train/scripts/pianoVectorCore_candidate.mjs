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
  const ctmStack = []
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
  const staffLines = []
  const vlines = []
  const beams = []
  const dots = []
  const accPaths = []
  let unresolvedAccidentals = 0
  const curves = []
  const timeGlyphX = []
  let curvePaths = 0
  for (let i = 0; i < ops.fnArray.length; i++) {
    const name = rev[ops.fnArray[i]] || String(ops.fnArray[i])
    const args = ops.argsArray[i]
    if (name === 'save') ctmStack.push([...ctm])
    if (name === 'restore') ctm = ctmStack.pop() ?? [1, 0, 0, 1, 0, 0]
    if (name === 'transform') ctm = mul(ctm, args)
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
          let ci = 0, start = null, last = null
          for (const op of pops) {
            if (op === 0) {
              const p = pt(c[ci], c[ci + 1]); ci += 2
              if (!start) start = p
              last = p; xs.push(p[0]); ys.push(p[1])
            } else if (op === 1) {
              const p = pt(c[ci], c[ci + 1]); ci += 2
              last = p; xs.push(p[0]); ys.push(p[1])
            } else if (op === 2) {
              for (let k = 0; k < 3; k++) {
                const p = pt(c[ci], c[ci + 1]); ci += 2
                last = p; xs.push(p[0]); ys.push(p[1])
              }
            }
          }
          const w = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
          const h = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
          if (start && last && (w > 6 || h > 6)) {
            curvePaths += 1
            curves.push({ x0: +(start[0]).toFixed(1), y0: +(H - start[1]).toFixed(1),
              x1: +(last[0]).toFixed(1), y1: +(H - last[1]).toFixed(1),
              w: +w.toFixed(1), h: +h.toFixed(1) })
          }
        }
        const isLine = pops.length === 2 && pops[0] === 0 && pops[1] === 1
        if (isLine && c.length >= 4) {
          const [x0, y0] = pt(c[0], c[1])
          const [x1, y1] = pt(c[2], c[3])
          const w = Math.abs(x1 - x0)
          const h = Math.abs(y1 - y0)
          if (h < 1.5 && w > 0.4 * W) {
            staffLines.push(+(H - y0).toFixed(1))
          } else if (w < 1.5 && h > 0.02 * H) {
            vlines.push({ x: +x0.toFixed(1), y0: +(H - Math.max(y0, y1)).toFixed(1),
                          y1: +(H - Math.min(y0, y1)).toFixed(1), lw })
          } else if (w >= 4 && w <= 12 && h >= 3 && h <= 8) {
            beams.push({ x0: +Math.min(x0, x1).toFixed(1), x1: +Math.max(x0, x1).toFixed(1),
                         y: +((H - y0) + (H - y1)) / 2 })
          }
        } else if (paint === 22 || paint === 23) {
          // Path-drawn accidental (outlined font): sharp/natural/flat.
          const xs = [], ys = []
          let ci = 0, prev = null
          const segs = []
          for (const op of pops) {
            if (op === 0) { prev = [c[ci], c[ci + 1]]; ci += 2 }
            else if (op === 1) {
              const p = [c[ci], c[ci + 1]]; ci += 2
              if (prev) segs.push([prev, p])
              prev = p
            } else if (op === 2) {
              for (let k = 0; k < 3; k++) {
                const [px, py] = pt(c[ci], c[ci + 1]); xs.push(px); ys.push(py); ci += 2
              }
              prev = [c[ci - 2], c[ci - 1]]
            }
          }
          for (const [a, b] of segs) {
            const p0 = pt(a[0], a[1]); const p1 = pt(b[0], b[1])
            xs.push(p0[0], p1[0]); ys.push(p0[1], p1[1])
          }
          if (xs.length && ys.length) {
            const w = Math.max(...xs) - Math.min(...xs)
            const h = Math.max(...ys) - Math.min(...ys)
            if (w <= 5 && h <= 5 && pops.includes(2)) {
              dots.push({ x: +((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(1),
                          y: +(H - (Math.min(...ys) + Math.max(...ys)) / 2).toFixed(1) })
            } else if (w >= 5 && w <= 14 && h >= 7 && h <= 18) {
              let vertical = 0, slanted = 0, horizontal = 0, curves = 0
              for (const [a, b] of segs) {
                const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1])
                if (dx <= 0.25 * w) vertical += 1
                else if (dy <= 0.02 * h) horizontal += 1
                else slanted += 1
              }
              if (pops.includes(2)) curves += 1
              const code = curves ? -1 : (slanted > 0 ? 1 : (horizontal > 0 ? 0 : null))
              if (code == null) {
                unresolvedAccidentals += 1
              } else {
                accPaths.push({ code, x: (Math.min(...xs) + Math.max(...xs)) / 2,
                  y: H - (Math.min(...ys) + Math.max(...ys)) / 2, w, h })
              }
            }
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
    const w = (it.width && it.width > 0) ? it.width : h * 0.7
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
    const _headXs = glyphs.filter((gl) => [0xe0a2, 0xe0a3, 0xe0a4].includes(gl.code))
      .map((gl) => gl.x + gl.w / 2)
    const barsRaw = [...new Set(vlines.filter((v) => v.lw >= 0.95 &&
      v.y0 <= g0[0] + 0.05 * sh && v.y1 >= g0[g0.length - 1] - 0.05 * sh &&
      !_headXs.some((hx) => Math.abs(hx - v.x) <= 1.5 * gap))
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
      const stems = vlines.filter((v) =>
        1.8 * gap <= (v.y1 - v.y0) && (v.y1 - v.y0) <= 6.5 * gap &&
        g[0] - gap <= (v.y0 + v.y1) / 2 && (v.y0 + v.y1) / 2 <= g[g.length - 1] + gap &&
        _headXs.some((hx) => Math.abs(hx - v.x) <= 1.5 * gap))
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
      let keySource = 'none'
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
      // Key-signature region: path-drawn accidentals between the clef and
      // the time signature belong to the key, not to a single notehead.
      const clefGlyphForKey = clefGlyph || null
      const timeForStaff = timeGlyphX.filter((t) =>
        g[0] - 2 * gap <= t.y && t.y <= g[g.length - 1] + 2 * gap &&
        (!clefGlyphForKey || t.x > clefGlyphForKey.x))
        .sort((a, b) => a.x - b.x)[0]
      const keyEnd = timeForStaff ? timeForStaff.x - gap :
        (clefGlyphForKey ? clefGlyphForKey.x + 5 * gap : 0)
      if (clefGlyphForKey) {
        const keyPathGlyphs = accPaths.filter((pa) => !pa.used &&
          pa.x + pa.w / 2 > clefGlyphForKey.x &&
          pa.x < keyEnd + gap &&
          g[0] - 2 * gap <= pa.y && pa.y <= g[g.length - 1] + 2 * gap)
        if (keyPathGlyphs.length) {
          const sharps = keyPathGlyphs.filter((pa) => pa.code === 1).length
          const flats = keyPathGlyphs.filter((pa) => pa.code === -1).length
          if (sharps && !flats && sharps <= 7) { keyFifths = sharps; keySource = 'path-key-sequence' }
          else if (flats && !sharps && flats <= 7) { keyFifths = -flats; keySource = 'path-key-sequence' }
          else { keyFifths = null; keySource = 'path-key-ambiguous' }
          for (const pa of keyPathGlyphs) pa.used = true
        }
      }
      const heads = glyphs.filter((gl) => {
        const smuflHead = [0xe0a2, 0xe0a3, 0xe0a4].includes(gl.code)
        const isSmufl = gl.code >= 0xe000 && gl.code <= 0xf8ff
        const sized = !isSmufl && gl.h >= 1.6 * gap && gl.h <= 2.2 * gap &&
          gl.w >= 1.0 * gap && gl.w <= 1.6 * gap
        return (smuflHead || sized) &&
          g[0] - 3.5 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 3.5 * gap
      })
      const accGlyphs = glyphs.filter((gl) => [0xe260, 0xe261, 0xe262].includes(gl.code) &&
        !keyGlyphs.includes(gl) &&
        g[0] - 2 * gap <= gl.cy && gl.cy <= g[g.length - 1] + 2 * gap)
      // Text-drawn accidentals are exclusive too: the nearest unassigned
      // notehead to the right owns each glyph.
      for (const ag of accGlyphs) {
        let best = null
        for (const hd of heads) {
          if (hd.acc != null) continue
          if (!(ag.x <= hd.x && hd.x - ag.x <= 2 * gap)) continue
          if (Math.abs(ag.cy - hd.cy) > 0.6 * gap) continue
          const d = (hd.x - ag.x) + Math.abs(ag.cy - hd.cy)
          if (!best || d < best.d) best = { d, hd }
        }
        if (best) best.hd.acc = ag.code === 0xe262 ? 1 : ag.code === 0xe260 ? -1 : 0
      }
      // Path-drawn accidentals are assigned exclusively: each candidate path
      // belongs to the nearest unassigned notehead to its right. A single
      // accidental can never modify two unrelated notes.
      for (const pa of accPaths) {
        if (pa.used) continue
        let best = null
        for (const hd of heads) {
          if (hd.acc != null) continue
          if (!(pa.x <= hd.x && hd.x - pa.x <= 2.5 * gap)) continue
          if (Math.abs(pa.y - hd.cy) > 0.8 * gap) continue
          const d = (hd.x - pa.x) + Math.abs(pa.y - hd.cy)
          if (!best || d < best.d) best = { d, hd }
        }
        if (best) { best.hd.acc = pa.code; pa.used = true }
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
          // Stem ownership by notehead edge: up-stems attach at the right
          // edge (~1.25 gaps), down-stems at the left edge (~0.25 gap).
          // Fall back to the cluster centre for chords/dense layouts where
          // the edge estimate is unreliable.
          const head = c.items[0]
          const up = st.y0 < head.cy
          const expected = up ? head.x + 1.25 * gap : head.x - 0.25 * gap
          let d = Math.abs(st.x - expected)
          let edge = d <= 0.9 * gap
          if (!edge) d = Math.abs(st.x - c.cx)
          if (d <= 1.4 * gap && (!best || d < best.d)) best = { d, x: st.x, edge }
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
                dots: 0, dur_q: '4', stem_x: null, stemOwnership: 'stemless', beam_count: null,
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
            stem_x: best.x, stemOwnership: best.edge ? 'edge' : 'position-fallback', beam_count: bc, accidental: acc || 0,
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
    // tuplet marks: a '3' above THIS system marks the nearest chord cluster
    // as 3:2. Markers from other systems are excluded by the y band; all
    // chord members at the chosen x receive the tuplet.
    const marks = textMarks.filter((t) => t.s === '3' &&
      t.y < g0[0] - 0.5 * gap && t.y > g0[0] - 8.0 * gap)
    const sysNotes = notes.filter((n) => n.measure >= base && n.measure < base + count)
    assignTupletGroups(sysNotes, marks, gap)
    sys.beats = beats; sys.unit = unit
  }

  // chords by x coincidence
  const byX = new Map()
  for (const n of notes) {
    const key = `${n.measure}:${n.staff}:${Math.round(n.x / 2)}`
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
  const ir = { page: pageNo, size: [W, H], staves: staves.length,
    clefs, notes, rests, unresolved, key,
    curveCount: curvePaths,
    unresolvedNotes: unresolved.length,
    unresolvedRests: rests.filter((rest) => !rest.type || !rest.dur_q).length,
    unresolvedAccidentals,
    key_source: key === 0 ? 'no-key-glyph' : key == null ? 'unresolved' : 'glyph-sequence',
    systems: systemInfo.map((s, i) => ({ ...s, beats: systems[i].beats, unit: systems[i].unit })),
    gap: systems[0]?.gap ?? 8,
    curves: curves,
    meter: systems.every((s) => s.beats && s.unit) ? { beats: systems[0].beats, unit: systems[0].unit } : null,
    route: notes.length ? 'vector' : 'image',
    schema: 'corranzo-notation-ir/1',
    credits: ['Key signature: no key glyphs -> C major inferred from absence; verify.',
      'Time signature decoded from SMuFL digits when present; otherwise unresolved.',
      'Rest durations from SMuFL rest glyphs; unknown glyphs omitted.',
      'Articulations/dynamics are not yet transcribed.'] }
  assignVoices(ir)
  reconcileMeasureRests(ir)
  classifyCurves(ir)
  return ir
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


/**
 * Minimum general multi-page extraction: each page is recognized with the
 * same single-page core, events keep their page identity, measures are
 * offset in reading order, and incomplete pages/cross-page continuations are
 * explicit. This is not a claim that cross-page ties are solved.
 */
export async function extractPianoVectorPages(pdfjsLib, data, { maxPages = 32 } = {}) {
  const source = data instanceof Uint8Array ? data : new Uint8Array(data)
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(source), useSystemFonts: true }).promise
  const pageCount = Math.min(doc.numPages, maxPages)
  await doc.destroy()
  const pages = []
  const notes = [], rests = [], unresolved = []
  const clefs = {}
  let offset = 0
  for (let p = 1; p <= pageCount; p++) {
    const ir = await extractFromData(pdfjsLib, new Uint8Array(source), p)
    const complete = !!ir?.notes?.length
    pages.push({ page: p, route: ir?.route ?? 'image', notes: ir?.notes?.length ?? 0,
      rests: ir?.rests?.length ?? 0, meter: ir?.meter ?? null, complete })
    if (!complete) continue
    for (const e of [...ir.notes, ...ir.rests]) { e.measure += offset; e.page = p }
    notes.push(...ir.notes); rests.push(...(ir.rests ?? []))
    Object.assign(clefs, ir.clefs ?? {})
    unresolved.push(...(ir.unresolved ?? []))
    const maxMeasure = Math.max(-1, ...ir.notes.map((n) => n.measure))
    offset = maxMeasure + 1
  }
  const incompletePages = pages.filter((p) => !p.complete).length
  return { route: notes.length ? 'vector' : 'image', schema: 'corranzo-notation-ir/1',
    pageCount, pages, multiPage: pageCount > 1, notes, rests, unresolved,
    meter: pages[0]?.meter ?? null, key: null, systems: [], clefs,
    incompletePages,
    crossPageContinuation: pageCount > 1 ? 'unresolved' : 'not-applicable',
    credits: ['Multi-page extraction preserves page identity and measure order.',
      'Cross-page ties/slurs are not yet continued; practice is blocked when pages are incomplete.'] }
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
        if (e.tie_start) out.push('<tie type="start"/>')
        if (e.tie_end) out.push('<tie type="stop"/>')
        if (e.tuplet) out.push(`<time-modification><actual-notes>${e.tuplet[0]}</actual-notes><normal-notes>${e.tuplet[1]}</normal-notes></time-modification>`)
        const nots = []
        if (e.tie_start) nots.push('<tied type="start"/>')
        if (e.tie_end) nots.push('<tied type="stop"/>')
        if (e.slur_start) nots.push('<slur type="start" number="1"/>')
        if (e.slur_end) nots.push('<slur type="stop" number="1"/>')
        if (nots.length) out.push(`<notations>${nots.join('')}</notations>`)
        out.push(`<voice>${e.voice ?? (st + 1)}</voice><staff>${st + 1}</staff></note>`)
      }
    }
    out.push('</measure>')
  }
  out.push('</part></score-partwise>')
  return out.join('\n')
}




/**
 * Classify curved paths as ties or slurs using endpoint-to-notehead
 * proximity and pitch continuity. Ties require equal MIDI pitch and a
 * non-decreasing measure; slurs require two different pitches. Curves whose
 * endpoints cannot be paired are left ambiguous and keep the practice gate
 * closed. No curve is merged into a duration without equal-pitch evidence.
 */
export function classifyCurves(ir) {
  const gap = ir.gap || 8
  const candidates = (x, y) => ir.notes.filter((n) =>
    Math.abs(n.x - x) <= 2.0 * gap && Math.abs(n.y - y) <= 2.5 * gap)
  let ties = 0, slurs = 0, ambiguous = 0
  for (const c of ir.curves ?? []) {
    const ca = candidates(c.x0, c.y0)
    const cb = candidates(c.x1, c.y1)
    if (!ca.length || !cb.length) {
      c.kind = 'ambiguous'; ambiguous += 1; continue
    }
    // Prefer an equal-pitch, forward-measure pair (tie). Otherwise the
    // closest pair is a slur; unrelated endpoints stay ambiguous.
    let tiePair = null
    for (const a of ca) for (const b of cb) {
      if (a === b || a.midi !== b.midi || a.measure > b.measure) continue
      if (a.staff !== b.staff) continue
      if (a.voice != null && b.voice != null && a.voice !== b.voice) continue
      // Ties attach close to both noteheads (not a high decorative arc).
      if (Math.abs(a.y - c.y0) > 1.4 * gap || Math.abs(b.y - c.y1) > 1.4 * gap) continue
      // The two notes must be consecutive in the same staff/voice x order;
      // an equal-pitch curve over an intervening note is a slur/ambiguous.
      const lo = Math.min(a.measure, b.measure)
      const hi = Math.max(a.measure, b.measure)
      const between = ir.notes.some((n) => n.staff === a.staff && n !== a && n !== b && (
        (a.measure === b.measure && n.measure === a.measure &&
         n.x > Math.min(a.x, b.x) && n.x < Math.max(a.x, b.x)) ||
        (a.measure !== b.measure &&
         ((n.measure === a.measure && n.x > a.x) ||
          (n.measure === b.measure && n.x < b.x) ||
          (n.measure > lo && n.measure < hi)))
      ))
      if (between) continue
      const d = Math.abs(a.x - c.x0) + Math.abs(b.x - c.x1) +
        0.25 * (Math.abs(a.y - c.y0) + Math.abs(b.y - c.y1))
      if (!tiePair || d < tiePair.d) tiePair = { d, a, b }
    }
    const hasSamePitchPair = ca.some((a) => cb.some((b) =>
      a !== b && a.midi === b.midi && a.measure <= b.measure))
    if (!tiePair && hasSamePitchPair) {
      // Equal pitch but attachment/continuity is not tie-grade: abstain
      // rather than promoting a possible slur/decoration to a tie.
      c.kind = 'ambiguous'; ambiguous += 1; continue
    }
    if (tiePair && (c.h > 2.5 * gap || Math.abs(tiePair.b.x - tiePair.a.x) > 10 * gap ||
        c.h < Math.max(3, 0.12 * Math.max(1, (c.w ?? Math.abs(c.x1 - c.x0)))))) {
      c.kind = 'ambiguous'; ambiguous += 1; continue
    }
    if (tiePair) {
      c.kind = 'tie'; ties += 1
      tiePair.a.tie_start = true; tiePair.b.tie_end = true
      tiePair.a.tie_to = tiePair.b.x; tiePair.b.tie_from = tiePair.a.x
      continue
    }
    if (c.h < Math.max(3, 0.12 * Math.max(1, (c.w ?? Math.abs(c.x1 - c.x0))))) {
      c.kind = 'ambiguous'; ambiguous += 1; continue
    }
    let best = null
    for (const a of ca) for (const b of cb) {
      if (a === b) continue
      const d = Math.abs(a.x - c.x0) + Math.abs(b.x - c.x1) +
        0.25 * (Math.abs(a.y - c.y0) + Math.abs(b.y - c.y1))
      if (!best || d < best.d) best = { d, a, b }
    }
    if (best) {
      c.kind = 'slur'; slurs += 1
      best.a.slur_start = true; best.b.slur_end = true
    } else {
      c.kind = 'ambiguous'; ambiguous += 1
    }
  }
  ir.tieCount = ties
  ir.slurCount = slurs
  ir.ambiguousCurves = ambiguous
}


/**
 * Assign voice IDs from stem direction. A staff with at least two up-stem
 * and two down-stem notes is treated as two independent voices; each voice
 * is validated separately later. This prevents two two-beat voices from
 * summing to a valid four-beat measure.
 */

/**
 * Group-aware tuplet ownership. A printed "3" may only own the nearest
 * three chord/note clusters, the selected clusters must be compact, and a
 * cluster can belong to at most one marker. This prevents a single numeral
 * from turning six unrelated notes (or two groups) into a tuplet.
 */
export function assignTupletGroups(sysNotes, marks, gap) {
  const clusters = []
  for (const n of sysNotes) {
    let c = clusters.find((c) => Math.abs(c.cx - n.x) <= 1.5)
    if (!c) { c = { cx: n.x, notes: [] }; clusters.push(c) }
    c.notes.push(n)
    c.cx = c.notes.reduce((a, m) => a + m.x, 0) / c.notes.length
  }
  const used = new Set()
  let groups = 0
  for (const t of marks) {
    const candidates = clusters.filter((c) => !used.has(c) && Math.abs(c.cx - t.x) <= 3.0 * gap)
      .sort((a, b) => Math.abs(a.cx - t.x) - Math.abs(b.cx - t.x))
      .slice(0, 3)
    if (candidates.length < 1) continue
    const xs = candidates.map((c) => c.cx)
    if (Math.max(...xs) - Math.min(...xs) > 5.0 * gap) continue
    for (const c of candidates) {
      used.add(c)
      for (const n of c.notes) {
        n.tuplet = [3, 2]
        n.dur_q = String(parseFloat(n.dur_q) * 2 / 3)
      }
    }
    groups += 1
  }
  return groups
}

export function assignVoices(ir) {
  const byStaffMeasure = new Map()
  for (const n of ir.notes) {
    const key = `${n.measure}:${n.staff}`
    if (!byStaffMeasure.has(key)) byStaffMeasure.set(key, [])
    byStaffMeasure.get(key).push(n)
  }
  let splits = 0, conflicts = 0, unresolvedStems = 0, edgeStems = 0
  for (const [key, notes] of byStaffMeasure) {
    const staff = notes[0]?.staff ?? 0
    const ups = notes.filter((n) => n.stem_x != null && n.stem_x > n.x + 1)
    const downs = notes.filter((n) => n.stem_x != null && n.stem_x < n.x - 1)
    const split = ups.length >= 2 && downs.length >= 2
    if (split) {
      splits += 1
      for (const n of ups) { n.voice = String(staff * 4 + 1); n.voiceEvidence = 'stem-direction' }
      for (const n of downs) { n.voice = String(staff * 4 + 2); n.voiceEvidence = 'stem-direction' }
    } else {
      for (const n of notes) { n.voice = String(staff * 4 + 1); n.voiceEvidence = 'staff-default' }
    }
    for (const n of notes) {
      if (n.stemOwnership === 'edge') edgeStems += 1
      if (n.stemOwnership === 'position-fallback') unresolvedStems += 1
    }
    // Conflict 1: one stem claimed by noteheads in different x clusters.
    const byStem = new Map()
    for (const n of notes) {
      if (n.stem_x == null) continue
      if (!byStem.has(n.stem_x)) byStem.set(n.stem_x, [])
      byStem.get(n.stem_x).push(n)
    }
    for (const group of byStem.values()) {
      if (group.length < 2) continue
      const xs = group.map((n) => n.x)
      if (Math.max(...xs) - Math.min(...xs) > 1.5) conflicts += 1
    }
    // Conflict 2: several distinct stems on the same onset are not a chord
    // unless they share one stem x. This catches same-direction second voices
    // that would otherwise be silently merged into one voice.
    const onsetGroups = new Map()
    for (const n of notes) {
      if (n.stem_x == null) continue
      const key = Math.round(n.x / 1.5)
      if (!onsetGroups.has(key)) onsetGroups.set(key, [])
      onsetGroups.get(key).push(n)
    }
    for (const group of onsetGroups.values()) {
      const stems = new Set(group.map((n) => n.stem_x))
      if (stems.size > 1) conflicts += 1
    }
  }
  for (const r of ir.rests) {
    const staff = r.staff ?? 0
    r.voice = String(staff * 4 + 1)
    r.voiceEvidence = 'staff-default'
  }
  const singleVoice = splits === 0
  const verified = singleVoice && conflicts === 0 && unresolvedStems === 0 &&
    ir.notes.length > 0 && edgeStems === ir.notes.length
  ir.voiceSplit = (ir.voiceSplit ?? 0) + splits
  ir.voiceGraph = {
    notes: ir.notes.length,
    staves: new Set(ir.notes.map((n) => n.staff)).size,
    voices: new Set(ir.notes.map((n) => n.voice)).size,
    splits,
    conflicts,
    edgeStems,
    unresolvedStems,
    verified,
  }
  ir.voiceOwnership = verified ? 'verified' : 'inferred'
  return ir
}

const REST_UPGRADE = {
  eighth: ['quarter', 'half', 'whole'],
  quarter: ['half', 'whole'],
  half: ['whole'],
  '16th': ['eighth', 'quarter', 'half', 'whole'],
  '32nd': ['16th', 'eighth', 'quarter', 'half', 'whole'],
}

/**
 * Measure-fill reconciliation for a single ambiguous rest.
 *
 * A rest glyph's written value can be wrong when a nonstandard notation font
 * maps a codepoint to a different rest than SMuFL. When a measure has exactly
 * one known rest, otherwise known notes, and is short of the decoded meter,
 * the smallest longer rest value that fills the measure exactly is accepted
 * (provenance: measure-fill). Multiple candidates or an already-overfull
 * measure are left untouched.
 */
export function reconcileMeasureRests(ir) {
  if (!ir?.meter || !ir?.notes?.length) return
  const beats = (ir.meter.beats * 4) / ir.meter.unit
  if (!(beats > 0)) return
  const sums = new Map()
  const restsByKey = new Map()
  for (const n of ir.notes) {
    if (n.chord_root === false) continue
    const key = `${n.measure}:${n.staff}`
    sums.set(key, (sums.get(key) ?? 0) + Number(n.dur_q ?? 0))
  }
  for (const r of ir.rests) {
    if (!r.type || !r.dur_q) continue
    const key = `${r.measure}:${r.staff}`
    sums.set(key, (sums.get(key) ?? 0) + Number(r.dur_q ?? 0))
    if (!restsByKey.has(key)) restsByKey.set(key, [])
    restsByKey.get(key).push(r)
  }
  let fixed = 0
  for (const [key, rests] of restsByKey) {
    if (rests.length !== 1) continue
    const rest = rests[0]
    const total = sums.get(key) ?? 0
    if (!(total < beats - 0.02)) continue
    const candidates = REST_UPGRADE[rest.type] ?? []
    const matches = candidates.filter((type) =>
      Math.abs(total - Number(rest.dur_q) + TYPE_Q[type] - beats) <= 0.02)
    if (matches.length !== 1) continue
    const type = matches[0]
    rest.type = type
    rest.dur_q = String(TYPE_Q[type])
    rest.provenance = 'measure-fill'
    rest.confidence = 0.5
    rest.visualEvidence = 'ambiguous-glyph-shape'
    rest.practiceSafe = false
    fixed += 1
  }
  ir.restReconciled = fixed
  ir.restInferred = fixed
  if (fixed > 0) {
    ir.credits = ir.credits ?? []
    ir.credits.push(`${fixed} rest duration(s) reconciled to the decoded meter (measure-fill).`)
  }
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
  if ((ir?.unresolvedAccidentals ?? 0) > 0) issues.push('unresolved-accidentals')
  if ((ir?.restInferred ?? 0) > 0) issues.push('rest-duration-inferred')
  if ((ir?.rests ?? []).some((r) => r.visualEvidence === 'ambiguous-glyph-shape')) issues.push('rest-duration-ambiguous')
  if ((ir?.voiceOwnership ?? 'inferred') !== 'verified') issues.push('voice-ownership-unverified')
  if ((ir?.incompletePages ?? 0) > 0) issues.push('incomplete-pages')
  if (ir?.crossPageContinuation === 'unresolved' && (ir?.pageCount ?? 1) > 1) issues.push('cross-page-continuation-unresolved')
  const resolvedCurves = (ir?.tieCount ?? 0) + (ir?.slurCount ?? 0)
  if ((ir?.ambiguousCurves ?? 0) > 0 ||
      (ir?.curveCount ?? 0) > resolvedCurves) issues.push('ties-or-slurs-not-transcribed')

  const beats = measureBeatCount(ir?.meter)
  const badMeasures = []
  const badVoices = []
  if (beats != null && ir?.notes?.length) {
    const byMeasure = new Map()
    for (const event of [...(ir.notes ?? []), ...(ir.rests ?? [])]) {
      if (event.kind === 'rest' && (!event.type || !event.dur_q)) continue
      if (event.chord_root === false) continue
      const key = `${event.measure}:${event.staff}:${event.voice ?? (event.staff + 1)}`
      byMeasure.set(key, (byMeasure.get(key) ?? 0) + Number(event.dur_q ?? 0))
    }
    for (const [key, quarters] of byMeasure) {
      if (Math.abs(quarters - beats) > 0.02) badVoices.push(key)
    }
    for (const key of badVoices) badMeasures.push(key.split(':').slice(0, 2).join(':'))
    if (badVoices.length) {
      issues.push('measure-duration-invalid')
      issues.push('voice-duration-invalid')
    }
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
    tieCount: ir?.tieCount ?? 0,
    restReconciled: ir?.restReconciled ?? 0,
    restInferred: ir?.restInferred ?? 0,
    slurCount: ir?.slurCount ?? 0,
    ambiguousCurves: ir?.ambiguousCurves ?? 0,
    unresolvedNotes: ir?.unresolvedNotes ?? 0,
    unresolvedRests: ir?.unresolvedRests ?? 0,
    badMeasures,
    badVoices,
    voiceOwnership: ir?.voiceOwnership ?? 'inferred',
    voiceGraph: ir?.voiceGraph ?? null,
    issues,
    practiceReady,
    completeFidelity: practiceReady,
    warnings: issues.map((issue) => {
      switch (issue) {
        case 'no-vector-notes': return 'No readable vector piano notes were found.'
        case 'time-signature-unknown': return 'The time signature could not be verified.'
        case 'key-signature-unknown': return 'The key signature is ambiguous; accidentals may be wrong.'
        case 'unresolved-noteheads': return 'Some noteheads had no trustworthy stem/voice evidence.'
        case 'unresolved-rests': return 'Some rests could not be resolved.'
        case 'ties-or-slurs-not-transcribed': return 'Some ties/slurs could not be classified; repeated attacks may be wrong.'
        case 'voice-ownership-unverified': return 'Voice ownership is inferred; independent voices are not proven.'
        case 'voice-duration-invalid': return 'One or more independent voices do not fill the stated meter.'
        case 'measure-duration-invalid': return 'One or more measures do not fill the stated meter.'
        case 'measure-duration-unverifiable': return 'Measure timing could not be validated.'
        case 'unresolved-accidentals': return 'A music-sized filled symbol could not be classified as an accidental.'
        case 'rest-duration-inferred': return 'A rest duration was inferred from measure arithmetic, not visual glyph evidence.'
        case 'rest-duration-ambiguous': return 'The rest glyph shape does not uniquely identify its written duration.'
        case 'incomplete-pages': return 'One or more pages could not be read; the score is incomplete.'
        case 'cross-page-continuation-unresolved': return 'Cross-page ties/slurs cannot yet be continued safely.'
        default: return issue
      }
    }),
  }
}
