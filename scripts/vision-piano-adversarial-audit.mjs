#!/usr/bin/env node
/**
 * Integration-owned Piano practice-safety adversarial corpus.
 *
 * Run against the production gate or a research core. The corpus deliberately
 * uses synthetic IRs, not the research agent's tests. Every case expects the
 * gate to refuse practice; a `practiceReady:true` result is a false acceptance.
 *
 * Usage:
 *   node scripts/vision-piano-adversarial-audit.mjs
 *   VISION_CORE=tmp/piano-b4.mjs node scripts/vision-piano-adversarial-audit.mjs
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const corePath = process.env.VISION_CORE ?? 'src/features/vision/pianoVectorCore.js'
const core = await import(pathToFileURL(resolve(ROOT, corePath)).href)
const assess = core.assessPianoVectorIr
const classify = core.classifyCurves
const reconcile = core.reconcileMeasureRests
if (typeof assess !== 'function') throw new Error('core has no assessPianoVectorIr')

const note = (measure, x, y, midi, staff = 0, dur = '4', extra = {}) => ({
  measure, x, y, midi, staff, kind: 'note', type: dur === '4' ? 'whole' : 'quarter',
  dur_q: dur, dots: 0, chord_root: true, chord_size: 1, ...extra,
})
const rest = (measure, x, y, type, dur, extra = {}) => ({
  measure, x, y, kind: 'rest', type, dur_q: dur, dots: 0, staff: 0, ...extra,
})
const base = (notes, rests = [], extra = {}) => ({
  route: 'vector', meter: { beats: 4, unit: 4 }, key: 0, gap: 8,
  notes, rests, unresolved: [], unresolvedNotes: 0, unresolvedRests: 0,
  curveCount: 0, restInferred: 0, unresolvedAccidentals: 0, credits: [], ...extra,
})
const cases = []

let ir = base([note(0, 100, 100, 64, 0, '1.5'), note(0, 200, 100, 67, 0, '0.5'), note(0, 300, 100, 69, 0, '1')],
  [rest(0, 400, 100, 'eighth', '0.5', { truth: 'eighth' })])
if (reconcile) reconcile(ir)
cases.push(['legitimate eighth rest + missed note', ir])

ir = base([note(0, 100, 100, 64, 0, '1.5'), note(0, 200, 100, 67, 0, '0.5')],
  [rest(0, 300, 100, 'eighth', '0.5', { truth: 'eighth' })])
if (reconcile) reconcile(ir)
cases.push(['pickup/incomplete bar', ir])

ir = base([note(0, 100, 100, 64, 0, '1.5'), note(0, 200, 100, 67, 0, '0.5')],
  [rest(0, 300, 100, 'eighth', '0.5', { truth: 'eighth' })], { meter: { beats: 3, unit: 4 } })
if (reconcile) reconcile(ir)
cases.push(['wrong decoded meter', ir])

ir = base([
  note(0, 100, 100, 60, 0, '1', { voice: 1 }), note(0, 150, 100, 64, 0, '1', { voice: 1 }),
  note(0, 100, 120, 55, 0, '1', { voice: 2 }), note(0, 150, 120, 50, 0, '1', { voice: 2 }),
])
cases.push(['same-staff two incomplete voices (sum fills)', ir])

ir = base([note(0, 100, 100, 69), note(1, 160, 100, 69)],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 160, y1: 100, h: 2 }] })
if (classify) classify(ir)
cases.push(['equal-pitch short slur', ir])

ir = base([note(0, 100, 100, 69, 0, '4', { voice: 1 }), note(1, 160, 100, 69, 0, '4', { voice: 2 })],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 160, y1: 100, h: 2 }] })
if (classify) classify(ir)
cases.push(['cross-voice curve', ir])

ir = base([note(0, 100, 100, 69), note(1, 160, 100, 72)],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 160, y1: 100, h: 5.5 }] })
if (classify) classify(ir)
cases.push(['decorative short curve', ir])

ir = base([note(0, 100, 100, 69), note(1, 1000, 100, 69)],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 1000, y1: 100, h: 40 }] })
if (classify) classify(ir)
cases.push(['long/high equal-pitch curve', ir])

ir = base([note(0, 100, 100, 61), note(0, 200, 100, 64), note(0, 300, 100, 67), note(0, 400, 100, 71)],
  [], { unresolvedAccidentals: 1 })
cases.push(['unresolved accidental', ir])

ir = base([note(0, 100, 100, 60)], [],
  { pageCount: 2, incompletePages: 1, crossPageContinuation: 'unresolved' })
cases.push(['partial multi-page', ir])

let failures = 0
for (const [name, ir] of cases) {
  const result = assess(ir)
  const falseAcceptance = result.practiceReady === true
  if (falseAcceptance) failures += 1
  console.log(JSON.stringify({
    case: name,
    practiceReady: result.practiceReady,
    falseAcceptance,
    issues: result.issues,
    tieCount: ir.tieCount ?? 0,
    slurCount: ir.slurCount ?? 0,
    ambiguousCurves: ir.ambiguousCurves ?? 0,
    restInferred: ir.restInferred ?? 0,
  }))
}
console.log(`\n${cases.length - failures}/${cases.length} safety controls refused practice`)
if (failures) process.exitCode = 1
