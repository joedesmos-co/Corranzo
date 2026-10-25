#!/usr/bin/env node
/** Negative controls for tie/slur classification (synthetic IR, no PDF). */
import assert from 'node:assert/strict'
import { classifyCurves, assessPianoVectorIr } from './pianoVectorCore_candidate.mjs'

const note = (measure, x, y, midi, staff = 0) => ({
  measure, x, y, midi, staff, kind: 'note', type: 'quarter',
  dur_q: '1', dots: 0, chord_root: true, chord_size: 1,
})

function base(notes, curves) {
  return {
    route: 'vector', meter: { beats: 4, unit: 4 }, key: 0, gap: 8,
    notes, rests: [], unresolved: [], unresolvedNotes: 0,
    unresolvedRests: 0, curveCount: curves.length, curves,
  }
}

// 1. same-pitch cross-measure tie
let ir = base([note(0, 100, 100, 69), note(1, 160, 100, 69)],
  [{ x0: 100, y0: 100, x1: 160, y1: 100 }])
classifyCurves(ir)
assert.equal(ir.tieCount, 1)
assert.equal(ir.slurCount, 0)
assert.equal(ir.notes[0].tie_start, true)
assert.equal(ir.notes[1].tie_end, true)
assert.equal(assessPianoVectorIr(ir).issues.includes('ties-or-slurs-not-transcribed'), false)

// 2. repeated same pitch without a curve is not a tie
ir = base([note(0, 100, 100, 69), note(0, 200, 100, 69)], [])
classifyCurves(ir)
assert.equal(ir.tieCount, 0)
assert.equal(ir.notes[0].tie_start, undefined)

// 3. different pitches -> slur
ir = base([note(0, 100, 100, 72), note(1, 200, 90, 76)],
  [{ x0: 100, y0: 100, x1: 200, y1: 90 }])
classifyCurves(ir)
assert.equal(ir.slurCount, 1)
assert.equal(ir.tieCount, 0)
assert.equal(ir.notes[0].slur_start, true)
assert.equal(ir.notes[1].slur_end, true)

// 4. ambiguous curve (no nearby notes) keeps the gate closed
ir = base([note(0, 100, 100, 69)], [{ x0: 400, y0: 400, x1: 500, y1: 400 }])
classifyCurves(ir)
assert.equal(ir.ambiguousCurves, 1)
assert.equal(assessPianoVectorIr(ir).issues.includes('ties-or-slurs-not-transcribed'), true)

// 5. chord partial tie: only the equal-pitch A4 is tied
ir = base([
  note(0, 100, 100, 69), note(0, 100, 92, 72),
  note(1, 160, 100, 69), note(1, 200, 84, 76),
], [{ x0: 100, y0: 100, x1: 160, y1: 100 }])
classifyCurves(ir)
assert.equal(ir.tieCount, 1)
assert.equal(ir.notes[0].tie_start, true)
assert.equal(ir.notes[1].tie_start, undefined)
assert.equal(ir.notes[2].tie_end, true)
assert.equal(ir.notes[3].tie_end, undefined)

// 6. equal pitches connected by a curve are a tie (standard notation)
ir = base([note(0, 100, 100, 69), note(1, 160, 100, 69)], [{ x0: 100, y0: 100, x1: 160, y1: 100 }])
classifyCurves(ir)
assert.equal(ir.tieCount, 1)

// 7. multi-voice: tie goes to the closest equal pitch on the same staff
ir = base([
  note(0, 100, 100, 69, 0), note(0, 100, 150, 69, 1),
  note(1, 160, 100, 69, 0), note(1, 160, 150, 69, 1),
], [{ x0: 100, y0: 100, x1: 160, y1: 100 }])
classifyCurves(ir)
assert.equal(ir.tieCount, 1)
assert.equal(ir.notes[0].tie_start, true)
assert.equal(ir.notes[1].tie_start, undefined)

console.log('curve classification negative controls: OK')
