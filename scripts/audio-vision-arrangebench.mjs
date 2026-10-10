/**
 * Arrangement-grade benchmark: full pipeline (audio → analysis → arrangement
 * → MusicXML) on real recordings, with truth-scored melody preservation.
 *
 * Input: JSON manifest [{ id, audio, truthNotes?, license, attribution, excerpt? }]
 * truthNotes: [{ midi, onset }] (JAMS-derived or manifest truth).
 * Runs each file with REAL Basic Pitch notes AND spectral fallback, both
 * targets (solo-piano, solo-guitar), all difficulties (easyuiest+advanced sampled).
 *
 * Metrics: melody recall (strict ±0.25 s + pitch-class variant), confidence,
 * playability (guitar feasibility/span/simultaneous; piano hands/span/melody-RH),
 * MusicXML validity, processing time.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { runAudioArrangementPipeline } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { candidatePositionsForMidi } from '../src/features/instruments/fretboard.js'
import { STANDARD_GUITAR_TUNING } from '../src/features/instruments/instruments.js'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { predictBasicPitchNode, closeBasicPitchNode } from './lib/basicPitchNode.mjs'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'

const args = process.argv.slice(2)
function argValue(flag, fallback = null) {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback
}
const manifestPath = argValue('--manifest')
const jsonOut = argValue('--json', 'benchmarks/audio-vision/arrangebench.json')
const mdOut = argValue('--md', 'benchmarks/audio-vision/arrangebench.md')
if (!manifestPath) {
  console.error('usage: audio-vision-arrangebench.mjs --manifest <json>')
  process.exit(2)
}
const modelDir = argValue('--model-dir', 'public/neural-model')
const onlyFilter = argValue('--only', null)

const GSTR = { count: 6, tuning: STANDARD_GUITAR_TUNING, fretCount: 19, preferredMaxFret: 12 }
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function melodyRecall(truth, events, { pitchClass = false, tol = 0.25 } = {}) {
  if (!truth?.length || !events?.length) return null
  // Truth melody: highest pitch active at each distinct onset cluster.
  const sorted = [...truth].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const t of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(t.onset - last.onset) < 0.06) {
      if (t.midi > last.midi) last.midi = t.midi
    } else {
      anchors.push({ onset: t.onset, midi: t.midi })
    }
  }
  let hit = 0
  for (const a of anchors) {
    // Map onset seconds → beats is unknown here; events carry startBeat.
    // Caller passes beatPeriod; convert event beats → seconds via analysis tempo.
    hit += 0 // placeholder replaced below
  }
  return { anchors: anchors.length, hit: 0 }
}

async function runOne(entry, predictNotes) {
  const wav = readWavPcm(entry.audio)
  const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
  let bpNotes = null
  let bpMs = 0
  if (predictNotes === 'basic-pitch') {
    const t0 = Date.now()
    const out = await predictBasicPitchNode(mono, { modelDir })
    bpNotes = out.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds }))
    bpMs = Date.now() - t0
  }
  const results = {}
  for (const targetPart of ['solo-piano', 'solo-guitar']) {
    for (const difficulty of (entry.difficulties ?? ['easy', 'advanced'])) {
      const t0 = Date.now()
      const out = await runAudioArrangementPipeline(
        { name: `${entry.id}.wav`, size: mono.byteLength, type: 'audio/wav' },
        new ArrayBuffer(8),
        { targetPart, difficulty, title: entry.id },
        {
          decodeAudioDataImpl: async () => ({
            channelData: [mono], sampleRate: 22050,
            durationSeconds: mono.length / 22050, channelCount: 1,
          }),
          predictNotes: predictNotes === 'basic-pitch' ? (async () => bpNotes) : null,
        },
      )
      results[`${targetPart}/${difficulty}`] = {
        ok: out.ok,
        code: out.code,
        ms: Date.now() - t0,
        bpMs: predictNotes === 'basic-pitch' ? bpMs : 0,
        ...(out.ok ? describeArrangement(out, entry) : { confidence: out.confidence?.overall ?? 0 }),
      }
    }
  }
  return results
}

function describeArrangement(out, entry) {
  const events = out.model.parts[0].events
  const beatPeriod = out.transcribed.beatPeriodSeconds
  const t0beat = out.transcribed.beats[0] ?? 0
  const evSec = events.map((e) => ({ ...e, sec: t0beat + e.startBeat * beatPeriod }))
  const desc = {
    confidence: out.confidence.overall,
    partial: out.partial,
    notes: events.length,
    tempoBpm: out.transcribed.tempo.bpm,
    pitchSource: out.transcribed.pitchSource,
    warnings: out.model.parts[0].warnings?.length ?? 0,
    xmlValid: false,
    xmlNotes: 0,
  }
  try {
    const parsed = parseMusicXml(out.musicXml)
    desc.xmlValid = true
    desc.xmlNotes = parsed?.notes?.length ?? 0
  } catch { /* stays invalid */ }
  if (entry.truthNotes?.length) {
    const anchors = melodyAnchors(entry.truthNotes)
    let strict = 0
    let pc = 0
    for (const a of anchors) {
      const near = evSec.filter((e) => Math.abs(e.sec - a.onset) <= 0.25)
      if (near.some((e) => e.midi === a.midi)) strict += 1
      if (near.some((e) => ((e.midi - a.midi) % 12 + 12) % 12 === 0)) pc += 1
    }
    desc.melodyAnchors = anchors.length
    desc.melodyRecallStrict = anchors.length ? Math.round((strict / anchors.length) * 1000) / 1000 : null
    desc.melodyRecallPc = anchors.length ? Math.round((pc / anchors.length) * 1000) / 1000 : null
    // Region pitch-class F1: drift- and pre-roll-robust musical overlap.
    // Splits the clip into 0.5 s regions; compares sounding pitch-class sets.
    const offsets = entry.truthOffsets ?? null
    if (offsets) {
      const end = Math.max(...offsets.map((o) => o.offset), ...evSec.map((e) => e.sec))
      let f1sum = 0
      let regions = 0
      for (let rs = 0; rs < end; rs += 0.5) {
        const re = rs + 0.5
        const tSet = new Set()
        offsets.forEach((o, i) => {
          const n = entry.truthNotes[i]
          if (n.onset <= re && o.offset >= rs) tSet.add(((n.midi % 12) + 12) % 12)
        })
        const aSet = new Set(evSec.filter((e) => e.sec >= rs - 0.05 && e.sec < re + 0.3).map((e) => ((e.midi % 12) + 12) % 12))
        if (!tSet.size && !aSet.size) continue
        const inter = [...tSet].filter((p) => aSet.has(p)).length
        const prec = aSet.size ? inter / aSet.size : 1
        const rec = tSet.size ? inter / tSet.size : 1
        f1sum += prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0
        regions += 1
      }
      desc.regionPcF1 = regions ? Math.round((f1sum / regions) * 1000) / 1000 : null
      desc.regionCount = regions
    }
  }
  if (Number.isFinite(entry.truthTempo)) {
    desc.tempoError = Math.abs(out.transcribed.tempo.bpm - entry.truthTempo)
    desc.truthTempo = entry.truthTempo
  }
  if (entry.truthChords?.length) {
    const analyzed = out.transcribed.chords ?? []
    let rootHit = 0
    let fullHit = 0
    for (const tc of entry.truthChords) {
      const overlap = analyzed.filter((c) => c.startSeconds < tc.endSeconds && c.endSeconds > tc.startSeconds)
      if (overlap.some((c) => c.root === tc.root)) rootHit += 1
      if (overlap.some((c) => c.root === tc.root && c.quality === tc.quality)) fullHit += 1
    }
    desc.chordSpans = entry.truthChords.length
    desc.chordRootAccuracy = Math.round((rootHit / entry.truthChords.length) * 1000) / 1000
    desc.chordFullAccuracy = Math.round((fullHit / entry.truthChords.length) * 1000) / 1000
  }
  if (out.model.targetPart === 'solo-guitar') {
    const feas = events.filter((e) => candidatePositionsForMidi(GSTR, e.midi).length > 0).length
    const byOnset = new Map()
    for (const e of events) {
      const k = Math.round(e.startBeat * 4)
      byOnset.set(k, [...(byOnset.get(k) ?? []), e])
    }
    const simMax = byOnset.size ? Math.max(...[...byOnset.values()].map((g) => g.length)) : 0
    const frets = events.map((e) => e.fret ?? 0).filter((f) => f > 0)
    desc.guitar = {
      feasibleRatio: events.length ? Math.round((feas / events.length) * 1000) / 1000 : 0,
      simultaneousMax: simMax,
      fretSpanMax: frets.length > 1 ? Math.max(...frets) - Math.min(...frets) : 0,
      tabNotes: events.filter((e) => e.string != null).length,
    }
  } else {
    const rh = events.filter((e) => e.hand === 'RH')
    const lh = events.filter((e) => e.hand === 'LH')
    const melRh = events.filter((e) => e.role === 'melody' && e.hand === 'RH').length
    const mel = events.filter((e) => e.role === 'melody').length
    const span = (list) => {
      const byOn = new Map()
      for (const e of list) {
        const k = Math.round(e.startBeat * 4)
        byOn.set(k, [...(byOn.get(k) ?? []), e.midi])
      }
      let mx = 0
      for (const g of byOn.values()) if (g.length > 1) mx = Math.max(mx, Math.max(...g) - Math.min(...g))
      return mx
    }
    desc.piano = {
      rh: rh.length, lh: lh.length,
      melodyInRhRatio: mel ? Math.round((melRh / mel) * 1000) / 1000 : null,
      spanMaxSemitones: Math.max(span(rh), span(lh)),
    }
  }
  return desc
}

function melodyAnchors(truth) {
  const sorted = [...truth].sort((a, b) => a.onset - b.onset)
  const anchors = []
  for (const t of sorted) {
    const last = anchors[anchors.length - 1]
    if (last && Math.abs(t.onset - last.onset) < 0.06) {
      if (t.midi > last.midi) last.midi = t.midi
    } else {
      anchors.push({ onset: t.onset, midi: t.midi })
    }
  }
  return anchors
}

void melodyRecall

const report = { entries: [], generatedAt: new Date().toISOString() }
for (const entry of manifest.entries ?? manifest) {
  if (onlyFilter && !entry.id.includes(onlyFilter)) continue
  console.log(`--- ${entry.id} (${entry.license})`)
  for (const pitch of ['basic-pitch', 'spectral']) {
    const res = await runOne(entry, pitch)
    for (const [k, v] of Object.entries(res)) {
      console.log(`  ${pitch} ${k}: ${v.ok ? `ok conf=${v.confidence} melStrict=${v.melodyRecallStrict ?? '—'} melPc=${v.melodyRecallPc ?? '—'} regionF1=${v.regionPcF1 ?? '—'} tempoErr=${v.tempoError ?? '—'} chordRoot=${v.chordRootAccuracy ?? '—'} xml=${v.xmlNotes}` : `FAIL(${v.code})`}`)
      report.entries.push({ id: entry.id, pitch, config: k, license: entry.license, ...v })
    }
  }
}
await closeBasicPitchNode()
writeFileSync(jsonOut, JSON.stringify(report, null, 2))
const lines = ['# Arrangement-grade benchmark (real recordings)', '', `generated ${report.generatedAt}`, '',
  '| recording | pitch | config | result | conf | melStrict | melPc | xmlNotes | ms |', '|---|---|---|---|---|---|---|---|---|']
for (const e of report.entries) {
  lines.push(`| ${e.id} | ${e.pitch} | ${e.config} | ${e.ok ? 'ok' : `FAIL:${e.code}`} | ${e.confidence ?? '—'} | ${e.melodyRecallStrict ?? '—'} | ${e.melodyRecallPc ?? '—'} | ${e.xmlNotes ?? 0} | ${e.ms} |`)
}
writeFileSync(mdOut, lines.join('\n') + '\n')
const fails = report.entries.filter((e) => !e.ok && e.code !== 'low-confidence' && e.code !== 'empty-audio').length
console.log(`hard failures: ${fails}`)
process.exit(0)
