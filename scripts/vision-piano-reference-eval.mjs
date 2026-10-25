#!/usr/bin/env node
/**
 * Canonical Piano Vision reference evaluator.
 *
 * One matcher for integration reporting: exact MIDI + MusicXML measure number
 * + written duration + dots, keyed per measure as multisets. Rests are scored
 * separately with the same rule. Measure numbers are the MusicXML
 * `measure@number` (1-based), not array indexes.
 *
 * Usage: node scripts/vision-piano-reference-eval.mjs [--json out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { recognizePianoVectorPdf, assessPianoVectorIr, toMusicXML } from '../src/features/vision/pianoVectorCore.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonArg = args.indexOf('--json')
const JSON_OUT = jsonArg >= 0 ? args[jsonArg + 1] : null

const FIXTURES = [
  'piano-beginner-single-vector',
  'piano-rhythm-tuplets-vector',
  'piano-grand-voices-vector',
  'piano-dense-advanced-vector',
]

function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) { const r = x % y; x = y; y = r }
  return x || 1
}

function fraction(duration, divisions) {
  const g = gcd(duration, divisions)
  const n = duration / g
  const d = divisions / g
  return d === 1 ? String(n) : `${n}/${d}`
}

/**
 * Raw MusicXML counters. Deliberately does not use parseMusicXml: that parser
 * normalises tuplets/dots and loses one exact event relative to the reference.
 * The canonical fields are the note's written duration/divisions, dots, pitch
 * and the MusicXML measure@number (1-based).
 */
function counters(source) {
  const byMeasure = new Map()
  const measureRegex = /<measure\b([^>]*)>([\s\S]*?)<\/measure>/g
  let measureMatch
  let measureIndex = 0
  let divisions = 1
  while ((measureMatch = measureRegex.exec(source)) !== null) {
    measureIndex += 1
    const attrs = measureMatch[1] ?? ''
    const body = measureMatch[2] ?? ''
    const number = /number="([^"]+)"/.exec(attrs)?.[1] ?? String(measureIndex)
    if (!byMeasure.has(number)) byMeasure.set(number, { notes: new Map(), rests: new Map() })
    const foundDivisions = /<divisions>(\d+)<\/divisions>/.exec(body)?.[1]
    if (foundDivisions) divisions = Number(foundDivisions)
    const noteRegex = /<note\b[^>]*>([\s\S]*?)<\/note>/g
    let noteMatch
    while ((noteMatch = noteRegex.exec(body)) !== null) {
      const note = noteMatch[1] ?? ''
      if (/<grace\b/.test(note)) continue
      const duration = Number(/<duration>(\d+)<\/duration>/.exec(note)?.[1] ?? 0)
      if (!(duration > 0)) continue
      const dots = (note.match(/<dot\s*\/?\s*>/g) ?? []).length
      const q = fraction(duration, Math.max(1, divisions))
      const bucket = /<rest\b/.test(note)
        ? byMeasure.get(number).rests
        : byMeasure.get(number).notes
      let key
      if (/<rest\b/.test(note)) {
        key = `${q}:${dots}`
      } else {
        const pitch = /<pitch>([\s\S]*?)<\/pitch>/.exec(note)?.[1] ?? ''
        const step = /<step>([A-G])<\/step>/.exec(pitch)?.[1] ?? 'C'
        const alter = Number(/<alter>(-?\d+)<\/alter>/.exec(pitch)?.[1] ?? 0)
        const octave = Number(/<octave>(-?\d+)<\/octave>/.exec(pitch)?.[1] ?? 4)
        const semitone = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] ?? 0
        const midi = (octave + 1) * 12 + semitone + alter
        key = `${midi}:${q}:${dots}`
      }
      bucket.set(key, (bucket.get(key) ?? 0) + 1)
    }
  }
  return byMeasure
}

function scorePair(truth, prediction) {
  const t = counters(truth, 'truth.musicxml')
  const p = counters(prediction, 'prediction.musicxml')
  const totals = {
    notes: { tp: 0, fp: 0, fn: 0 },
    rests: { tp: 0, fp: 0, fn: 0 },
  }
  for (const measure of new Set([...t.keys(), ...p.keys()])) {
    for (const kind of ['notes', 'rests']) {
      const truthCounts = t.get(measure)?.[kind] ?? new Map()
      const predCounts = p.get(measure)?.[kind] ?? new Map()
      for (const key of new Set([...truthCounts.keys(), ...predCounts.keys()])) {
        const truthCount = truthCounts.get(key) ?? 0
        const predCount = predCounts.get(key) ?? 0
        const matched = Math.min(truthCount, predCount)
        totals[kind].tp += matched
        totals[kind].fp += Math.max(0, predCount - truthCount)
        totals[kind].fn += Math.max(0, truthCount - predCount)
      }
    }
  }
  const ratios = (entry) => {
    const precision = entry.tp + entry.fp > 0 ? entry.tp / (entry.tp + entry.fp) : 0
    const recall = entry.tp + entry.fn > 0 ? entry.tp / (entry.tp + entry.fn) : 0
    return {
      ...entry,
      truth: entry.tp + entry.fn,
      predicted: entry.tp + entry.fp,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
    }
  }
  return { notes: ratios(totals.notes), rests: ratios(totals.rests) }
}

const report = { fixtures: {}, total: { notes: { tp: 0, fp: 0, fn: 0 }, rests: { tp: 0, fp: 0, fn: 0 } } }
for (const id of FIXTURES) {
  const pdfPath = join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.pdf`)
  const truthPath = join(ROOT, 'benchmarks/omr-fixtures', id, `${id}.musicxml`)
  const ir = await recognizePianoVectorPdf(new Uint8Array(readFileSync(pdfPath)), { pdfjsLib: pdfjs })
  const xml = toMusicXML(ir)
  const assessment = assessPianoVectorIr(ir)
  const scored = scorePair(readFileSync(truthPath, 'utf8'), xml)
  report.fixtures[id] = {
    ...scored,
    key: ir.key,
    meter: ir.meter,
    restReconciled: ir.restReconciled ?? 0,
    practiceReady: assessment.practiceReady,
    issues: assessment.issues,
    badMeasures: assessment.badMeasures,
  }
  for (const kind of ['notes', 'rests']) {
    report.total[kind].tp += scored[kind].tp
    report.total[kind].fp += scored[kind].fp
    report.total[kind].fn += scored[kind].fn
  }
}
const ratio = (entry) => {
  const precision = entry.tp + entry.fp > 0 ? entry.tp / (entry.tp + entry.fp) : 0
  const recall = entry.tp + entry.fn > 0 ? entry.tp / (entry.tp + entry.fn) : 0
  return {
    ...entry,
    truth: entry.tp + entry.fn,
    predicted: entry.tp + entry.fp,
    precision: Math.round(precision * 1000) / 1000,
    recall: Math.round(recall * 1000) / 1000,
  }
}
report.total.notes = ratio(report.total.notes)
report.total.rests = ratio(report.total.rests)
console.log(JSON.stringify(report, null, 2))
if (JSON_OUT) writeFileSync(resolve(ROOT, JSON_OUT), `${JSON.stringify(report, null, 2)}\n`)
