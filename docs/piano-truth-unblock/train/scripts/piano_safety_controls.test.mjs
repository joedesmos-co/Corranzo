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
  assignVoices, assignTupletGroups,
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
  curveCount: 0, restInferred: 0, unresolvedAccidentals: 0, credits: [],
  voiceOwnership: 'verified', ...extra,
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

// 4b. the integration agent's exact false acceptance: two voices each two
// beats on one staff. Total is four, but neither voice fills the measure.
x = ir([
  note(0, 0, 100, 100, 60, '1', { voice: '1' }),
  note(0, 0, 200, 100, 64, '1', { voice: '1' }),
  note(0, 0, 100, 120, 48, '1', { voice: '2' }),
  note(0, 0, 200, 120, 52, '1', { voice: '2' }),
])
blocked(x, 'voice-duration-invalid')
assert.equal(assessPianoVectorIr(x).practiceReady, false)
// Two voices that each fill four beats have valid timing, but stem-only
// ownership is still not verified; the score remains preview-only.
x = ir([
  ...Array.from({ length: 4 }, (_, i) => note(0, 0, 100 + 50 * i, 100, 60 + i, '1', { voice: '1' })),
  ...Array.from({ length: 4 }, (_, i) => note(0, 0, 100 + 50 * i, 120, 48 + i, '1', { voice: '2' })),
], [], { voiceOwnership: 'inferred' })
blocked(x, 'voice-ownership-unverified')
assert.equal(assessPianoVectorIr(x).practiceReady, false)
// Stem-direction voice assignment produces two voices for two up/two down.
x = ir([
  { ...note(0, 0, 100, 100, 60), stem_x: 110 },
  { ...note(0, 0, 200, 100, 64), stem_x: 210 },
  { ...note(0, 0, 100, 130, 48), stem_x: 95 },
  { ...note(0, 0, 200, 130, 52), stem_x: 195 },
])
assignVoices(x)
assert.equal(new Set(x.notes.map((n) => n.voice)).size, 2)
x.notes[0].voice = '1'; x.notes[1].voice = '1'
x.notes[2].voice = '2'; x.notes[3].voice = '2'
blocked(x, 'voice-duration-invalid')
assert.equal(x.voiceOwnership, 'inferred')

// 4c. one tuplet numeral must not own six unrelated clusters.
const tupletNotes = [0, 10, 20, 30, 40, 50].map((xx) =>
  ({ x: xx, dur_q: '0.5', type: 'eighth' }))
assignTupletGroups(tupletNotes, [{ x: 25 }], 8)
assert.equal(tupletNotes.filter((n) => n.tuplet).length, 3)
// A triplet of three two-note chords may own six noteheads (three clusters).
const chordNotes = [100, 100, 120, 120, 140, 140].map((xx) =>
  ({ x: xx, dur_q: '0.5', type: 'eighth' }))
assignTupletGroups(chordNotes, [{ x: 120 }], 8)
assert.equal(chordNotes.filter((n) => n.tuplet).length, 6)
// Two markers can own adjacent triples without stealing each other's notes.
const twoGroups = [0, 10, 20, 30, 40, 50].map((xx) =>
  ({ x: xx, dur_q: '0.5', type: 'eighth' }))
assignTupletGroups(twoGroups, [{ x: 10 }, { x: 40 }], 8)
assert.equal(twoGroups.filter((n) => n.tuplet).length, 6)

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
