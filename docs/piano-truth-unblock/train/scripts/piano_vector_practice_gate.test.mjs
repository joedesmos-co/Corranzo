#!/usr/bin/env node
/**
 * Practice-gate regression for the piano vector core candidate.
 *
 * Requires pdfjs-dist (5.4.x) resolvable from this directory and the fixture
 * PDFs under benchmarks/omr-fixtures. Run from a directory containing the
 * candidate module and pdfjs-dist, e.g.:
 *   node piano_vector_practice_gate.test.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  extractFromData,
  toMusicXML,
  assessPianoVectorIr,
} from './pianoVectorCore_candidate.mjs'

const ROOT = process.env.CORRANZO_ROOT ??
  path.resolve(process.env.HOME ?? '.', 'Documents/scoreflow-piano-unblock')
const FIX = path.join(ROOT, 'benchmarks', 'omr-fixtures')

const CASES = [
  { name: 'piano-beginner-single-vector', practice: false, validMeasures: true,
    notes: 32, rests: 1, measures: 8, restType: 'quarter' },
  { name: 'piano-rhythm-tuplets-vector', practice: false, validMeasures: false },
  { name: 'piano-grand-voices-vector', practice: true, validMeasures: true,
    notes: 88, rests: 0, measures: 8 },
  { name: 'piano-dense-advanced-vector', practice: false, validMeasures: false },
]

let failures = 0
for (const test of CASES) {
  const pdf = path.join(FIX, test.name, `${test.name}.pdf`)
  const data = new Uint8Array(fs.readFileSync(pdf))
  const ir = await extractFromData(pdfjs, data, 1)
  const gate = assessPianoVectorIr(ir)
  const xml = toMusicXML(ir)
  const measures = new Set(ir.notes.map((n) => n.measure)).size
  const rest = ir.rests[0]
  const checks = [
    ['practiceReady', gate.practiceReady, test.practice],
    ['measureCount', measures, test.measures ?? undefined],
    ['noteCount', ir.notes.length, test.notes ?? undefined],
    ['restCount', ir.rests.length, test.rests ?? undefined],
    ['restType', rest?.type, test.restType ?? undefined],
    ['validXml', /^<\?xml/.test(xml) && xml.includes('</score-partwise>'), true],
    ['measureValidity', gate.badMeasures.length === 0, test.validMeasures ?? undefined],
  ]
  for (const [label, actual, expected] of checks) {
    if (expected === undefined) continue
    if (actual !== expected) {
      failures += 1
      console.error(`FAIL ${test.name} ${label}: got ${actual}, expected ${expected}`)
    }
  }
  console.log(`${test.name}: practiceReady=${gate.practiceReady} notes=${ir.notes.length} ` +
    `rests=${ir.rests.length} issues=[${gate.issues.join(',')}]`)
}
if (failures) {
  console.error(`${failures} assertion(s) failed`)
  process.exit(1)
}
console.log('practice-gate regression: OK')
