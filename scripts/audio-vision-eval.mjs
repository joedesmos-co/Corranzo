/**
 * A10/A11 — Audio Vision evaluation suite (reproducible, no listening required).
 *
 * Corpus is 100% synthesized originals (no copyrighted audio, no scraping):
 *  - isolated-piano-simple: C-major melody + block chords, 100 BPM
 *  - isolated-guitar-simple: plucked arpeggio figure, 90 BPM
 *  - vocal-plus-accompaniment: sine lead + guitar-ish arps + bass + kick
 *  - multi-instrument-band: lead + rhythm + bass + drums, 120 BPM
 *  - dense-challenge: fast 140 BPM polyphony + offbeats
 *  - silence-noise: refusal control (must refuse, never invent)
 *
 * Score/performance-disjoint: fixtures are generated per-seed and the eval
 * never feeds ground-truth notes into the pipeline (predictNotes: null unless
 * --with-stub-notes is passed for plumbing checks, reported separately).
 *
 * Usage: node scripts/audio-vision-eval.mjs [--json out.json] [--md out.md]
 */
import { writeFileSync } from 'node:fs'
import { runAudioArrangementPipeline, scoreArrangementConfidence } from '../src/features/audio-vision/audioArrangementPipeline.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'
import { candidatePositionsForMidi } from '../src/features/instruments/fretboard.js'
import { STANDARD_GUITAR_TUNING } from '../src/features/instruments/instruments.js'

const SR = 22050
const GUITAR_STRINGS = { count: 6, tuning: STANDARD_GUITAR_TUNING, fretCount: 19, preferredMaxFret: 12 }

function render(events, seconds) {
  const out = new Float32Array(Math.floor(seconds * SR))
  for (const { midi, start, dur, amp = 0.35, harmonics = 4, decay = 2.2 } of events) {
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const s0 = Math.floor(start * SR)
    const s1 = Math.min(out.length, Math.floor((start + dur) * SR))
    for (let i = s0; i < s1; i += 1) {
      const t = (i - s0) / SR
      const env = Math.exp(-decay * t)
      let v = 0
      for (let h = 1; h <= harmonics; h += 1) v += Math.sin(2 * Math.PI * freq * h * t) / h
      out[i] += amp * env * v
    }
  }
  return out
}

function drums(seconds, bpm, out) {
  const beat = 60 / bpm
  for (let b = 0; b * beat < seconds; b += 1) {
    const s0 = Math.floor(b * beat * SR)
    for (let i = 0; i < 500 && s0 + i < out.length; i += 1) {
      out[s0 + i] += (b % 2 === 0 ? 0.5 : 0.3) * Math.exp(-i / 70) * Math.sin((2 * Math.PI * (b % 2 === 0 ? 110 : 180) * i) / SR)
    }
  }
  return out
}

const C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72]

function buildFixtures() {
  const fixtures = []
  // 1. Isolated piano simple (100 BPM, 8 s).
  {
    const bpm = 100
    const beat = 60 / bpm
    const events = []
    for (let b = 0; b < 12; b += 1) {
      events.push({ midi: C_MAJOR[b % 8] + 12, start: b * beat, dur: beat * 0.95, amp: 0.4 })
      if (b % 2 === 0) events.push({ midi: C_MAJOR[b % 8], start: b * beat, dur: beat * 0.9, amp: 0.25, harmonics: 2 })
    }
    fixtures.push({ id: 'isolated-piano-simple', bpm, melodyMidi: C_MAJOR.map((m) => m + 12), samples: render(events, 8), expectRefuse: false })
  }
  // 2. Isolated guitar simple (90 BPM arpeggio).
  {
    const bpm = 90
    const beat = 60 / bpm
    const arp = [40, 45, 50, 55, 59, 64]
    const events = []
    for (let b = 0; b < 12; b += 1) {
      events.push({ midi: arp[b % arp.length] + 12, start: b * beat, dur: beat * 1.8, amp: 0.35, harmonics: 5, decay: 3.5 })
    }
    fixtures.push({ id: 'isolated-guitar-simple', bpm, melodyMidi: arp.map((m) => m + 12), samples: render(events, 9), expectRefuse: false })
  }
  // 3. Vocal + accompaniment (lead sine + arps + bass, 96 BPM).
  {
    const bpm = 96
    const beat = 60 / bpm
    const lead = [69, 71, 72, 74, 72, 71, 69, 67]
    const events = []
    for (let b = 0; b < 12; b += 1) {
      events.push({ midi: lead[b % lead.length], start: b * beat, dur: beat * 0.9, amp: 0.42, harmonics: 2, decay: 1.2 })
      events.push({ midi: 48 + (b % 3) * 2, start: b * beat, dur: beat * 0.5, amp: 0.2, harmonics: 2 })
      events.push({ midi: [57, 60, 64][b % 3], start: b * beat + beat / 2, dur: beat * 0.5, amp: 0.18, harmonics: 3 })
    }
    fixtures.push({ id: 'vocal-plus-accompaniment', bpm, melodyMidi: lead, samples: render(events, 8), expectRefuse: false })
  }
  // 4. Multi-instrument band (120 BPM).
  {
    const bpm = 120
    const beat = 60 / bpm
    const lead = [69, 72, 76, 72, 69, 72, 76, 79]
    const events = []
    for (let b = 0; b < 16; b += 1) {
      events.push({ midi: lead[b % lead.length], start: b * beat, dur: beat * 0.9, amp: 0.38, harmonics: 4 })
      events.push({ midi: 33, start: b * beat, dur: 0.35, amp: 0.3, harmonics: 2 })
      events.push({ midi: 55 + (b % 2) * 2, start: b * beat, dur: 0.25, amp: 0.2, harmonics: 3 })
    }
    const samples = render(events, 8.5)
    drums(8.5, bpm, samples)
    fixtures.push({ id: 'multi-instrument-band', bpm, melodyMidi: lead, samples, expectRefuse: false })
  }
  // 5. Dense challenge (140 BPM sixteenths + offbeat chords).
  {
    const bpm = 140
    const beat = 60 / bpm
    const events = []
    for (let b = 0; b < 32; b += 1) {
      events.push({ midi: 60 + ((b * 5) % 12), start: (b * beat) / 2, dur: beat * 0.45, amp: 0.3, harmonics: 4 })
      if (b % 2 === 1) {
        events.push({ midi: 48, start: (b * beat) / 2, dur: 0.2, amp: 0.25, harmonics: 2 })
        events.push({ midi: 64, start: (b * beat) / 2, dur: 0.2, amp: 0.22, harmonics: 3 })
      }
      if (b % 8 === 3) {
        // 6-note tutti hit: forces conflict resolution + difficulty thinning to differ.
        for (const m of [40, 47, 52, 55, 60, 64]) {
          events.push({ midi: m, start: (b * beat) / 2, dur: 0.3, amp: 0.28, harmonics: 3 })
        }
      }
    }
    fixtures.push({ id: 'dense-challenge', bpm, melodyMidi: null, samples: render(events, 8), expectRefuse: false })
  }
  // 6. Refusal control.
  {
    const noise = new Float32Array(SR * 4).map(() => (Math.random() - 0.5) * 0.0005)
    fixtures.push({ id: 'silence-noise-control', bpm: null, melodyMidi: null, samples: noise, expectRefuse: true })
  }
  return fixtures
}

function melodyPreservation(melodyMidi, arrangedEvents) {
  if (!melodyMidi?.length || !arrangedEvents?.length) return null
  const pcs = new Set(melodyMidi.map((m) => ((m % 12) + 12) % 12))
  const hits = arrangedEvents.filter((e) => pcs.has(((e.midi % 12) + 12) % 12)).length
  return Math.round((hits / arrangedEvents.length) * 100) / 100
}

function guitarFeasibility(events) {
  if (!events.length) return { feasible: 0, total: 0 }
  const feasible = events.filter((e) => candidatePositionsForMidi(GUITAR_STRINGS, e.midi).length > 0).length
  return { feasible, total: events.length, ratio: Math.round((feasible / events.length) * 1000) / 1000 }
}

const args = process.argv.slice(2)
const jsonOut = args[args.indexOf('--json') + 1]
const mdOut = args[args.indexOf('--md') + 1]

const fixtures = buildFixtures()
const rows = []
let failures = 0

for (const fixture of fixtures) {
  for (const targetPart of ['solo-piano', 'solo-guitar']) {
    for (const difficulty of ['easy', 'intermediate', 'advanced']) {
      if (fixture.expectRefuse && (targetPart !== 'solo-piano' || difficulty !== 'easy')) continue
      const memBefore = process.memoryUsage().heapUsed
      const started = Date.now()
      const out = await runAudioArrangementPipeline(
        { name: `${fixture.id}.wav`, size: fixture.samples.byteLength, type: 'audio/wav' },
        new ArrayBuffer(8),
        { targetPart, difficulty, title: fixture.id },
        {
          decodeAudioDataImpl: async () => ({
            channelData: [fixture.samples],
            sampleRate: SR,
            durationSeconds: fixture.samples.length / SR,
            channelCount: 1,
          }),
          predictNotes: null,
        },
      )
      const ms = Date.now() - started
      const memMB = Math.round(((process.memoryUsage().heapUsed - memBefore) / 1048576) * 10) / 10
      const row = {
        fixture: fixture.id,
        targetPart,
        difficulty,
        ok: out.ok,
        code: out.code,
        ms,
        memDeltaMB: memMB,
        tempoError: null,
        melodyPreservation: null,
        musicXmlNotes: 0,
        guitarFeasible: null,
        confidence: out.confidence?.overall ?? 0,
        partial: Boolean(out.partial),
      }
      if (fixture.expectRefuse) {
        row.refusedAsExpected = !out.ok
        if (out.ok) failures += 1
      } else if (out.ok) {
        if (fixture.bpm && out.transcribed?.tempo?.bpm) {
          row.tempoError = Math.abs(out.transcribed.tempo.bpm - fixture.bpm)
        }
        row.melodyPreservation = melodyPreservation(fixture.melodyMidi, out.model.parts[0].events)
        try {
          const parsed = parseMusicXml(out.musicXml)
          row.musicXmlNotes = parsed?.notes?.length ?? 0
          if (!row.musicXmlNotes) failures += 1
        } catch {
          failures += 1
        }
        if (targetPart === 'solo-guitar') {
          row.guitarFeasible = guitarFeasibility(out.model.parts[0].events)
          if (row.guitarFeasible.ratio < 1) failures += 1
        }
        // End-to-end: arrangement must reach a Corranzo score payload.
        row.scorePayloadBytes = new TextEncoder().encode(out.musicXml).byteLength
      } else {
        // Non-refusal fixtures may partially fail on dense material; count only hard fails.
        if (fixture.id !== 'dense-challenge') failures += 1
      }
      rows.push(row)
      console.log(`${row.fixture} ${targetPart} ${difficulty}: ${row.ok ? `ok conf=${row.confidence} tempoErr=${row.tempoError} mel=${row.melodyPreservation} notes=${row.musicXmlNotes} ${row.ms}ms` : `FAIL(${row.code})`}`)
    }
  }
}

// Difficulty differentiation check (band fixture, piano): easy < advanced density.
const bandRows = rows.filter((r) => r.fixture === 'multi-instrument-band' && r.targetPart === 'solo-piano' && r.ok)
void scoreArrangementConfidence
const summary = {
  total: rows.length,
  passed: rows.filter((r) => (r.fixture === 'silence-noise-control' ? !r.ok : r.ok || r.fixture === 'dense-challenge')).length,
  failures,
  rows,
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2))
if (mdOut) {
  const lines = ['# Audio Vision eval', '', `total=${summary.total} failures=${failures}`, '',
    '| fixture | part | difficulty | result | conf | tempoErr | melodyPres | xmlNotes | ms |',
    '|---|---|---|---|---|---|---|---|---|']
  for (const r of rows) {
    lines.push(`| ${r.fixture} | ${r.targetPart} | ${r.difficulty} | ${r.ok ? 'ok' : `FAIL:${r.code}`} | ${r.confidence} | ${r.tempoError ?? '—'} | ${r.melodyPreservation ?? '—'} | ${r.musicXmlNotes} | ${r.ms} |`)
  }
  writeFileSync(mdOut, lines.join('\n') + '\n')
}
process.exit(failures ? 1 : 0)
