/**
 * M1/M2 — Reproduce and measure dangerous pipeline assumptions.
 *
 * (a) TEMPO CEILING: dsp.estimateTempoFromEnvelope clamps to 60..200 BPM.
 *     A recording at 240 BPM should still be measured as 240, not halved.
 * (b) SILENCE GATE: audioArrangementPipeline refuses RMS < 0.002. How quiet
 *     can a real recording be before we refuse it?
 * (c) MELODY BAND: dominantMelodyMidi only scans 180..1400 Hz, so a
 *     high-register melody (violin/flute above 1400 Hz) is invisible.
 * (d) FORMAT/GAIN INVARIANCE: gain, mono/stereo, 44.1k/48k and leading
 *     silence must not change the notes we extract.
 *
 * Usage: node --expose-gc scripts/audio-vision-assumption-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { magnitudeSpectrogram, spectralFlux, estimateTempoFromEnvelope } from '../src/features/audio-vision/dsp.js'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { resampleLinear, rmsLevel, importAudioFile } from '../src/features/audio-vision/audioImport.js'
import { readWavPcm } from './lib/readWavPcm.mjs'

const root = process.cwd()
const out = '/tmp/av-assumptions'
mkdirSync(out, { recursive: true })

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { maxBuffer: 1 << 26 })
}

async function analyze(fileOrImported) {
  const wav = fileOrImported?.samples ? fileOrImported : readWavPcm(fileOrImported)
  const mono = wav.samples
  const views = buildAnalysisViews(mono, 22050)
  const analysis = await analyzeMusic(mono, 22050, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: null,
  })
  return { analysis, mono, rms: rmsLevel(mono), sampleRate: 22050, channels: wav.channels ?? 1 }
}

function fingerprint(events) {
  return (events ?? [])
    .map((e) => `${Math.round(e.midi)}@${Math.round(e.startSeconds * 20) / 20}`)
    .sort()
    .join('|')
}

const report = {}
const base = '/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav'

// ---------- (a) TEMPO CEILING ----------
{
  const variants = [
    { id: 'original', rate: 1.0, filter: [] },
    { id: 'faster-1.2x (truth ~101 BPM)', rate: 1.0, filter: ['-af', 'atempo=1.2'] },
    { id: 'faster-2.4x (truth ~202 BPM)', rate: 1.0, filter: ['-af', 'atempo=2.4'] },
    { id: 'slower-0.5x (truth ~42 BPM)', rate: 1.0, filter: ['-af', 'atempo=0.5'] },
  ]
  const rows = []
  for (const v of variants) {
    const file = join(out, `tempo-${v.id.replace(/[^a-z0-9]+/gi, '-')}.wav`)
    if (v.filter.length) ffmpeg(['-i', base, ...v.filter, '-ar', '44100', file])
    else ffmpeg(['-i', base, '-ar', '44100', file])
    const { frames, frameSeconds } = magnitudeSpectrogram(resampleLinear(Float32Array.from(readWavPcm(file).samples), 44100, 22050), { sampleRate: 22050 })
    const flux = spectralFlux(frames)
    const est = estimateTempoFromEnvelope(flux, frameSeconds)
    rows.push({ variant: v.id, bpm: est.bpm, confidence: est.confidence, octaveAlternative: est.octaveAlternative })
    console.log(`TEMPO ${v.id}: ${est.bpm} BPM (conf ${est.confidence}, alt ${est.octaveAlternative})`)
  }
  report.tempo = rows
}

// ---------- (b) SILENCE GATE ----------
{
  const rows = []
  for (const db of [0, -20, -40, -50, -60]) {
    const file = join(out, `gain-${db}.wav`)
    ffmpeg(['-i', base, '-af', `volume=${db}dB`, '-ar', '44100', file])
    const bytes = readFileSync(file)
    const imported = await importAudioFile({ name: file, size: bytes.byteLength, type: 'audio/wav' }, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), async () => ({
      channelData: [Float32Array.from(readWavPcm(file).samples), Float32Array.from(readWavPcm(file).samples)],
      sampleRate: 44100,
      durationSeconds: 1,
      channelCount: 2,
    }))
    const rms = imported.ok ? imported.rms : rmsLevel(resampleLinear(Float32Array.from(readWavPcm(file).samples), 44100, 22050))
    const gate = !imported.ok ? 'import failed: ' + imported.code : (rms < 0.002 ? 'REFUSED by silence gate' : 'accepted')
    rows.push({ gainDb: db, rms: Number(rms.toFixed(6)), verdict: gate })
    console.log(`GAIN ${db} dB: post-import rms ${rms.toFixed(6)} -> ${gate}`)
  }
  report.gain = rows
}

// ---------- (c) MELODY BAND ----------
{
  // TRIOS violin stem: real high-register melodic content.
  const violin = '/tmp/trios/TRIOS Dataset/mozart/viola.wav'
  if (existsSync(violin)) {
    const notes = []
    const { mono } = analyze(violin)
    const { frames, fftSize } = magnitudeSpectrogram(mono, { sampleRate: 22050 })
    // Count frames whose strongest peak sits above 1400 Hz (invisible to the
    // current melody band).
    let above = 0
    let total = 0
    for (const spectrum of frames) {
      let best = 0
      let bestBin = -1
      for (let b = 1; b < spectrum.length; b += 1) {
        if (spectrum[b] > best) {
          best = spectrum[b]
          bestBin = b
        }
      }
      if (bestBin < 0 || best < 1e-7) continue
      total += 1
      const hz = (bestBin * 22050) / fftSize
      if (hz > 1400) above += 1
    }
    notes.push({ file: 'mozart/viola.wav', framesWithPeakAbove1400Hz: above, frames: total })
    console.log(`MELODY BAND viola: ${above}/${total} frames peak above 1400 Hz (invisible to dominantMelodyMidi)`)
    report.melodyBand = notes
  } else {
    report.melodyBand = [{ file: 'mozart/viola.wav', missing: true }]
  }
}

// ---------- (d) FORMAT/GAIN/CHANNEL/LEAD INVARIANCE ----------
{
  const variants = [
    { id: 'baseline-44k-stereo', args: ['-ar', '44100', '-ac', '2'] },
    { id: '48k-mono', args: ['-ar', '48000', '-ac', '1'] },
    { id: 'gain-6dB', args: ['-af', 'volume=6dB', '-ar', '44100', '-ac', '2'] },
    { id: 'leading-silence-3s', args: ['-af', 'adelay=3000|3000', '-ar', '44100', '-ac', '2'] },
    { id: 'mild-noise', args: [], mix: { anotherInput: 'anoisesrc=d=8:c=pink:a=0.015', filterComplex: '[0:a]volume=-12dB[n];[n][1:a]amix=inputs=2:duration=first:weights=1 0.6[out]', map: '[out]' } },
  ]
  const rows = []
  let baselineFp = null
  for (const v of variants) {
    const file = join(out, `inv-${v.id.replace(/[^a-z0-9]+/gi, '-')}.wav`)
    if (v.mix) {
      ffmpeg(['-i', base, '-f', 'lavfi', '-i', v.mix.anotherInput, '-filter_complex', v.mix.filterComplex, '-map', v.mix.map, '-ar', '44100', '-ac', '2', file])
    } else {
      ffmpeg(['-i', base, ...v.args, file])
    }
    const bytes = readFileSync(file)
    const imported = await importAudioFile({ name: file, size: bytes.byteLength, type: 'audio/wav' }, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), async () => {
      const raw = readWavPcm(file)
      return {
        channelData: raw.channels > 1 ? [Float32Array.from(raw.samples), Float32Array.from(raw.samples)] : [Float32Array.from(raw.samples)],
        sampleRate: raw.sampleRate,
        durationSeconds: raw.samples.length / raw.sampleRate,
        channelCount: raw.channels,
      }
    })
    if (!imported.ok) {
      rows.push({ variant: v.id, importFailed: imported.code })
      console.log(`INVARIANCE ${v.id}: IMPORT FAILED (${imported.code})`)
      continue
    }
    const analyzed = await analyze(imported)
    const analysis = analyzed.analysis
    if (!analysis?.predictedNotes) {
      rows.push({ variant: v.id, analysisFailed: true })
      console.log(`INVARIANCE ${v.id}: analysis produced no notes`)
      continue
    }
    const fp = fingerprint(analysis.predictedNotes)
    if (baselineFp === null) baselineFp = fp
    const same = fp === baselineFp
    rows.push({
      variant: v.id,
      sampleRate: imported.sampleRate,
      channels,
      rms: Number(imported.rms.toFixed(6)),
      notes: analysis.predictedNotes.length,
      tempo: analysis.tempo.bpm,
      identicalNotes: same,
      onsetDelta: analysis.onsets.length,
    })
    console.log(`INVARIANCE ${v.id}: ${analysis.predictedNotes.length} notes, tempo ${analysis.tempo.bpm}, identical-to-baseline=${same} (sr ${sampleRate}, ch ${channels})`)
  }
  report.invariance = rows
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log('\nwrote', join(out, 'report.json'))
