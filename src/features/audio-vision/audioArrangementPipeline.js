/**
 * End-to-end audio → solo arrangement pipeline (A1..A8 + A12 failure handling).
 * Pure orchestration over injected stages so Node tests run without a browser.
 */
import { importAudioFile } from './audioImport.js'
import { buildAnalysisViews } from './sourceSeparation.js'
import { analyzeMusic, PROVENANCE } from './musicAnalysis.js'
import {
  createTranscribedContent,
  createArrangementModel,
  quantizeToBeats,
  measureComplexity,
  PART_INSTRUMENTS,
} from './arrangementModel.js'
import { arrangeSoloPiano } from './soloPiano.js'
import { arrangeSoloGuitar } from './soloGuitar.js'
import { simplifyForDifficulty } from './difficulty.js'
import { buildArrangementMusicXml } from './arrangementMusicXml.js'

export const CONFIDENCE_THRESHOLD_ARRANGE = 0.35
export const CONFIDENCE_THRESHOLD_PARTIAL = 0.2

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

/** Honest confidence from measurable signals (never invented). */
export function scoreArrangementConfidence({ analysis, arrangedEvents, separationQuality }) {
  const onsetRate = analysis.onsets.length / Math.max(1, analysis.totalSeconds)
  const onsetScore = clamp01((onsetRate - 0.2) / 3)
  const tempoScore = analysis.tempo.confidence ?? 0
  const chordScores = (analysis.chords ?? []).map((c) => c.confidence ?? 0)
  const chordScore = chordScores.length ? chordScores.reduce((a, b) => a + b, 0) / chordScores.length : 0
  const noteCount = arrangedEvents.length
  const noteScore = clamp01(noteCount / 24)
  const sepBonus = separationQuality?.helpsTranscription ? 0.05 : 0
  const melodyNotes = arrangedEvents.filter((e) => e.role === 'melody').length
  const melodyScore = arrangedEvents.length ? melodyNotes / arrangedEvents.length : 0
  const overall = clamp01(0.3 * onsetScore + 0.2 * tempoScore + 0.2 * chordScore + 0.2 * noteScore + 0.1 * melodyScore + sepBonus)
  return {
    overall: Math.round(overall * 100) / 100,
    parts: {
      onsetEvidence: Math.round(onsetScore * 100) / 100,
      tempoConfidence: tempoScore,
      chordConfidence: Math.round(chordScore * 100) / 100,
      noteYield: Math.round(noteScore * 100) / 100,
      melodyPreservation: Math.round(melodyScore * 100) / 100,
    },
    pitchSource: analysis.pitchSource,
    separationHelps: Boolean(separationQuality?.helpsTranscription),
    provenance: PROVENANCE.INFERRED,
  }
}

export function refusalForConfidence(confidence, { totalSeconds }) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 1) {
    return { refuse: true, reason: 'empty-audio', message: 'No usable audio was found. Try a louder, clearer recording.' }
  }
  if (confidence.overall < CONFIDENCE_THRESHOLD_PARTIAL) {
    return {
      refuse: true,
      reason: 'low-confidence',
      message: 'This recording could not be analyzed reliably (very noisy, indistinct melody, or unresolvable polyphony). Corranzo would rather refuse than invent sheet music. Try an excerpt with a clearer lead line.',
    }
  }
  if (confidence.overall < CONFIDENCE_THRESHOLD_ARRANGE) {
    return {
      refuse: false,
      partial: true,
      reason: 'partial-confidence',
      message: 'This arrangement is partial: some passages were unclear and simplified. Review the flagged measures.',
    }
  }
  return { refuse: false, partial: false, reason: 'ok', message: '' }
}

/**
 * Run the full pipeline.
 * stages: { decodeAudioDataImpl, predictNotes } injected (browser provides real ones).
 * options.excerpt: { startSeconds, durationSeconds } — explicit user-chosen
 * range (max 180 s). The result always reports the exact covered range so a
 * long recording is never silently truncated (Phase 7).
 */
export async function runAudioArrangementPipeline(file, arrayBuffer, options, stages = {}) {
  const { targetPart, difficulty, title, excerpt = null } = options
  if (!Object.values(PART_INSTRUMENTS).includes(targetPart)) {
    return { ok: false, code: 'unsupported-part', message: 'V1 supports solo piano and solo guitar only.' }
  }
  const imported = await importAudioFile(file, arrayBuffer, stages.decodeAudioDataImpl)
  if (!imported.ok) return { ok: false, ...imported }
  // A12 silence gate: never arrange room tone. Floor mirrors the neural
  // silence-skip measurement (true silence ~0.00014, softest real note 0.004+).
  if (!(imported.rms >= 0.002)) {
    return {
      ok: false,
      code: 'empty-audio',
      message: 'That recording is essentially silent. Corranzo would rather refuse than invent sheet music — try a louder, clearer recording.',
      confidence: { overall: 0, provenance: PROVENANCE.INFERRED },
      warnings: [],
      excerpt: null,
    }
  }
  const progress = stages.onProgress
  // Phase 7: explicit excerpt — never a silent truncation. Default covers
  // the first EXCERPT_MAX_SECONDS and says so in the result.
  const { sliceExcerpt, EXCERPT_MAX_SECONDS } = await import('./audioImport.js')
  const cut = sliceExcerpt(imported.samples, imported.sampleRate, {
    startSeconds: excerpt?.startSeconds ?? 0,
    durationSeconds: excerpt?.durationSeconds ?? EXCERPT_MAX_SECONDS,
  })
  const analyzeSamples = cut.samples
  const excerptReport = {
    startSeconds: cut.startSeconds,
    durationSeconds: cut.durationSeconds,
    totalSeconds: cut.totalSeconds,
    truncated: cut.truncated,
    limitSeconds: EXCERPT_MAX_SECONDS,
  }
  const views = buildAnalysisViews(analyzeSamples, imported.sampleRate)
  const analysis = await analyzeMusic(analyzeSamples, imported.sampleRate, {
    views: { harmonic: views.harmonic, percussive: views.percussive },
    predictNotes: stages.predictNotes ?? null,
    onProgress: progress,
  })
  const transcribed = createTranscribedContent({ analysis, viewsQuality: views.quality })
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  // Melody anchors for piano phrasing: strongest melody frame per onset beat.
  const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - (analysis.beats.beats[0] ?? 0)) / analysis.beats.beatPeriodSeconds, midi: m.midi }))
  let arranged
  if (targetPart === PART_INSTRUMENTS.SOLO_PIANO) {
    arranged = arrangeSoloPiano({ quantizedNotes: quantized, chords: analysis.chords, melodyByBeat, difficulty })
  } else {
    arranged = arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty })
  }
  const simplified = simplifyForDifficulty(
    arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
    difficulty,
  ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
  const model = createArrangementModel({ targetPart, difficulty })
  model.parts[0].events = simplified
  model.parts[0].warnings = arranged.warnings ?? []
  if (arranged.strings) model.parts[0].strings = arranged.strings
  const confidence = scoreArrangementConfidence({
    analysis,
    arrangedEvents: simplified,
    separationQuality: views.quality,
  })
  model.confidence = confidence
  const verdict = refusalForConfidence(confidence, { totalSeconds: analysis.totalSeconds })
  if (verdict.refuse) {
    return {
      ok: false,
      code: verdict.reason,
      message: verdict.message,
      confidence,
      transcribed,
      warnings: model.parts[0].warnings,
      excerpt: excerptReport,
    }
  }
  const musicXml = buildArrangementMusicXml({
    events: simplified,
    targetPart,
    bpm: analysis.tempo.bpm,
    beatsPerMeasure: 4,
    title: title ?? file?.name?.replace(/\.[^.]+$/, '') ?? 'Audio Arrangement',
    warnings: model.parts[0].warnings,
  })
  model.complexity = measureComplexity(simplified.map((e) => ({ ...e, startSeconds: e.startBeat })))
  return {
    ok: true,
    code: verdict.partial ? 'partial' : 'ok',
    message: verdict.message,
    musicXml,
    model,
    transcribed,
    analysis: {
      tempo: analysis.tempo,
      beats: analysis.beats.beats.length,
      onsets: analysis.onsets.length,
      chords: analysis.chords.length,
      pitchSource: analysis.pitchSource,
      totalSeconds: analysis.totalSeconds,
    },
    confidence,
    partial: verdict.partial,
    excerpt: excerptReport,
    durationSeconds: imported.durationSeconds,
  }
}
