#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root,'benchmarks/mic-real/manifest.json'),'utf8'))
const alignProbe = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/align-probe.json'),'utf8'))
const deltaById = Object.fromEntries((alignProbe.rows||[]).map(r=>[r.id,r.bestDelta??0]))
const realBench = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/real-bench.json'),'utf8'))
const realBenchAligned = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/real-bench-aligned.json'),'utf8'))
const audit = JSON.parse(readFileSync(join(root,'benchmarks/audio-vision/annotation-audit.json'),'utf8'))
const byId = Object.fromEntries(realBench.rows.map(r=>[r.id,r]))
const byIdA = Object.fromEntries(realBenchAligned.rows.map(r=>[r.id,r]))

const entries = manifest.clips.map(c => ({
  id: c.id,
  instrument: c.instrument,
  category: c.category,
  split: c.split,
  dataset: c.dataset,
  license: c.license,
  attribution: c.attribution,
  sourceFile: c.sourceFile,
  sourceTruthFile: c.sourceTruthFile,
  audio: {
    file: c.audio.file,
    sampleRate: c.audio.sampleRate,
    startSeconds: c.audio.startSeconds,
    durationSeconds: c.audio.durationSeconds,
  },
  reference: {
    noteCount: (c.truth.notes||[]).length,
    anchorOnset: c.truth.anchorOnset ?? null,
    anchorTones: c.truth.anchorTones ?? null,
    negativeOnsetCount: (c.truth.notes||[]).filter(n=>n.onset<0).length,
    alignProbeDelta: deltaById[c.id] ?? null,
    alignProbeBestRate: (alignProbe.rows||[]).find(r=>r.id===c.id)?.bestRate ?? null,
  },
  metrics: {
    raw: byId[c.id] ? { f1:byId[c.id].f1, precision:byId[c.id].precision, recall:byId[c.id].recall, onsetMaeMs:byId[c.id].onsetMaeMs, octaveErrors:byId[c.id].octaveErrors, falseNotes:byId[c.id].falsePositives } : null,
    aligned: byIdA[c.id] ? { f1:byIdA[c.id].f1Aligned, precision:byIdA[c.id].precisionAligned, recall:byIdA[c.id].recallAligned, onsetMaeMs:byIdA[c.id].onsetMaeMsAligned, octaveErrors:byIdA[c.id].octaveErrorsAligned } : null,
  },
}))

const canonical = {
  version: 1,
  generatedAt: new Date().toISOString(),
  description: 'Canonical real-audio evaluation manifest. Combines clip identity, source/license, reference timestamps, align-probe correction provenance, evaluation tolerances, model/extractor version, and per-clip metrics (raw and aligned).',
  model: { name: 'Basic Pitch (released, TF.js)', path: 'public/neural-model', weights: 'released' },
  extractor: { name: 'production', onsetThreshold: 0.65, frameThreshold: 0.5, minNoteFrames: 3, onsetToleranceSec: 0.12 },
  audio: { sampleRate: 22050, mono: true },
  splits: ['dev','eval','eval-fresh'],
  excluded: manifest.excluded,
  provenance: {
    alignProbe: 'benchmarks/audio-vision/align-probe.json (DSP: spectral-flux peaks, no model)',
    realBench: 'benchmarks/audio-vision/real-bench.json (raw)',
    realBenchAligned: 'benchmarks/audio-vision/real-bench-aligned.json (align-probe delta applied)',
    annotationAudit: 'benchmarks/audio-vision/annotation-audit.json',
  },
  aggregate: {
    raw: realBench.aggregate,
    aligned: realBenchAligned.aggregate,
  },
  clips: entries,
}
writeFileSync(join(root,'benchmarks/audio-vision/canonical-manifest.json'), JSON.stringify(canonical,null,2))
console.log('clips:', entries.length)
console.log('written benchmarks/audio-vision/canonical-manifest.json')
