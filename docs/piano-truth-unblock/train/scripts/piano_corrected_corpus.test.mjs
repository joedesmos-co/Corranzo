#!/usr/bin/env node
/** Practice-gate regression on the corrected CC0 corpus (independent engraving
 * of the same references, with the quarter-rest and flag defects fixed). */
import fs from 'node:fs'
import path from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractFromData, assessPianoVectorIr } from './pianoVectorCore_candidate.mjs'

const ROOT = process.env.CORRANZO_ROOT ?? path.resolve(process.env.HOME, 'Documents/scoreflow-piano-unblock')
const FIX = path.join(ROOT, 'benchmarks', 'omr-fixtures-corrected')
const CASES = [
  { name: 'piano-beginner-single-vector', ready: true, notes: 32, rests: 1 },
  { name: 'piano-rhythm-tuplets-vector', ready: true, notes: 63, rests: 5 },
  { name: 'piano-grand-voices-vector', ready: true, notes: 88, rests: 0 },
  { name: 'piano-dense-advanced-vector', ready: false, notes: 226, rests: 0 },
]
let failures = 0
for (const test of CASES) {
  const pdf = path.join(FIX, test.name, `${test.name}.pdf`)
  const data = new Uint8Array(fs.readFileSync(pdf))
  const ir = await extractFromData(pdfjs, data, 1)
  const gate = assessPianoVectorIr(ir)
  const checks = [
    ['practiceReady', gate.practiceReady, test.ready],
    ['notes', ir.notes.length, test.notes],
    ['rests', ir.rests.length, test.rests],
    ['restInferred', gate.restInferred, 0],
  ]
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      failures += 1
      console.error(`FAIL ${test.name} ${label}: got ${actual}, expected ${expected}`)
    }
  }
  console.log(`${test.name}: ready=${gate.practiceReady} notes=${ir.notes.length} rests=${ir.rests.length} issues=[${gate.issues.join(',')}]`)
}
if (failures) process.exit(1)
console.log('corrected-corpus gate: OK')
