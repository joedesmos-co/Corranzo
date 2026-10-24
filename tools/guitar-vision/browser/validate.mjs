// Node validation for the browser pipeline. Uses the same module that the
// browser demo imports; only the canvas factory differs.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { recognizePdf } from './guitar-vision.mjs'

const ROOT = new URL('../../../', import.meta.url).pathname
const FIX = [
  'guitar-paired-chords-vector',
  'guitar-tab-sparse-vector',
  'guitar-techniques-paired-vector',
  'guitar-paired-scan',
]

function parseRef(path) {
  const xml = readFileSync(path, 'utf8')
  const measures = new Map()
  for (const m of xml.matchAll(/<measure number="(\d+)"[^>]*>([\s\S]*?)<\/measure>/g)) {
    const mn = +m[1]
    const list = []
    for (const n of m[2].matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      const body = n[1]
      if (!body.includes('<string>') || !body.includes('<fret>')) continue
      const s = +body.match(/<string>(\d+)<\/string>/)[1]
      const f = +body.match(/<fret>(\d+)<\/fret>/)[1]
      list.push([s, f])
    }
    measures.set(mn, list)
  }
  return measures
}

function multisetScore(predByM, refByM) {
  let tp = 0, fp = 0, fn = 0, mOk = 0
  const ms = new Set([...predByM.keys(), ...refByM.keys()])
  for (const m of ms) {
    const P = new Map(), R = new Map()
    for (const x of predByM.get(m) || []) P.set(x, (P.get(x) || 0) + 1)
    for (const x of refByM.get(m) || []) R.set(x, (R.get(x) || 0) + 1)
    let inter = 0, pn = 0, rn = 0
    for (const [, v] of P) pn += v
    for (const [, v] of R) rn += v
    for (const [k, v] of P) inter += Math.min(v, R.get(k) || 0)
    tp += inter; fp += pn - inter; fn += rn - inter
    if (pn === rn && inter === pn) mOk++
  }
  return { tp, fp, fn, mOk, measures: ms.size }
}

mkdirSync('/tmp/gv-js', { recursive: true })
for (const name of FIX) {
  const pdfPath = join(ROOT, 'benchmarks/omr-fixtures', name, `${name}.pdf`)
  const refPath = join(ROOT, 'benchmarks/omr-fixtures', name, `${name}.musicxml`)
  let data
  try { data = readFileSync(pdfPath) } catch { console.log(name, 'MISSING'); continue }
  const t0 = Date.now()
  const res = await recognizePdf(data, { dpi: 150, createCanvas })
  const ms = Date.now() - t0
  writeFileSync(`/tmp/gv-js/${name}.musicxml`, res.xml)
  writeFileSync(`/tmp/gv-js/${name}-events.json`, JSON.stringify(res.events, null, 1))
  const pred = new Map()
  for (const e of res.events) {
    if (!pred.has(e.measure)) pred.set(e.measure, [])
    pred.get(e.measure).push(`${e.string},${e.fret}`)
  }
  const ref = parseRef(refPath)
  const refM = new Map()
  for (const [m, list] of ref) refM.set(m, list.map(([s, f]) => `${s},${f}`))
  const predM = new Map()
  for (const [m, list] of pred) predM.set(m, [...list])
  const s = multisetScore(predM, refM)
  console.log(name.padEnd(34), 'events', String(res.events.length).padStart(3),
    'SF', `${s.tp}/${s.tp + s.fn}`, `P ${(s.tp / Math.max(s.tp + s.fp, 1)).toFixed(3)}`,
    `R ${(s.tp / Math.max(s.tp + s.fn, 1)).toFixed(3)}`,
    'measures', `${s.mOk}/${s.measures}`,
    'rhythm', res.summary.rhythm_recovered ? 'yes' : 'no',
    'ms', ms)
}
