/**
 * A2 — Reference-free acceptance for mixed recordings without truth.
 *
 * Reports structural evidence (NOT grades): coverage, melody continuity,
 * density plausibility, section/texture agreement, BP-vs-spectral agreement,
 * bass movement, stereo evidence. For the CC BY-NC ccMixter mix and the
 * public-domain Chopin excerpt. Limitations are reported, never graded over.
 *
 * Usage: node --expose-gc scripts/audio-vision-mix-acceptance.mjs [--json p] [--md p]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const jsonOut = argValue('--json', 'benchmarks/audio-vision/mix-acceptance.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/mix-acceptance.md')

const ENTRIES = [
  {
    id: 'bag-of-motifs',
    audio: '/tmp/realcorpus/bag-of-motifs-excerpt.wav',
    license: 'CC BY-NC (local eval only)',
    stereo: true,
  },
  {
    id: 'chopin-noct19-faulkner',
    audio: '/tmp/realcorpus/chopin-noct19-faulkner-excerpt.wav',
    license: 'Public domain (recording)',
    stereo: false,
  },
]

function pcSet(midis) {
  return new Set(midis.map((m) => ((m % 12) + 12) % 12))
}

function acceptanceMetrics(out, bpNotes, specNotes) {
  const events = out.ok ? out.model.parts[0].events : []
  const beatPeriod = out.ok ? out.transcribed.beatPeriodSeconds : 0.5
  const t0 = out.ok ? (out.transcribed.beats[0] ?? 0) : 0
  const total = out.ok ? out.transcribed.totalSeconds : 0
  const evSec = events.map((e) => ({ ...e, sec: t0 + e.startBeat * beatPeriod }))
  // Coverage: fraction of 2 s windows with >=1 arranged note.
  let covered = 0
  let windows = 0
  for (let w = 0; w < total; w += 2) {
    windows += 1
    if (evSec.some((e) => e.sec >= w && e.sec < w + 2)) covered += 1
  }
  // Melody continuity: longest gap without a melody-role note.
  const melTimes = evSec.filter((e) => e.role === 'melody').map((e) => e.sec).sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < melTimes.length; i += 1) maxGap = Math.max(maxGap, melTimes[i] - melTimes[i - 1])
  // Density plausibility.
  const beats = total / Math.max(0.2, beatPeriod)
  const notesPerBeat = events.length / Math.max(1, beats)
  // Section/texture agreement: do textures change at section boundaries?
  const sections = out.ok ? out.transcribed.sections ?? [] : []
  const textures = new Set(events.map((e) => e.texture))
  // BP-vs-spectral agreement per 2 s region (pitch-class overlap F1).
  let agreeSum = 0
  let agreeN = 0
  for (let w = 0; w < total; w += 2) {
    const b = pcSet(bpNotes.filter((n) => n.startSeconds >= w && n.startSeconds < w + 2).map((n) => n.midi))
    const s = pcSet(specNotes.filter((n) => n.startSeconds >= w && n.startSeconds < w + 2).map((n) => n.midi))
    if (!b.size && !s.size) continue
    const inter = [...b].filter((p) => s.has(p)).length
    const prec = s.size ? inter / s.size : 1
    const rec = b.size ? inter / b.size : 1
    agreeSum += prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0
    agreeN += 1
  }
  // Bass movement: distinct bass pitch classes per quarter.
  const bass = out.ok ? out.transcribed.bassLine ?? [] : []
  const quarters = Math.ceil(total / 4)
  const bassPcs = new Set(bass.map((b) => ((b.midi % 12) + 12) % 12))
  return {
    windows,
    coverage: windows ? Math.round((covered / windows) * 1000) / 1000 : 0,
    melodyMaxGapSeconds: Math.round(maxGap * 100) / 100,
    melodyNotes: melTimes.length,
    notesPerBeat: Math.round(notesPerBeat * 100) / 100,
    denseFlag: notesPerBeat > 6,
    sections: sections.length,
    textures: [...textures],
    bpSpectralAgreementF1: agreeN ? Math.round((agreeSum / agreeN) * 1000) / 1000 : null,
    bassDistinctPcs: bassPcs.size,
    staticBassFlag: quarters >= 3 && bassPcs.size <= 1,
  }
}

const report = { entries: [], generatedAt: new Date().toISOString() }
for (const entry of ENTRIES) {
  console.log(`--- ${entry.id}`)
  const wav = readWavPcm(entry.audio, { discreteChannels: entry.stereo })
  const sr = wav.sampleRate
  const mono = resampleLinear(Float32Array.from(wav.samples), sr, 22050)
  const channels = wav.discrete
    ? wav.discrete.map((ch) => resampleLinear(ch, sr, 22050))
    : [mono]
  const bpOut = await predictBasicPitchNode(mono, { modelDir: join(root, 'public/neural-model') })
  const bpNotes = bpOut.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds }))
  const decodeStub = async () => ({ channelData: channels, sampleRate: sr, durationSeconds: channels[0].length / sr, channelCount: channels.length })
  const row = { id: entry.id, license: entry.license, channels: channels.length }
  for (const targetPart of ['solo-guitar', 'solo-piano']) {
    const out = await runAudioArrangementPipeline(
      { name: `${entry.id}.wav`, size: mono.byteLength, type: 'audio/wav' },
      new ArrayBuffer(8),
      { targetPart, difficulty: 'intermediate', title: entry.id },
      { decodeAudioDataImpl: decodeStub, predictNotes: async () => bpNotes },
    )
    // Spectral twin for agreement (no model).
    const spec = await runAudioArrangementPipeline(
      { name: `${entry.id}.wav`, size: mono.byteLength, type: 'audio/wav' },
      new ArrayBuffer(8),
      { targetPart, difficulty: 'intermediate', title: entry.id },
      { decodeAudioDataImpl: decodeStub, predictNotes: null },
    )
    const specNotes = spec.ok
      ? spec.transcribed.predictedNotes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds }))
      : []
    const metrics = out.ok ? acceptanceMetrics(out, bpNotes, specNotes) : null
    row[targetPart] = {
      ok: out.ok,
      code: out.code,
      confidence: out.confidence?.overall ?? 0,
      confidenceParts: out.confidence?.parts ?? null,
      notes: out.ok ? out.model.parts[0].events.length : 0,
      warnings: out.ok ? out.model.parts[0].warnings?.length ?? 0 : 0,
      stereo: out.ok ? out.analysis.stereo : null,
      analysisSignal: out.ok ? (out.analysis.analysisSignal ?? 'mix') : null,
      tempoBpm: out.ok ? out.transcribed.tempo.bpm : null,
      tempoVaries: out.ok ? out.transcribed.tempo.varies : null,
      metrics,
    }
    console.log(`  ${targetPart}: ${out.ok ? `ok conf=${row[targetPart].confidence} cov=${metrics.coverage} gap=${metrics.melodyMaxGapSeconds}s npb=${metrics.notesPerBeat} agree=${metrics.bpSpectralAgreementF1} stereo=${JSON.stringify(row[targetPart].stereo)}` : `FAIL(${out.code})`}`)
  }
  report.entries.push(row)
  if (global.gc) global.gc()
}
await closeBasicPitchNode()

writeFileSync(join(root, jsonOut), JSON.stringify(report, null, 2))
const lines = ['# Reference-free mix acceptance (structural evidence, NOT grades)', '',
  `generated ${report.generatedAt}`, '',
  '| recording | part | conf | coverage | melodyGap | notes/beat | BP/SPEC agree | stereo |', '|---|---|---|---|---|---|---|---|']
for (const e of report.entries) {
  for (const part of ['solo-guitar', 'solo-piano']) {
    const r = e[part]
    lines.push(`| ${e.id} | ${part} | ${r.confidence} | ${r.metrics?.coverage ?? '—'} | ${r.metrics?.melodyMaxGapSeconds ?? '—'} | ${r.metrics?.notesPerBeat ?? '—'} | ${r.metrics?.bpSpectralAgreementF1 ?? '—'} | ${r.stereo ? JSON.stringify(r.stereo) : 'mono'} |`)
  }
}
writeFileSync(join(root, mdOut), lines.join('\n') + '\n')
console.log('done')
