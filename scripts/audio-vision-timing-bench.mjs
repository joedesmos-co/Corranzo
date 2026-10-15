/**
 * Timing benchmark — frozen development material with INDEPENDENTLY CHECKED
 * beat/downbeat annotations.
 *
 * GuitarSet JAMS supplies beat positions (with `position` and `measure`, so
 * DOWNBEATS are position===1) and a tempo annotation per track. This script
 * verifies what that reference actually means before scoring anything:
 *   - the annotated beat period vs the annotated tempo
 *   - the meter (beat_units) and whether downbeats are evenly spaced
 *   - the excerpt length covered
 *
 * It then separates the error KINDS rather than reporting one number:
 *   tempo        : |estimated BPM - reference BPM| and the ratio class
 *                  (1, 1.5, 2, 3, 4, 2/3 ...), i.e. which periodicity was locked
 *   phase        : beat-grid offset to the nearest reference beat
 *   downbeat     : whether measure starts align
 *   onset        : reference onsets with no transcribed note nearby
 *   quantization : transcribed note onset residual to the REFERENCE grid
 *   durations    : mean note duration in reference beats (musical sanity)
 *
 * Tuning is explicitly NOT done on the GuitarSet holdout; only the development
 * recordings and the two baselines appear here.
 *
 * Usage: node --expose-gc scripts/audio-vision-timing-bench.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/timing-bench.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/timing-bench.md')

// Development material + the two long-standing baselines. NOT the holdout.
const TRACKS = [
  { id: 'guitarset-ss-comp', jams: '/tmp/guitarset/jams/00_SS3-84-Bb_comp.jams', wav: '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav' },
  { id: 'guitarset-funk3', jams: '/tmp/guitarset/jams/00_Funk3-112-C#_comp.jams', wav: '/tmp/guitarset/00_Funk3-112-C#_comp_mic.wav' },
  { id: 'guitarset-jazz-solo', jams: '/tmp/guitarset/jams/04_Jazz1-200-B_solo.jams', wav: '/tmp/guitarset/04_Jazz1-200-B_solo_mic.wav' },
  { id: 'guitarset-rock2', jams: '/tmp/guitarset/jams/00_Rock2-142-D_comp.jams', wav: '/tmp/guitarset/00_Rock2-142-D_comp_mic.wav' },
  { id: 'guitarset-bn2', jams: '/tmp/guitarset/jams/00_BN2-131-B_comp.jams', wav: '/tmp/guitarset/00_BN2-131-B_comp_mic.wav' },
  { id: 'guitarset-jazz2', jams: '/tmp/guitarset/jams/00_Jazz2-110-Bb_comp.jams', wav: '/tmp/guitarset/00_Jazz2-110-Bb_comp_mic.wav' },
]

function ratioClass(estimate, reference) {
  if (!reference) return null
  const ratio = estimate / reference
  const candidates = [
    [1, '1'], [0.5, '1/2'], [2, '2'], [0.25, '1/4'], [4, '4'],
    [1 / 3, '1/3'], [3, '3'], [2 / 3, '2/3'], [3 / 2, '3/2'],
    [1.5, '3/2'], [4 / 3, '4/3'], [3 / 4, '3/4'], [0.75, '3/4'],
  ]
  let best = candidates[0]
  let bestErr = Infinity
  for (const c of candidates) {
    const err = Math.abs(ratio - c[0]) / (c[0] === 0 ? 1 : Math.abs(c[0]))
    if (err < bestErr) {
      bestErr = err
      best = c
    }
  }
  return { ratio: Number(ratio.toFixed(4)), class: best[1], relativeError: Number(bestErr.toFixed(4)) }
}

function nearest(items, target, tolerance = Infinity) {
  let best = null
  let bestDist = tolerance
  for (const item of items) {
    const d = Math.abs(item - target)
    if (d < bestDist) {
      bestDist = d
      best = item
    }
  }
  return { value: best, distance: bestDist }
}

const rows = []
for (const track of TRACKS) {
  if (!existsSync(track.wav)) {
    console.log(`skip ${track.id}: missing ${track.wav}`)
    continue
  }
  const jams = JSON.parse(readFileSync(track.jams, 'utf8'))
  // Reference: tempo, beats, downbeats, onsets.
  const tempoAnnotation = jams.annotations.find((a) => a.namespace === 'tempo')
  const referenceTempo = tempoAnnotation?.data?.[0]?.value ?? null
  const beatAnnotation = jams.annotations.find((a) => a.namespace === 'beat_position')
  const beatEntries = (beatAnnotation?.data ?? []).filter((b) => Number.isFinite(b.time) && b.value)
  const referenceBeats = beatEntries.map((b) => b.time).sort((a, b) => a - b)
  const downbeats = beatEntries.filter((b) => b.value.position === 1).map((b) => b.time).sort((a, b) => a - b)
  const beatUnits = beatEntries[0]?.value?.beat_units ?? null
  const numBeats = beatEntries[0]?.value?.num_beats ?? null
  // Reference onsets: note_midi events.
  const referenceOnsets = []
  for (const a of jams.annotations) {
    if (a.namespace !== 'note_midi') continue
    for (const d of a.data) {
      if (d.time === '' || d.value === '') continue
      referenceOnsets.push(d.time)
    }
  }
  referenceOnsets.sort((a, b) => a - b)

  // Verify what the reference means: annotated tempo vs measured beat spacing.
  const beatGaps = []
  for (let i = 1; i < referenceBeats.length; i += 1) beatGaps.push(referenceBeats[i] - referenceBeats[i - 1])
  beatGaps.sort((a, b) => a - b)
  const medianBeatGap = beatGaps.length ? beatGaps[Math.floor(beatGaps.length / 2)] : null
  const measuredReferenceTempo = medianBeatGap ? 60 / medianBeatGap : null
  const downbeatGaps = []
  for (let i = 1; i < downbeats.length; i += 1) downbeatGaps.push(downbeats[i] - downbeats[i - 1])
  downbeatGaps.sort((a, b) => a - b)
  const medianDownbeatGap = downbeatGaps.length ? downbeatGaps[Math.floor(downbeatGaps.length / 2)] : null

  const wav = readWavPcm(track.wav)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  const bp = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: async () => bp.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude })),
  })

  const refPeriod = medianBeatGap
  const estimatedPeriod = analysis.beats.beatPeriodSeconds
  // Phase: offset from the estimated grid to the nearest reference beat.
  const phaseSample = referenceBeats.slice(1, 8).map((beat) => {
    const nearestEstimated = nearest(analysis.beats.beats, beat, 0.5)
    return nearestEstimated.value != null ? Number((nearestEstimated.value - beat).toFixed(4)) : null
  })
  const phaseValues = phaseSample.filter((v) => v != null)
  const phaseMean = phaseValues.length ? phaseValues.reduce((a, b) => a + b, 0) / phaseValues.length : null

  // Downbeat alignment: are estimated measure starts on reference downbeats?
  const downbeatHits = downbeats.slice(0, 8).filter((db) => {
    // An estimated barline is every `beatsPerMeasure` estimated beats.
    const beatsPerMeasure = analysis.meter?.beatsPerMeasure ?? 4
    return analysis.beats.beats.some((b, i) => i % beatsPerMeasure === 0 && Math.abs(b - db) < 0.25)
  }).length

  // Onset errors: reference onsets with no transcribed note within 120 ms.
  let onsetMissed = 0
  for (const onset of referenceOnsets) {
    const hit = analysis.predictedNotes.some((n) => Math.abs(n.startSeconds - onset) <= 0.12)
    if (!hit) onsetMissed += 1
  }

  // Quantization: transcribed onsets to the REFERENCE grid.
  const residuals = []
  for (const n of analysis.predictedNotes) {
    const near = nearest(referenceBeats, n.startSeconds)
    if (near.value == null) continue
    const beats = (n.startSeconds - near.value) / refPeriod
    residuals.push(Math.abs(beats - Math.round(beats)))
  }
  residuals.sort((a, b) => a - b)
  const residualMedian = residuals.length ? residuals[Math.floor(residuals.length / 2)] : null

  // Musical durations: mean note duration expressed in REFERENCE beats.
  const durationsBeats = analysis.predictedNotes.map((n) => (n.endSeconds - n.startSeconds) / refPeriod)
  const meanDurationBeats = durationsBeats.length ? durationsBeats.reduce((a, b) => a + b, 0) / durationsBeats.length : null

  const row = {
    id: track.id,
    // Reference verification
    referenceTempo,
    measuredReferenceTempo: measuredReferenceTempo != null ? Number(measuredReferenceTempo.toFixed(2)) : null,
    tempoAnnotationMatchesBeats: referenceTempo != null && measuredReferenceTempo != null
      ? Math.abs(referenceTempo - measuredReferenceTempo) <= 1.5
      : null,
    beatUnits, numBeats,
    referenceBeatCount: referenceBeats.length,
    referenceDownbeatCount: downbeats.length,
    medianDownbeatGap: medianDownbeatGap != null ? Number(medianDownbeatGap.toFixed(4)) : null,
    audioSeconds: Number((mono.length / 22050).toFixed(2)),
    // Estimation
    estimatedTempo: analysis.tempo.bpm,
    estimatedPeriod: Number(estimatedPeriod.toFixed(4)),
    ambiguousTempo: Boolean(analysis.tempo.ambiguousTempo),
    octaveAlternative: analysis.tempo.octaveAlternative ?? null,
    tempoErrorBpm: referenceTempo != null ? Number((analysis.tempo.bpm - referenceTempo).toFixed(2)) : null,
    ratio: ratioClass(analysis.tempo.bpm, referenceTempo),
    meter: { beatsPerMeasure: analysis.meter?.beatsPerMeasure ?? null, uncertain: analysis.meter?.uncertain ?? null },
    phaseMeanBeats: phaseMean != null ? Number((phaseMean / refPeriod).toFixed(4)) : null,
    downbeatHitsOf8: downbeatHits,
    onsetMissed,
    referenceOnsetCount: referenceOnsets.length,
    onsetMissRate: Number((onsetMissed / Math.max(1, referenceOnsets.length)).toFixed(3)),
    quantResidualMedian: residualMedian != null ? Number(residualMedian.toFixed(4)) : null,
    meanNoteDurationReferenceBeats: meanDurationBeats != null ? Number(meanDurationBeats.toFixed(3)) : null,
    transcribedNotes: analysis.predictedNotes.length,
  }
  rows.push(row)
  console.log(`${row.id}`)
  console.log(`  reference ${referenceTempo} BPM (measured from beats ${row.measuredReferenceTempo}, match=${row.tempoAnnotationMatchesBeats}) meter ${beatUnits} beats/bar=${numBeats}, ${referenceBeats.length} beats, ${downbeats.length} downbeats, bar ${row.medianDownbeatGap}s, audio ${row.audioSeconds}s`)
  console.log(`  estimated ${row.estimatedTempo} BPM (period ${row.estimatedPeriod}s vs ref ${refPeriod.toFixed(4)}s) err ${row.tempoErrorBpm} ratio ${row.ratio.ratio} class ${row.ratio.class} | ambiguous=${row.ambiguousTempo} alt=${row.octaveAlternative}`)
  console.log(`  phase ${row.phaseMeanBeats} beats | downbeat hits ${row.downbeatHitsOf8}/8 | onsets missed ${row.onsetMissed}/${row.referenceOnsetCount} | quant residual median ${row.quantResidualMedian} beats | mean duration ${row.meanNoteDurationReferenceBeats} ref-beats`)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

mkdirSync(join(root, 'benchmarks/audio-vision'), { recursive: true })
writeFileSync(join(root, jsonOut), JSON.stringify({ rows }, null, 2))
const lines = ['# Timing benchmark (frozen; JAMS beat/downbeat references)', '',
  '| recording | ref BPM | measured-from-beats | meter | est BPM | err | ratio | class | phase (beats) | downbeat hits | onsets missed | quant resid | mean dur (ref beats) |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
for (const r of rows) {
  lines.push(`| ${r.id} | ${r.referenceTempo} | ${r.measuredReferenceTempo} (match ${r.tempoAnnotationMatchesBeats}) | ${r.beatUnits}/${r.numBeats} | ${r.estimatedTempo} | ${r.tempoErrorBpm} | ${r.ratio.ratio} | ${r.ratio.class} | ${r.phaseMeanBeats} | ${r.downbeatHitsOf8}/8 | ${r.onsetMissed}/${r.referenceOnsetCount} | ${r.quantResidualMedian} | ${r.meanNoteDurationReferenceBeats} |`)
}
lines.push('', 'Reference verification notes: `measured-from-beats` recomputes tempo from the median annotated beat gap, so a mismatch means the tempo annotation does not describe the annotated beats.', '')
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('\nwrote', jsonOut)
