/**
 * DEV-only browser probe for Audio Vision end-to-end acceptance.
 * Imported only by scripts/browser-audio-vision-e2e.mjs via Vite dev transform
 * (so bare package specifiers resolve through pre-bundling). Never imported
 * by production code paths.
 */
import { BasicPitch, outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch'
import {
  loadNeuralRuntime,
  runNeuralWindow,
  checkNeuralCapability,
} from '../features/microphone-input/micNeuralTfAdapter.js'
import { mixToMono, resampleLinear, rmsLevel } from '../features/audio-vision/audioImport.js'
import { analyzeMusic } from '../features/audio-vision/musicAnalysis.js'
import { quantizeToBeats } from '../features/audio-vision/arrangementModel.js'
import { arrangeSoloGuitar } from '../features/audio-vision/soloGuitar.js'
import { buildArrangementMusicXml } from '../features/audio-vision/arrangementMusicXml.js'
import { parseMusicXml } from '../features/musicxml/parseMusicXml.js'

void BasicPitch
void outputToNotesPoly
void noteFramesToTime

export async function runBrowserProbe() {
  const out = { errors: [] }
  // 1. Original 4 s guitar-like figure (A2-C#4-E4 arpeggio @120 BPM + clicks).
  const SR = 44100
  const DUR = 4
  const ctx = new OfflineAudioContext(1, SR * DUR, SR)
  const beat = 0.5
  const seq = [57, 61, 64, 69, 64, 61]
  for (let b = 0; b < 8; b += 1) {
    const midi = seq[b % seq.length]
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    const gain = ctx.createGain()
    const t0 = b * beat
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(0.25, t0 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.5)
    const click = ctx.createOscillator()
    click.frequency.value = 150
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.3, t0)
    cg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05)
    click.connect(cg)
    cg.connect(ctx.destination)
    click.start(t0)
    click.stop(t0 + 0.06)
  }
  const rendered = await ctx.startRendering()
  out.renderedSeconds = rendered.duration
  out.renderedSampleRate = rendered.sampleRate

  // 2. Decode-equivalent: mono + resample to model rate.
  const mono = mixToMono([rendered.getChannelData(0)])
  out.rms = rmsLevel(mono)
  const atRate = resampleLinear(mono, SR, 22050)
  out.samples22050 = atRate.length

  // 3. Real in-browser Basic Pitch inference (browser TF.js backend).
  const t0 = performance.now()
  const capability = await checkNeuralCapability({ modelJsonUrl: '/neural-model/model.json' })
  out.capability = capability
  const runtime = await loadNeuralRuntime({ modelJsonUrl: '/neural-model/model.json' })
  const { BasicPitch: BP, outputToNotesPoly: toPoly, noteFramesToTime: toTime } = await import('@spotify/basic-pitch')
  void BP
  void toPoly
  void toTime
  const bpEvents = await runNeuralWindow(runtime, { outputToNotesPoly: toPoly, noteFramesToTime: toTime }, atRate)
  out.bpMs = Math.round(performance.now() - t0)
  out.backend = capability.backend
  out.bpNotes = bpEvents.map((e) => [e.midi, +e.startOffsetSeconds.toFixed(2), +e.endOffsetSeconds.toFixed(2)])

  // 4. Analysis + solo guitar arrangement + MusicXML in-page.
  const analysis = await analyzeMusic(atRate, 22050, {
    predictNotes: async () => bpEvents.map((e) => ({ midi: e.midi, startSeconds: e.startOffsetSeconds, endSeconds: e.endOffsetSeconds })),
  })
  out.tempoBpm = analysis.tempo.bpm
  out.pitchSource = analysis.pitchSource
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  const arranged = arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty: 'intermediate' })
  const xml = buildArrangementMusicXml({ events: arranged.events, targetPart: 'solo-guitar', bpm: analysis.tempo.bpm, title: 'Browser E2E' })
  out.arrangedNotes = arranged.events.length
  out.hasTab = xml.includes('<technical>')
  const parsed = parseMusicXml(xml, 'browser-e2e.musicxml')
  out.xmlNotes = parsed?.notes?.length ?? 0
  const truth = []
  for (let b = 0; b < 8; b += 1) truth.push({ midi: seq[b % seq.length], onset: b * beat })
  const beat0 = analysis.beats.beats[0] ?? 0
  const period = analysis.beats.beatPeriodSeconds
  let hit = 0
  for (const t of truth) {
    const sec = (n) => beat0 + n.startBeat * period
    if (arranged.events.some((n) => Math.abs(sec(n) - t.onset) <= 0.3 && (((n.midi - t.midi) % 12) + 12) % 12 === 0)) hit += 1
  }
  out.melodyRecallPc = Math.round((hit / truth.length) * 1000) / 1000
  return out
}
