import { predictBasicPitchNode, closeBasicPitchNode } from '../scripts/lib/basicPitchNode.mjs'
import { readWavPcm } from '../scripts/lib/readWavPcm.mjs'
import { analyzeMusic } from '../src/features/audio-vision/musicAnalysis.js'
import { buildAnalysisViews } from '../src/features/audio-vision/sourceSeparation.js'
import { quantizeToBeats, buildMelodyContour } from '../src/features/audio-vision/arrangementModel.js'
import { arrangeSoloGuitar } from '../src/features/audio-vision/soloGuitar.js'
import { simplifyForDifficulty } from '../src/features/audio-vision/difficulty.js'
import { resampleLinear } from '../src/features/audio-vision/audioImport.js'
import { readFileSync } from 'node:fs'

const truth = JSON.parse(readFileSync('/tmp/guitarset/jams/00_SS3-84-Bb_comp.jams', 'utf8'))
const truthNotes = []
for (const a of truth.annotations) {
  if (a.namespace !== 'note_midi') continue
  for (const d of a.data) truthNotes.push({ midi: Math.round(d.value), onset: d.time, offset: d.time + (d.duration || 0.3) })
}
const anchors = []
for (const t of [...truthNotes].sort((x, y) => x.onset - y.onset)) {
  const l = anchors[anchors.length - 1]
  if (l && Math.abs(t.onset - l.onset) < 0.06) { if (t.midi > l.midi) l.midi = t.midi }
  else anchors.push({ onset: t.onset, midi: t.midi })
}
const wav = readWavPcm('/tmp/guitarset/00_SS3-84-Bb_comp_mic.wav')
const mono = resampleLinear(Float32Array.from(wav.samples), wav.sampleRate, 22050)
const out = await predictBasicPitchNode(mono, { modelDir: 'public/neural-model' })
const views = buildAnalysisViews(mono, 22050)
const a = await analyzeMusic(mono, 22050, {
  views: { harmonic: views.harmonic, percussive: views.percussive },
  predictNotes: async () => out.notes.map((n) => ({ midi: n.midi, startSeconds: n.startSeconds, endSeconds: n.endSeconds, amplitude: n.amplitude })),
})
const beat0 = a.beats.beats[0] ?? 0
const period = a.beats.beatPeriodSeconds
const contour = buildMelodyContour(a.melody, { beat0, beatPeriod: period })
const q = quantizeToBeats(a.predictedNotes, a.beats.beats)
const { events } = arrangeSoloGuitar({ quantizedNotes: q, chords: a.chords, difficulty: 'advanced', melodyContour: contour })
const simplified = simplifyForDifficulty(events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })), 'advanced')
  .map((e) => ({ ...e, startBeat: e.quantizedStartBeat, durBeats: e.quantizedDurBeats }))
const sec = (e) => beat0 + e.startBeat * period
function recall(list) {
  let hit = 0
  for (const an of anchors) if (list.some((e) => Math.abs(sec(e) - an.onset) <= 0.25 && (((e.midi - an.midi) % 12) + 12) % 12 === 0)) hit += 1
  return (hit / anchors.length).toFixed(3)
}
console.log('S1 model notes :', recall(a.predictedNotes.map((n) => ({ midi: n.midi, startBeat: 0 }))))
console.log('S3 arrange     :', recall(events))
console.log('S4 simplified  :', recall(simplified))
console.log('notes-chroma windows:', a.chords.filter((c) => c.chromaSource === 'notes').length, '/', a.chords.length)
await closeBasicPitchNode()
process.exit(0)
