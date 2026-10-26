#!/usr/bin/env node
/**
 * Cross-domain benchmark: does PERFORMANCE structure reproduce the failures the
 * released model makes on real music, where timbre alone did not?
 *
 * Three renderings of the SAME compositions:
 *   clean        simple timbre, metronomic, flat dynamics (the first corpus)
 *   timbre       realistic attack/decay/tilt/noise, still metronomic
 *   performance  + jitter, chord rolls, articulation, damping, quiet inner
 *                voices, register dynamics (a human playing it)
 *
 * Scored with the unchanged production extractor. Reported: micro P/R/F1,
 * register recall, octave errors, onset/duration error, quiet-note and
 * inner-voice recall, and dense/sparse split. The real GuitarSet profile measured
 * with the same code is printed beside it - the question is whether the FAILURE
 * SHAPE converges, not whether a score falls.
 *
 * Usage: node --expose-gc scripts/audio-vision-performance-bench.mjs [--json out]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compositionSpec, renderComposition } from './lib/synthCorpus.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { scoreEvents } from './lib/eventScore.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : 'benchmarks/audio-vision/performance-bench.json'
const resolveOut = (v) => (v.startsWith('/') ? v : join(root, v))

const TEXTURES = ['single', 'melody', 'chords', 'dense', 'bass', 'innerVoices']
const MODES = {
  clean: { realistic: false, performance: false },
  timbre: { realistic: true, performance: false },
  performance: { realistic: true, performance: true, performanceOptions: { jitterMs: 20, rollMs: 32, velocitySpread: 0.4, innerVoiceGain: 0.4, staccato: 0.25, legato: 0.2, damping: 0.15 } },
}
const registerOf = (m) => (m < 48 ? 'bass' : m < 72 ? 'mid' : 'high')

const rows = []
for (const instrument of ['piano', 'guitar']) {
  for (const texture of TEXTURES) {
    const spec = compositionSpec({ id: `perf-${instrument}-${texture}`, instrument, texture, bars: 2, bpm: 96 })
    for (const [mode, options] of Object.entries(MODES)) {
      const rendered = renderComposition(spec, options)
      const bp = await predictBasicPitchNode(rendered.samples, { modelDir: join(root, 'public/neural-model') })
      const pred = bp.notes.map((n) => ({ midi: n.midi, onset: n.startSeconds, duration: (n.endSeconds ?? n.startSeconds) - n.startSeconds }))
      const truth = rendered.notes.map((n) => ({ midi: n.midi, onset: n.audibleOnsetSeconds ?? n.onsetSeconds, offset: n.offsetSeconds, velocity: n.velocity }))
      const score = scoreEvents(pred, truth, { tolerance: 0.12 })
      const octave = (() => { let c = 0; for (const p of pred) { const same = truth.filter((t) => Math.abs(t.onset - p.onset) <= 0.12); if (same.length && !same.some((t) => t.midi === p.midi) && same.some((t) => Math.abs(t.midi - p.midi) % 12 === 0)) c += 1 } return c })()
      const reg = {}
      for (const r of ['bass', 'mid', 'high']) {
        const t = truth.filter((n) => registerOf(n.midi) === r); const p = pred.filter((n) => registerOf(n.midi) === r)
        const s = scoreEvents(p, t); reg[r] = { notes: t.length, recall: s.pitchRecall, precision: s.pitchPrecision }
      }
      const quiet = truth.filter((n) => n.velocity < 0.35)
      const quietScore = scoreEvents(pred.filter((p) => quiet.some((q) => Math.abs(q.onset - p.onset) <= 0.12)), quiet)
      const innerTruth = texture === 'innerVoices' ? truth.filter((n, i) => n.velocity < 0.35) : []
      const innerRecall = innerTruth.length ? scoreEvents(pred, innerTruth).pitchRecall : null
      const truthOnset = truth.map((t) => t.onset); const predOnset = pred.map((p) => p.onset)
      rows.push({
        id: `${instrument}/${texture}`, instrument, texture, mode,
        notes: truth.length, performedRolled: rendered.notes.filter((n) => n.rolled).length,
        f1: score.eventF1, precision: score.pitchPrecision, recall: score.pitchRecall,
        bassRecall: reg.bass.recall, midRecall: reg.mid.recall, highRecall: reg.high.recall,
        bassNotes: reg.bass.notes, midNotes: reg.mid.notes, highNotes: reg.high.notes,
        quietNotes: quiet.length, quietRecall: quiet.length ? quietScore.pitchRecall : null,
        innerRecall, octaveErrors: octave,
        onsetMaeMs: score.onsetMaeMs, durationMaeMs: score.durationMaeMs,
        predCount: pred.length,
      })
      console.log(`${(instrument + '/' + texture).padEnd(18)} ${mode.padEnd(12)} notes ${String(truth.length).padStart(3)}  F1 ${score.eventF1}  P ${score.pitchPrecision}  R ${score.pitchRecall}  bass ${reg.bass.recall}  oct ${octave}`)
    }
    if (global.gc) global.gc()
  }
}
await closeBasicPitchNode()

const mean = (v) => { const x = v.filter((n) => Number.isFinite(n)); return x.length ? Math.round(x.reduce((a, b) => a + b, 0) / x.length * 1000) / 1000 : null }
const summarise = (list) => ({
  recordings: list.length,
  microF1: mean(list.map((r) => r.f1)),
  precision: mean(list.map((r) => r.precision)),
  recall: mean(list.map((r) => r.recall)),
  // Only average a register where that register actually has notes - an empty
  // register scores 0 and would drag the mean down for no musical reason.
  bassRecall: mean(list.filter((r) => (r.bassNotes ?? 0) > 0).map((r) => r.bassRecall)),
  midRecall: mean(list.filter((r) => (r.midNotes ?? 0) > 0).map((r) => r.midRecall)),
  highRecall: mean(list.filter((r) => (r.highNotes ?? 0) > 0).map((r) => r.highRecall)),
  quietRecall: mean(list.filter((r) => (r.quietNotes ?? 0) > 0).map((r) => r.quietRecall)),
  registerNotes: {
    bass: list.reduce((a, r) => a + (r.bassNotes ?? 0), 0),
    mid: list.reduce((a, r) => a + (r.midNotes ?? 0), 0),
    high: list.reduce((a, r) => a + (r.highNotes ?? 0), 0),
  },
  innerVoiceRecall: mean(list.map((r) => r.innerRecall)),
  octaveErrors: list.reduce((a, r) => a + r.octaveErrors, 0),
  onsetMaeMs: mean(list.map((r) => r.onsetMaeMs)),
  durationMaeMs: mean(list.map((r) => r.durationMaeMs)),
})
const byMode = {}
for (const mode of Object.keys(MODES)) byMode[mode] = summarise(rows.filter((r) => r.mode === mode))
byMode.byModeByInstrument = {}
for (const mode of Object.keys(MODES)) {
  byMode.byModeByInstrument[mode] = {}
  for (const instrument of ['piano', 'guitar']) byMode.byModeByInstrument[mode][instrument] = summarise(rows.filter((r) => r.mode === mode && r.instrument === instrument))
}
// real reference, same scorer, from the domain-gap study
let real = null
try {
  const gap = JSON.parse(readFileSync(join(root, 'benchmarks/audio-vision/domain-gap-after.json'), 'utf8'))
  real = { guitar: gap.model['real-guitar'], piano: gap.model['real-piano'] }
} catch { /* optional */ }

const report = { generatedAt: new Date().toISOString(), note: 'synthetic modes share compositions; real GuitarSet is different repertoire - compare failure SHAPES, not aggregate F1', modes: MODES, summary: byMode, real, recordings: rows }
writeFileSync(resolveOut(jsonOut), JSON.stringify(report, null, 1))
console.log('\nMODE SUMMARY')
for (const [mode, s] of Object.entries(byMode)) {
  if (mode === 'byModeByInstrument') continue
  console.log(`${mode.padEnd(12)} F1 ${s.microF1} P ${s.precision} R ${s.recall} | bass ${s.bassRecall} mid ${s.midRecall} high ${s.highRecall} | quiet ${s.quietRecall} oct ${s.octaveErrors} onset ${s.onsetMaeMs}`)
}
console.log('REAL (same scorer):', JSON.stringify(real))
console.log('written', resolveOut(jsonOut))
