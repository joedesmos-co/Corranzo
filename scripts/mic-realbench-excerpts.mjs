#!/usr/bin/env node
/**
 * Real-audio excerpt builder — cuts 3 s benchmark clips with independent
 * annotation truth (JAMS per-string notes / MIDI notes; never detector
 * output) into benchmarks/mic-real/.
 *
 * Sources (all CC-BY-4.0, attributed in the manifest):
 *   GuitarSet      acoustic guitar mic, JAMS per-string truth
 *   EGSet12        electric amp-mic performances, JAMS per-string truth
 *   Guitar-Techs   electric amp-mic isolated notes, MIDI truth
 *   Vienna 4x22    Bösendorfer grand, MIDI truth
 *
 * Usage:
 *   node scripts/mic-realbench-excerpts.mjs [--write]
 * Without --write: dry run (selection + validation only).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readWavPcm } from './lib/readWavPcm.mjs'
import { writeWavPcm } from './lib/writeWavPcm.mjs'
import { clusterOnsets, loadJamsNotes, loadMidiNotes } from './mic-realbench-survey.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NORM = '/tmp/corranzo-realbench/norm'
const OUT_DIR = join(ROOT, 'benchmarks', 'mic-real', 'clips')
const EXCERPT_SECONDS = 3
const PRE_ROLL_SECONDS = 0.5

const ATTRIBUTION = {
  'guitarset': 'GuitarSet (Xi, Bittner, Pauwels, Mishra, Dixon, Benetos), Zenodo record 3371780, CC-BY-4.0',
  'egset12': 'EGSet12 (DAFx 2024), Zenodo record 11406378, CC-BY-4.0',
  'guitar-techs': 'Guitar-TECHS (Pedroza et al., ICASSP 2025), Zenodo record 14963133, CC-BY-4.0',
  'vienna-4x22': 'The Vienna 4x22 Piano Corpus (Goebl, Univ. of Music and Performing Arts Vienna), DOI 10.21939/4X22, CC-BY-4.0',
}

/**
 * Selections: { id, instrument, category, dataset, audioFile, jamsOrMidi,
 * kind: 'jams'|'midi', onset } — onset = anchor chord/single-note attack.
 */
/**
 * Selections: { id, instrument, category, dataset, audioFile, truthFile,
 * kind: 'jams'|'midi', onset, split: 'dev'|'eval', performance }.
 *
 * Split discipline (Stage 4 P5): NEVER split clips from one performance
 * across dev/eval. Dev tunes; eval only reports. Same room/mic across
 * Vienna takes is disclosed, not hidden.
 */
const SELECTIONS = [
  // ---- piano (Vienna 4x22) — dev: Mozart p01; eval: Schubert p01 + p02 takes ----
  { id: 'piano-mozart-single', instrument: 'piano', category: 'single', dataset: 'vienna-4x22', audioFile: 'vn_Mozart_K331_1st-mov_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Mozart_K331_1st-mov_p01.mid', kind: 'midi', onset: 12.32, split: 'dev', performance: 'vienna-mozart-p01' },
  { id: 'piano-mozart-dyad', instrument: 'piano', category: 'dyad', dataset: 'vienna-4x22', audioFile: 'vn_Mozart_K331_1st-mov_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Mozart_K331_1st-mov_p01.mid', kind: 'midi', onset: 3.57, split: 'dev', performance: 'vienna-mozart-p01' },
  { id: 'piano-mozart-triad', instrument: 'piano', category: 'triad', dataset: 'vienna-4x22', audioFile: 'vn_Mozart_K331_1st-mov_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Mozart_K331_1st-mov_p01.mid', kind: 'midi', onset: 2.91, split: 'dev', performance: 'vienna-mozart-p01' },
  { id: 'piano-mozart-dense', instrument: 'piano', category: 'dense', dataset: 'vienna-4x22', audioFile: 'vn_Mozart_K331_1st-mov_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Mozart_K331_1st-mov_p01.mid', kind: 'midi', onset: 22.02, split: 'dev', performance: 'vienna-mozart-p01' },
  { id: 'piano-schubert-single', instrument: 'piano', category: 'single', dataset: 'vienna-4x22', audioFile: 'vn_Schubert_D783_no15_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Schubert_D783_no15_p01.mid', kind: 'midi', onset: 3.95, split: 'eval', performance: 'vienna-schubert-p01' },
  { id: 'piano-schubert-triad', instrument: 'piano', category: 'triad', dataset: 'vienna-4x22', audioFile: 'vn_Schubert_D783_no15_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Schubert_D783_no15_p01.mid', kind: 'midi', onset: 5.55, split: 'eval', performance: 'vienna-schubert-p01' },
  { id: 'piano-schubert-dense', instrument: 'piano', category: 'dense', dataset: 'vienna-4x22', audioFile: 'vn_Schubert_D783_no15_p01.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Schubert_D783_no15_p01.mid', kind: 'midi', onset: 4.85, split: 'eval', performance: 'vienna-schubert-p01' },
  { id: 'piano-mozart2-triad', instrument: 'piano', category: 'triad', dataset: 'vienna-4x22', audioFile: 'norm2_vn_mozart_p02.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Mozart_K331_1st-mov_p02.mid', kind: 'midi', onset: 4.73, split: 'eval', performance: 'vienna-mozart-p02' },
  // piano-mozart2-dense EXCLUDED 2026-10-08: independently verified
  // annotation error (forte MIDI chord at 23.04 over near-silent audio;
  // see manifest.excluded). Do not re-add without re-verification.
  { id: 'piano-schubert2-single', instrument: 'piano', category: 'single', dataset: 'vienna-4x22', audioFile: 'norm2_vn_schubert_p02.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Schubert_D783_no15_p02.mid', kind: 'midi', onset: 2.51, split: 'eval', performance: 'vienna-schubert-p02' },
  { id: 'piano-schubert2-triad', instrument: 'piano', category: 'triad', dataset: 'vienna-4x22', audioFile: 'norm2_vn_schubert_p02.wav', truthFile: '/tmp/corranzo-realbench/vienna/midi/Schubert_D783_no15_p02.mid', kind: 'midi', onset: 4.25, split: 'eval', performance: 'vienna-schubert-p02' },
  // ---- acoustic guitar (GuitarSet mic) — dev: gs00/gs02/gs03*; eval: gs01/gs04 ----
  { id: 'acoustic-jazz-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_04_Jazz2-110-Bb_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/04_Jazz2-110-Bb_solo.jams', kind: 'jams', onset: 1.84, split: 'eval', performance: 'gs04-jazz' },
  { id: 'acoustic-jazz-dyad', instrument: 'acoustic-guitar', category: 'dyad', dataset: 'guitarset', audioFile: 'gs_04_Jazz2-110-Bb_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/04_Jazz2-110-Bb_solo.jams', kind: 'jams', onset: 4.66, split: 'eval', performance: 'gs04-jazz' },
  { id: 'acoustic-bossa-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_00_BN3-119-G_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/00_BN3-119-G_solo.jams', kind: 'jams', onset: 0.75, split: 'dev', performance: 'gs00-bossa' },
  { id: 'acoustic-bossa-chord', instrument: 'acoustic-guitar', category: 'dense', dataset: 'guitarset', audioFile: 'gs_00_BN3-119-G_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/00_BN3-119-G_solo.jams', kind: 'jams', onset: 14.62, split: 'dev', performance: 'gs00-bossa' },
  { id: 'acoustic-rock-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_03_Rock2-142-D_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/03_Rock2-142-D_solo.jams', kind: 'jams', onset: 0.86, split: 'dev', performance: 'gs03solo-rock' },
  { id: 'acoustic-rock-dyad', instrument: 'acoustic-guitar', category: 'dyad', dataset: 'guitarset', audioFile: 'gs_03_Rock2-142-D_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/03_Rock2-142-D_solo.jams', kind: 'jams', onset: 15.86, split: 'dev', performance: 'gs03solo-rock' },
  { id: 'acoustic-power-dyad', instrument: 'acoustic-guitar', category: 'dyad', dataset: 'guitarset', audioFile: 'gs_03_Rock1-90-C#_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/03_Rock1-90-C#_comp.jams', kind: 'jams', onset: 0.85, split: 'dev', performance: 'gs03-rockcomp' },
  { id: 'acoustic-power-dense', instrument: 'acoustic-guitar', category: 'dense', dataset: 'guitarset', audioFile: 'gs_03_Rock1-90-C#_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/03_Rock1-90-C#_comp.jams', kind: 'jams', onset: 11.34, split: 'dev', performance: 'gs03-rockcomp' },
  { id: 'acoustic-funk-triad', instrument: 'acoustic-guitar', category: 'triad', dataset: 'guitarset', audioFile: 'gs_02_Funk1-114-Ab_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/02_Funk1-114-Ab_comp.jams', kind: 'jams', onset: 1.88, split: 'dev', performance: 'gs02-funk' },
  { id: 'acoustic-funk-dense', instrument: 'acoustic-guitar', category: 'dense', dataset: 'guitarset', audioFile: 'gs_02_Funk1-114-Ab_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/02_Funk1-114-Ab_comp.jams', kind: 'jams', onset: 5.12, split: 'dev', performance: 'gs02-funk' },
  { id: 'acoustic-strum-triad', instrument: 'acoustic-guitar', category: 'strum', dataset: 'guitarset', audioFile: 'gs_01_SS3-98-C_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/01_SS3-98-C_comp.jams', kind: 'jams', onset: 2.34, split: 'eval', performance: 'gs01-strum' },
  { id: 'acoustic-strum-dense', instrument: 'acoustic-guitar', category: 'strum', dataset: 'guitarset', audioFile: 'gs_01_SS3-98-C_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/jams/01_SS3-98-C_comp.jams', kind: 'jams', onset: 5.70, split: 'eval', performance: 'gs01-strum' },
  // ---- electric guitar (EGSet12 amp-mic) — dev: eg01/eg02/eg05/eg07; eval: eg03/eg04/eg06/eg08-eg12 ----
  { id: 'electric-eg07-single', instrument: 'electric-guitar', category: 'single', dataset: 'egset12', audioFile: 'eg_07.wav', truthFile: '/tmp/corranzo-realbench/egset12/07.jams', kind: 'jams', onset: 0.36, split: 'dev', performance: 'eg07' },
  { id: 'electric-eg07-dyad', instrument: 'electric-guitar', category: 'dyad', dataset: 'egset12', audioFile: 'eg_07.wav', truthFile: '/tmp/corranzo-realbench/egset12/07.jams', kind: 'jams', onset: 16.02, split: 'dev', performance: 'eg07' },
  { id: 'electric-eg01-triad', instrument: 'electric-guitar', category: 'triad', dataset: 'egset12', audioFile: 'eg_01.wav', truthFile: '/tmp/corranzo-realbench/egset12/01.jams', kind: 'jams', onset: 4.87, split: 'dev', performance: 'eg01' },
  { id: 'electric-eg01-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_01.wav', truthFile: '/tmp/corranzo-realbench/egset12/01.jams', kind: 'jams', onset: 10.50, split: 'dev', performance: 'eg01' },
  { id: 'electric-eg02-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_02.wav', truthFile: '/tmp/corranzo-realbench/egset12/02.jams', kind: 'jams', onset: 13.71, split: 'dev', performance: 'eg02' },
  { id: 'electric-eg05-dyad', instrument: 'electric-guitar', category: 'dyad', dataset: 'egset12', audioFile: 'eg_05.wav', truthFile: '/tmp/corranzo-realbench/egset12/05.jams', kind: 'jams', onset: 10.04, split: 'dev', performance: 'eg05' },
  { id: 'electric-eg10-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_10.wav', truthFile: '/tmp/corranzo-realbench/egset12/10.jams', kind: 'jams', onset: 9.97, split: 'eval', performance: 'eg10' },
  { id: 'electric-eg03-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_03.wav', truthFile: '/tmp/corranzo-realbench/egset12/03.jams', kind: 'jams', onset: 2.04, split: 'eval', performance: 'eg03' },
  { id: 'electric-eg04-dyad', instrument: 'electric-guitar', category: 'dyad', dataset: 'egset12', audioFile: 'eg_04.wav', truthFile: '/tmp/corranzo-realbench/egset12/04.jams', kind: 'jams', onset: 9.41, split: 'eval', performance: 'eg04' },
  { id: 'electric-eg06-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_06.wav', truthFile: '/tmp/corranzo-realbench/egset12/06.jams', kind: 'jams', onset: 8.42, split: 'eval', performance: 'eg06' },
  { id: 'electric-eg08-triad', instrument: 'electric-guitar', category: 'triad', dataset: 'egset12', audioFile: 'eg_08.wav', truthFile: '/tmp/corranzo-realbench/egset12/08.jams', kind: 'jams', onset: 2.45, split: 'eval', performance: 'eg08' },
  { id: 'electric-eg09-dyad', instrument: 'electric-guitar', category: 'dyad', dataset: 'egset12', audioFile: 'eg_09.wav', truthFile: '/tmp/corranzo-realbench/egset12/09.jams', kind: 'jams', onset: 10.10, split: 'eval', performance: 'eg09' },
  { id: 'electric-eg11-dense', instrument: 'electric-guitar', category: 'dense', dataset: 'egset12', audioFile: 'eg_11.wav', truthFile: '/tmp/corranzo-realbench/egset12/11.jams', kind: 'jams', onset: 13.67, split: 'eval', performance: 'eg11' },
  { id: 'electric-eg12-triad', instrument: 'electric-guitar', category: 'triad', dataset: 'egset12', audioFile: 'eg_12.wav', truthFile: '/tmp/corranzo-realbench/egset12/12.jams', kind: 'jams', onset: 12.19, split: 'eval', performance: 'eg12' },
  // ---- fresh disjoint acoustic eval (Stage M8, 2026-10-08): new players
  // (05) and unused styles. Never touched during development tuning. ----
  { id: 'acoustic-fresh-jazz-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_00_Jazz2-187-F#_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/00_Jazz2-187-F#_solo.jams', kind: 'jams', onset: 0.6, split: 'eval-fresh', performance: 'gs00-jazz187' },
  { id: 'acoustic-fresh-jazz-dyad', instrument: 'acoustic-guitar', category: 'dyad', dataset: 'guitarset', audioFile: 'gs_00_Jazz2-187-F#_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/00_Jazz2-187-F#_solo.jams', kind: 'jams', onset: 2.58, split: 'eval-fresh', performance: 'gs00-jazz187' },
  { id: 'acoustic-fresh-rock-triad-b', instrument: 'acoustic-guitar', category: 'triad', dataset: 'guitarset', audioFile: 'gs_01_Rock3-117-Bb_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/01_Rock3-117-Bb_solo.jams', kind: 'jams', onset: 24.02, split: 'eval-fresh', performance: 'gs01-rock3' },
  { id: 'acoustic-fresh-bossa-triad', instrument: 'acoustic-guitar', category: 'triad', dataset: 'guitarset', audioFile: 'gs_02_BN1-129-Eb_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/02_BN1-129-Eb_comp.jams', kind: 'jams', onset: 8.16, split: 'eval-fresh', performance: 'gs02-bn1' },
  { id: 'acoustic-fresh-bossa-dense', instrument: 'acoustic-guitar', category: 'dense', dataset: 'guitarset', audioFile: 'gs_02_BN1-129-Eb_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/02_BN1-129-Eb_comp.jams', kind: 'jams', onset: 13.95, split: 'eval-fresh', performance: 'gs02-bn1' },
  { id: 'acoustic-fresh-funk-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_05_Funk2-108-Eb_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/05_Funk2-108-Eb_solo.jams', kind: 'jams', onset: 2.0, split: 'eval-fresh', performance: 'gs05-funk2' },
  { id: 'acoustic-fresh-rock-dense', instrument: 'acoustic-guitar', category: 'dense', dataset: 'guitarset', audioFile: 'gs_05_Rock1-130-A_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/05_Rock1-130-A_comp.jams', kind: 'jams', onset: 15.23, split: 'eval-fresh', performance: 'gs05-rock1' },
  { id: 'acoustic-fresh-rock-triad', instrument: 'acoustic-guitar', category: 'triad', dataset: 'guitarset', audioFile: 'gs_05_Rock1-130-A_comp_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/05_Rock1-130-A_comp.jams', kind: 'jams', onset: 5.76, split: 'eval-fresh', performance: 'gs05-rock1' },
  { id: 'acoustic-fresh-ss-single', instrument: 'acoustic-guitar', category: 'single', dataset: 'guitarset', audioFile: 'gs_05_SS1-100-C#_solo_mic.wav', truthFile: '/tmp/corranzo-realbench/guitarset/fresh-jams/05_SS1-100-C#_solo.jams', kind: 'jams', onset: 20.08, split: 'eval-fresh', performance: 'gs05-ss1' },
]

/** Guitar-Techs isolated amp-mic notes: low / mid / high / quietest. */
function guitarTechsPicks() {
  const notes = loadMidiNotes('/tmp/corranzo-realbench/gtechs/midi_allsinglenotes.mid')
  const audio = loadAudio({ audioFile: 'gt_singles.wav' })
  const duration = audio.samples.length / audio.sampleRate
  const inBounds = notes.filter((n) => n.onset > 0.6 && n.onset < duration - 2.6)
  const lowest = inBounds.filter((n) => n.midi <= 44).slice(0, 1)
  const mid = inBounds.filter((n) => n.midi >= 57 && n.midi <= 64).slice(0, 1)
  const high = inBounds.filter((n) => n.midi >= 72).slice(-1)
  const quietest = [...inBounds].sort((a, b) => (a.velocity ?? 1) - (b.velocity ?? 1)).slice(0, 1)
  const picks = [
    ['electric-gtechs-low', lowest[0]],
    ['electric-gtechs-mid', mid[0]],
    ['electric-gtechs-high', high[0]],
    ['electric-gtechs-quiet', quietest[0]],
  ]
  return picks
    .filter(([, note]) => note)
    .map(([id, note]) => ({
      id, instrument: 'electric-guitar', category: 'single', dataset: 'guitar-techs',
      audioFile: 'gt_singles.wav',
      truthFile: '/tmp/corranzo-realbench/gtechs/midi_allsinglenotes.mid',
      kind: 'midi', onset: note.onset, split: 'eval', performance: 'gtechs-session',
    }))
}

const truthCache = new Map()
function loadTruth(selection) {
  if (!truthCache.has(selection.truthFile)) {
    const notes = selection.kind === 'jams'
      ? loadJamsNotes(selection.truthFile)
      : loadMidiNotes(selection.truthFile)
    truthCache.set(selection.truthFile, notes)
  }
  return truthCache.get(selection.truthFile)
}

const audioCache = new Map()
function loadAudio(selection) {
  if (!audioCache.has(selection.audioFile)) {
    audioCache.set(selection.audioFile, readWavPcm(`${NORM}/${selection.audioFile}`))
  }
  return audioCache.get(selection.audioFile)
}

function buildExcerpt(selection) {
  const notes = loadTruth(selection)
  const { samples, sampleRate } = loadAudio(selection)
  const duration = samples.length / sampleRate
  const lastOnset = notes.length ? notes[notes.length - 1].onset : 0
  if (selection.kind === 'midi' && Math.abs(duration - lastOnset) > 8 && lastOnset > 0) {
    console.log(`  WARN ${selection.id}: midi/audio duration skew (audio ${duration.toFixed(1)}s, last onset ${lastOnset.toFixed(1)}s)`)
  }
  const start = Math.max(0, selection.onset - PRE_ROLL_SECONDS)
  const startIndex = Math.floor(start * sampleRate)
  const length = Math.min(Math.floor(EXCERPT_SECONDS * sampleRate), samples.length - startIndex)
  const clip = samples.subarray(startIndex, startIndex + length)
  // Anchor cluster: onsets within 120 ms of the anchor.
  const anchorTones = [...new Set(
    notes.filter((n) => Math.abs(n.onset - selection.onset) <= 0.12).map((n) => n.midi),
  )].sort((a, b) => a - b)
  // All annotated notes overlapping the excerpt (for FP/context analysis).
  const excerptNotes = notes
    .filter((n) => n.offset >= start && n.onset <= start + length / sampleRate)
    .map((n) => ({
      midi: n.midi,
      onset: Math.round((n.onset - start) * 1000) / 1000,
      offset: Math.round((n.offset - start) * 1000) / 1000,
    }))
  return {
    id: selection.id,
    instrument: selection.instrument,
    category: selection.category,
    dataset: selection.dataset,
    split: selection.split ?? 'dev',
    performance: selection.performance ?? selection.id,
    attribution: ATTRIBUTION[selection.dataset],
    license: 'CC-BY-4.0',
    sourceFile: selection.audioFile,
    sourceTruthFile: selection.truthFile.split('/tmp/corranzo-realbench/')[1],
    audio: {
      file: `clips/${selection.id}.wav`,
      sampleRate,
      startSeconds: Math.round(start * 1000) / 1000,
      durationSeconds: Math.round((length / sampleRate) * 1000) / 1000,
    },
    truth: {
      anchorOnset: Math.round((selection.onset - start) * 1000) / 1000,
      anchorTones,
      notes: excerptNotes,
    },
    clip,
  }
}

/** Lowest-RMS 1.5 s pause segments (honest room/pause controls). */
function findPauses() {
  // Measured 2026-10-07: only the Mozart take contains true silence
  // (rms 0.00013). The funk comping (0.054) and EG09 (0.044) minima are
  // loud continuous playing — no silence exists there, so no control is
  // cut from them. Do not manufacture silence controls from music.
  const targets = [
    { id: 'pause-mozart', instrument: 'piano', audioFile: 'vn_Mozart_K331_1st-mov_p01.wav', split: 'eval', performance: 'vienna-mozart-p01' },
  ]
  return targets.map((target) => {
    const { samples, sampleRate } = loadAudio(target)
    const window = Math.floor(sampleRate * 1.5)
    let best = { index: 0, energy: Infinity }
    for (let start = 0; start + window < samples.length; start += Math.floor(sampleRate * 0.25)) {
      let energy = 0
      for (let i = start; i < start + window; i += 7) {
        energy += samples[i] * samples[i]
      }
      if (energy < best.energy) {
        best = { index: start, energy }
      }
    }
    const startSeconds = best.index / sampleRate
    const clip = samples.subarray(best.index, best.index + window)
    let rms = 0
    for (let i = 0; i < clip.length; i += 3) rms += clip[i] * clip[i]
    rms = Math.sqrt(rms / Math.ceil(clip.length / 3))
    return {
      id: target.id, instrument: target.instrument, category: 'pause', dataset: 'same-as-audio',
      split: target.split, performance: target.performance,
      attribution: 'see source file entry', license: 'CC-BY-4.0', sourceFile: target.audioFile,
      sourceTruthFile: null,
      audio: { file: `clips/${target.id}.wav`, sampleRate, startSeconds: Math.round(startSeconds * 1000) / 1000, durationSeconds: 1.5 },
      truth: { anchorOnset: null, anchorTones: [], notes: [] },
      pauseRms: Math.round(rms * 1e5) / 1e5,
      clip,
    }
  })
}

function main() {
  const write = process.argv.includes('--write')
  const excerpts = [...SELECTIONS, ...guitarTechsPicks()].map(buildExcerpt)
  for (const excerpt of excerpts) {
    console.log(`${excerpt.id}: anchor=${excerpt.truth.anchorOnset}s tones=[${excerpt.truth.anchorTones}] notes=${excerpt.truth.notes.length} src@${excerpt.audio.startSeconds}s`)
    if (excerpt.truth.anchorTones.length === 0) {
      console.log(`  WARN ${excerpt.id}: no annotated tones at anchor — check alignment`)
    }
  }
  const pauses = findPauses()
  for (const pause of pauses) {
    console.log(`${pause.id}: pause rms=${pause.pauseRms} src@${pause.audio.startSeconds}s`)
  }
  if (!write) {
    console.log('\nDry run. Pass --write to cut clips + manifest.')
    return
  }
  mkdirSync(OUT_DIR, { recursive: true })
  const manifest = []
  for (const excerpt of [...excerpts, ...pauses]) {
    const { clip, ...entry } = excerpt
    writeWavPcm(join(OUT_DIR, `${excerpt.id}.wav`), clip, excerpt.audio.sampleRate)
    manifest.push(entry)
  }
  writeFileSync(
    join(dirname(OUT_DIR), 'manifest.json'),
    JSON.stringify({
      version: 1,
      excerptSeconds: EXCERPT_SECONDS,
      preRollSeconds: PRE_ROLL_SECONDS,
      provenance: 'Independent dataset annotations (JAMS per-string / MIDI). Detector output never used as truth.',
      naturalRecordings: manifest.length,
      excluded: [
        {
          id: 'piano-mozart2-dense',
          reason: 'Annotation error, independently verified 2026-10-08: forte MIDI chord at 23.04 falls in near-silent audio (rms ~0.0005); music resumes at 23.3. Clip removed, never retuned.',
        },
      ],
      clips: manifest,
    }, null, 2),
  )
  console.log(`\nWrote ${manifest.length} clips + manifest.`)
}

main()
