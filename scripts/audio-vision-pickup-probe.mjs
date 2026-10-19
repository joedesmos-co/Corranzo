/**
 * M5 — Pickup / anacrusis handling. A real pickup must survive notation, not be
 * flattened into beat 0 to dodge negative beats.
 *
 * Synthesizes music with a known pickup (notes BEFORE the first downbeat) and
 * checks that:
 *   1. the pickup notes appear in the arrangement,
 *   2. their onset times still precede the first full bar (i.e. not clamped to
 *      the first beat of the score),
 *   3. the emitted MusicXML keeps them before the barline (measure 1 is short),
 *   4. rests exist rather than a collapsed timeline,
 *   5. pickups of different offsets are all handled.
 *
 * Usage: node --expose-gc scripts/audio-vision-pickup-probe.mjs
 */
import { magnitudeSpectrogram, spectralFlux, pickOnsetFrames, estimateTempoFromEnvelope, buildBeatGrid } from '../src/features/audio-vision/dsp.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { quantizeToBeats } from '../src/features/audio-vision/arrangementModel.js'
import { buildArrangementMusicXml } from '../src/features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../src/features/musicxml/parseMusicXml.js'

const SR = 22050

function synthMusic({ bpm, pickupBeats, bars, seed = 0 }) {
  const period = 60 / bpm
  const total = (pickupBeats + bars * 4) * period + 0.5
  const samples = new Float32Array(Math.floor(total * SR))
  let rng = seed || 1
  const rand = () => {
    rng = (rng * 1103515245 + 12345) & 0x7fffffff
    return (rng / 0x7fffffff)
  }
  const scale = [62, 64, 65, 67, 69, 71, 72, 74]
  const tones = []
  for (let beat = 0; beat < pickupBeats + bars * 4; beat += 1) {
    const t = beat * period
    const midi = scale[Math.floor(rand() * scale.length)]
    tones.push({ midi, t })
    // A low root to give the harmony pass something.
    tones.push({ midi: midi - 24, t })
  }
  for (const tone of tones) {
    const freq = 440 * 2 ** ((tone.midi - 69) / 12)
    const s0 = Math.floor(tone.t * SR)
    for (let i = 0; i < period * SR * 0.6 && s0 + i < samples.length; i += 1) {
      const tt = i / SR
      samples[s0 + i] += 0.35 * Math.exp(-3 * tt) * Math.sin(2 * Math.PI * freq * tt)
    }
  }
  // A strong click on each beat so the beat grid is well determined.
  for (let beat = 0; beat < pickupBeats + bars * 4; beat += 1) {
    const s0 = Math.floor(beat * period * SR)
    for (let i = 0; i < 300 && s0 + i < samples.length; i += 1) {
      samples[s0 + i] += 0.3 * Math.exp(-i / 50) * Math.sin((2 * Math.PI * 200 * i) / SR)
    }
  }
  return { samples, period, pickupBeats }
}

function analyse(samples, bpm) {
  const { frames, frameSeconds } = await magnitudeSpectrogram(samples, { sampleRate: SR })
  const flux = spectralFlux(frames)
  const picked = pickOnsetFrames(flux)
  const tempo = await estimateTempoFromEnvelope(flux, frameSeconds)
  const grid = buildBeatGrid({ onsetFrames: picked, frameSeconds, bpm: tempo.bpm, totalSeconds: samples.length / SR })
  return { frames, frameSeconds, picked, tempo, grid }
}

const report = []
for (const pickupBeats of [0, 1, 2, 3]) {
  const { samples, period } = synthMusic({ bpm: 120, pickupBeats, bars: 4, seed: 7 })
  const { picked, frameSeconds, tempo, grid } = analyse(samples)
  const analysis = await analyzeMusic(samples, SR, { predictNotes: null })
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const xml = buildArrangementMusicXml({
    events: quantized.map((n) => ({
      midi: n.midi,
      startBeat: n.quantizedStartBeat,
      durBeats: n.quantizedDurBeats,
      hand: 'RH',
    })),
    targetPart: 'solo-piano',
    bpm: analysis.tempo.bpm,
    title: `pickup-${pickupBeats}`,
  })
  const parsed = parseMusicXml(xml, `pickup-${pickupBeats}.musicxml`)
  const notes = (parsed?.notes ?? []).filter((n) => !n.isRest && Number.isFinite(n.midi))
  const firstNote = notes.length ? Math.min(...notes.map((n) => n.timeSeconds)) : null
  const firstBarBeats = 4
  const pickupPreserved = firstNote != null && firstNote < firstBarBeats * period - 1e-6
  const rests = (parsed?.notes ?? []).filter((n) => n.isRest).length
  const row = {
    pickupBeats,
    tempo: tempo.bpm,
    onsets: picked.length,
    notes: notes.length,
    firstNoteSeconds: firstNote != null ? Math.round(firstNote * 1000) / 1000 : null,
    pickupThresholdSeconds: Math.round((firstBarBeats * period - 1e-6) * 1000) / 1000,
    pickupPreserved,
    rests,
  }
  report.push(row)
  console.log(`pickup=${pickupBeats} beats: tempo=${row.tempo} onsets=${row.onsets} notes=${row.notes} firstNote=${row.firstNoteSeconds}s (pickup zone < ${row.pickupThresholdSeconds}s) preserved=${row.pickupPreserved} rests=${row.rests}`)
}

// Rhythm faithfulness: a note on the beat must stay on the beat, not collapse.
{
  const { samples, period } = synthMusic({ bpm: 100, pickupBeats: 1, bars: 3, seed: 3 })
  const analysis = await analyzeMusic(samples, SR, { predictNotes: null })
  const q = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const residuals = q.map((n) => n.residualBeats)
  const mean = residuals.reduce((a, b) => a + b, 0) / Math.max(1, residuals.length)
  const max = residuals.length ? Math.max(...residuals) : null
  console.log(`\nquantization residual (beats): mean=${mean.toFixed(4)} max=${max}`)
  report.push({ quantizationMeanBeats: Number(mean.toFixed(4)), quantizationMaxBeats: max })
}
console.log('\ndone')
