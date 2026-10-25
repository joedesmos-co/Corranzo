#!/usr/bin/env node
/**
 * Negative controls for practice eligibility. These tests assert that the
 * gate REFUSES scores with unresolved/ambiguous musical evidence, and that
 * the arithmetic rest reconciliation cannot make a score practice-ready by
 * itself. Synthetic IR cases plus actual fixture recognition.
 *
 * Run in a directory with pdfjs-dist 5.4.x and the candidate module.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  assessPianoVectorIr, classifyCurves, reconcileMeasureRests, extractFromData,
} from './pianoVectorCore_candidate.mjs'

const note = (measure, staff, x, y, midi, dur = '1', extra = {}) => ({
  measure, staff, x, y, midi, kind: 'note', type: dur === '1' ? 'quarter' : 'eighth',
  dur_q: dur, dots: 0, chord_root: true, chord_size: 1, ...extra,
})
const rest = (measure, staff, x, y, type, dur, extra = {}) => ({
  measure, staff, x, y, kind: 'rest', type, dur_q: dur, dots: 0, ...extra,
})
const ir = (notes, rests = [], extra = {}) => ({
  route: 'vector', meter: { beats: 4, unit: 4 }, key: 0, gap: 8,
  notes, rests, unresolved: [], unresolvedNotes: 0, unresolvedRests: 0,
  curveCount: 0, restInferred: 0, unresolvedAccidentals: 0, credits: [], ...extra,
})
const blocked = (x, issue) => assert.equal(assessPianoVectorIr(x).issues.includes(issue), true)
const ready = (x) => assert.equal(assessPianoVectorIr(x).practiceReady, true)

// 1. correct eighth rest + missing half note: no inferred upgrade can help
let x = ir([note(0, 0, 100, 100, 60), note(0, 0, 200, 100, 64), note(0, 0, 300, 100, 67)],
  [rest(0, 0, 400, 100, 'eighth', '0.5')])
reconcileMeasureRests(x)
blocked(x, 'rest-duration-inferred')
assert.equal(assessPianoVectorIr(x).practiceReady, false)

// 2. partial pickup measure
x = ir([note(0, 0, 100, 100, 60)])
reconcileMeasureRests(x)
blocked(x, 'measure-duration-invalid')

// 3. wrong detected time signature
x = ir([note(0, 0, 100, 100, 60), note(0, 0, 200, 100, 64), note(0, 0, 300, 100, 67), note(0, 0, 400, 100, 71)],
  [], { meter: { beats: 3, unit: 4 } })
blocked(x, 'measure-duration-invalid')

// 4. two independent voices: both must fill; one short voice blocks
x = ir([...Array.from({ length: 4 }, (_, i) => note(0, 0, 100 + 50 * i, 100, 60 + i)),
  ...Array.from({ length: 4 }, (_, i) => note(0, 1, 100 + 50 * i, 200, 48 + i))])
ready(x)
x.notes.pop()
blocked(x, 'measure-duration-invalid')

// 5. missing rest
x = ir([note(0, 0, 100, 100, 60), note(0, 0, 200, 100, 64), note(0, 0, 300, 100, 67)])
blocked(x, 'measure-duration-invalid')

// 6. multiple ambiguous rests: reconciliation must not choose one
x = ir([note(0, 0, 100, 100, 60), note(0, 0, 200, 100, 64)],
  [rest(0, 0, 300, 100, 'eighth', '0.5'), rest(0, 0, 400, 100, 'eighth', '0.5')])
reconcileMeasureRests(x)
blocked(x, 'measure-duration-invalid')
assert.equal(x.restInferred ?? 0, 0)

// 7. unresolved accidental blocks; a resolved accidental does not
x = ir([note(0, 0, 100, 100, 61), note(0, 0, 200, 100, 64), note(0, 0, 300, 100, 67), note(0, 0, 400, 100, 71)],
  [], { unresolvedAccidentals: 1 })
blocked(x, 'unresolved-accidentals')
x.unresolvedAccidentals = 0
ready(x)

// 8. tied vs repeated notes
x = ir([note(0, 0, 100, 100, 69), note(1, 0, 160, 100, 69)],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 160, y1: 100 }] })
classifyCurves(x)
assert.equal(x.tieCount, 1)
assert.equal(assessPianoVectorIr(x).issues.includes('ties-or-slurs-not-transcribed'), false)
x = ir([note(0, 0, 100, 100, 69), note(1, 0, 160, 100, 69)])
classifyCurves(x)
assert.equal(x.tieCount, 0)

// 9. ambiguous same-pitch slur (long/high curve) must not be merged as a tie
x = ir([note(0, 0, 100, 100, 69), note(1, 0, 1000, 100, 69)],
  [], { curveCount: 1, curves: [{ x0: 100, y0: 100, x1: 1000, y1: 100, h: 40 }] })
classifyCurves(x)
assert.equal(x.tieCount, 0)
blocked(x, 'ties-or-slurs-not-transcribed')

// 10. misclassified / unrelated curve
x = ir([note(0, 0, 100, 100, 69)], [], { curveCount: 1, curves: [{ x0: 500, y0: 500, x1: 600, y1: 500 }] })
classifyCurves(x)
blocked(x, 'ties-or-slurs-not-transcribed')

// 11. incorrect staff ownership leaves a staff short
x = ir([...Array.from({ length: 4 }, (_, i) => note(0, 0, 100 + 50 * i, 100, 60 + i)),
  note(0, 1, 100, 200, 48)], [], {})
blocked(x, 'measure-duration-invalid')

// 12. partially recognized multi-page score
x = ir([note(0, 0, 100, 100, 60)], [], { pageCount: 2, incompletePages: 1,
  crossPageContinuation: 'unresolved' })
blocked(x, 'incomplete-pages')
blocked(x, 'cross-page-continuation-unresolved')

// 13. actual recognition: beginner rest is visually ambiguous -> refused
const ROOT = process.env.CORRANZO_ROOT ?? path.resolve(process.env.HOME, 'Documents/scoreflow-piano-unblock')
const FIX = path.join(ROOT, 'benchmarks', 'omr-fixtures')
const beginner = new Uint8Array(fs.readFileSync(path.join(FIX, 'piano-beginner-single-vector', 'piano-beginner-single-vector.pdf')))
const beginnerIr = await extractFromData(pdfjs, beginner, 1)
const beginnerGate = assessPianoVectorIr(beginnerIr)
assert.equal(beginnerGate.practiceReady, false)
assert.equal(beginnerGate.issues.includes('rest-duration-inferred'), true)

// 14. actual recognition: grand has no rests; tie/slur resolved -> ready
const grand = new Uint8Array(fs.readFileSync(path.join(FIX, 'piano-grand-voices-vector', 'piano-grand-voices-vector.pdf')))
const grandIr = await extractFromData(pdfjs, grand, 1)
const grandGate = assessPianoVectorIr(grandIr)
assert.equal(grandGate.practiceReady, true)
assert.equal(grandGate.tieCount, 1)
assert.equal(grandGate.slurCount, 1)

console.log('practice safety controls: OK')
