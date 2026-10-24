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
  suppressHarmonicDoubles,
  buildMelodyContour,
  PART_INSTRUMENTS,
} from './arrangementModel.js'
import { arrangeSoloPiano } from './soloPiano.js'
import { arrangeSoloGuitar } from './soloGuitar.js'
import { simplifyForDifficulty } from './difficulty.js'
import { buildArrangementMusicXml } from './arrangementMusicXml.js'
import { spectralSecondOpinion, scoreAgreement, AGREEMENT_WINDOW_SECONDS } from './agreementScore.js'
import {
  annotateNoteKeys,
  applyNoteCorrections,
  parseNoteCorrections,
  resolveCorrections,
  serializeNoteCorrections,
} from './noteCorrections.js'

export const CONFIDENCE_THRESHOLD_ARRANGE = 0.35
export const CONFIDENCE_THRESHOLD_PARTIAL = 0.2

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0))
}

/** Honest confidence from measurable signals (never invented). */
export function scoreArrangementConfidence({ analysis, arrangedEvents, separationQuality, warnings = [] }) {
  const onsetRate = analysis.onsets.length / Math.max(1, analysis.totalSeconds)
  const onsetScore = clamp01((onsetRate - 0.2) / 3)
  const tempoScore = analysis.tempo.confidence ?? 0
  const chordScores = (analysis.chords ?? []).map((c) => c.confidence ?? 0)
  const chordScore = chordScores.length ? chordScores.reduce((a, b) => a + b, 0) / chordScores.length : 0
  // Density relative to onset evidence: healthy arrangements carry ~1-3 notes
  // per onset. Raw note counts reward invention (spectral over-generation),
  // so yield saturates and then penalizes (A9: grounded, not gamed).
  const density = arrangedEvents.length / Math.max(1, analysis.onsets.length)
  const densityScore = density <= 3 ? clamp01(density / 2) : Math.max(0, 1 - (density - 3) / 6)
  // §5 transcription agreement: an independent second transcriber corroborating
  // the model. Unknown (null) keeps the score unchanged rather than guessing.
  const agreementScore = Number.isFinite(analysis.transcriptionAgreement) ? analysis.transcriptionAgreement : null
  const agreementComponent = agreementScore == null ? 0 : 0.15 * agreementScore
  const sepBonus = separationQuality?.helpsTranscription ? 0.05 : 0
  const sourceBonus = analysis.pitchSource === 'basic-pitch' ? 0.05 : 0
  // Only severe playability failures count — benign musical notes
  // (position shifts, expressive leaps) must not tank confidence.
  const SEVERE_WARNING_KINDS = new Set([
    'unplayable-note-dropped',
    'chord-voice-dropped',
    'wide-stretch',
    'hand-span-enforced',
    'dense-arrangement',
    'range-audit',
  ])
  const severeCount = (warnings ?? []).filter((w) => SEVERE_WARNING_KINDS.has(w.kind ?? w)).length
  const warningPenalty = Math.min(0.15, severeCount * 0.02)
  // Uncertainty regions lower the score proportionally (capped): a mix with a
  // third of its windows uncorroborated should not read as fully confident.
  const regionPenalty = Math.min(0.2, (analysis.uncertainRegionRatio ?? 0) * 0.4)
  const melodyNotes = arrangedEvents.filter((e) => e.role === 'melody').length
  const melodyScore = arrangedEvents.length ? melodyNotes / arrangedEvents.length : 0
  const overall = clamp01(
    0.2 * onsetScore + 0.15 * tempoScore + 0.15 * chordScore
    + 0.15 * densityScore + 0.2 * melodyScore + sepBonus + sourceBonus + agreementComponent
    - warningPenalty - regionPenalty,
  )
  return {
    overall: Math.round(overall * 1000) / 1000,
    parts: {
      onsetEvidence: Math.round(onsetScore * 100) / 100,
      tempoConfidence: tempoScore,
      chordConfidence: Math.round(chordScore * 100) / 100,
      densityScore: Math.round(densityScore * 100) / 100,
      melodyPreservation: Math.round(melodyScore * 100) / 100,
      transcriptionAgreement: agreementScore,
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
  const {
    targetPart, difficulty, title, excerpt = null, tempoOverride = null,
    // The onset-corroboration gate: it drops a short transcribed note that no
    // spectral-flux detector heard attack. Measured on real recordings it
    // HURTS (-0.036 event F1 on the five GuitarSet performances, and it
    // deletes 37 genuine notes on the densest one), because the flux
    // detector misses a soft pick and the gate then drops a REAL note. The
    // default follows the real recordings; `corroborateNotes: true`
    // reproduces the older behaviour.
    corroborateNotes = false,
    // The musician's per-note edits from the review panel. Kept separate
    // from the transcription (the evidence) and from the arrangement (what
    // gets written): the score is always "the arrangement minus what the
    // musician removed", never a mutation of the transcription itself.
    corrections = null,
  } = options
  if (!Object.values(PART_INSTRUMENTS).includes(targetPart)) {
    return { ok: false, code: 'unsupported-part', message: 'V1 supports solo piano and solo guitar only.' }
  }
  // Cancellation is checked at every stage boundary so a cancelled run stops
  // doing expensive work instead of finishing in the background.
  const cancelled = () => {
    try { return Boolean(stages.isCancelled?.()) } catch { return false }
  }
  const yieldToPaint = () => new Promise((resolve) => setTimeout(resolve, 0))
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  // Stage: decoding. Reported before the work starts so the UI can paint the
  // label immediately instead of appearing to hang on an untouched 0%.
  stages.onProgress?.({ stage: 'decode', fraction: 0 })
  await yieldToPaint()
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  const imported = await importAudioFile(file, arrayBuffer, stages.decodeAudioDataImpl)
  if (!imported.ok) return { ok: false, ...imported }
  // Yield so the UI can paint the 'Preparing audio' stage before DSP.
  await yieldToPaint()
  // A12 silence gate: never arrange room tone. Measured on the same recording
  // at controlled gains, AFTER the import's peak normalization: true digital
  // silence lands near 1e-5 RMS while real music at -40 dB still reads 1.1e-3.
  // The old 2e-3 floor refused that quiet-but-real material, so the gate now
  // sits an order of magnitude below quiet music and an order above silence.
  if (!(imported.rms >= 1e-5)) {
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
  stages.onProgress?.({ stage: 'preparing', fraction: 0.05 })
  await yieldToPaint()
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  const cut = sliceExcerpt(imported.samples, imported.sampleRate, {
    startSeconds: excerpt?.startSeconds ?? 0,
    durationSeconds: excerpt?.durationSeconds ?? EXCERPT_MAX_SECONDS,
  })
  const excerptReport = {
    startSeconds: cut.startSeconds,
    durationSeconds: cut.durationSeconds,
    totalSeconds: cut.totalSeconds,
    truncated: cut.truncated,
    limitSeconds: EXCERPT_MAX_SECONDS,
  }
  // A4: slice stereo mid/side with the identical range (same rate/length).
  let stereoSlice = null
  if (imported.stereo && imported.stereo.mid.length === imported.samples.length) {
    const s0 = Math.floor(cut.startSeconds * imported.sampleRate)
    const s1 = s0 + cut.samples.length
    stereoSlice = {
      mid: imported.stereo.mid.slice(s0, s1),
      side: imported.stereo.side.slice(s0, s1),
      centerRatio: imported.stereo.centerRatio,
    }
  }
  const views = await buildAnalysisViews(cut.samples, imported.sampleRate, { stereoSide: stereoSlice?.side ?? null })
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  // A4: stereo is evidence only (mid == mono mix by construction; there is no
  // center-extracted stem). Onsets, tempo, chords and melody describe the mix.
  const analyzeSamples = cut.samples
  const analysis = await analyzeMusic(analyzeSamples, imported.sampleRate, {
    // The whole view object: analyzeMusic reuses the mix spectrogram (the FFT
    // pass is the same one) and needs the grid description with it.
    views,
    predictNotes: stages.predictNotes ?? null,
    onProgress: progress,
    isCancelled: () => cancelled(),
    // M3: reviewer's tempo correction propagates to beats -> quantization ->
    // arrangement -> MusicXML -> preview -> practice checkpoints.
    tempoOverride: Number.isFinite(tempoOverride) && tempoOverride > 0 ? tempoOverride : null,
    corroborateNotes,
  })
  analysis.stereo = stereoSlice
    ? {
        centerRatio: stereoSlice.centerRatio,
        spaciousness: views.stereo?.spaciousness ?? null,
      }
    : null
  // A12 structural gate (after analysis, on evidence not energy): measured on
  // controlled inputs, RMS cannot separate quiet music from noise (noise at
  // -40 dB actually reads LOUDER than the music), but musical content is
  // unambiguous - real music at -40 dB yields ~226 onsets while noise and
  // digital silence yield 0. Refuse on the absence of musical events.
  if (!analysis.onsets.length || !analysis.melody?.length) {
    return {
      ok: false,
      code: 'empty-audio',
      message: 'No musical content was found in that recording (silence, room tone, or pure noise). Corranzo would rather refuse than invent sheet music.',
      confidence: { overall: 0, provenance: PROVENANCE.INFERRED },
      warnings: [],
      excerpt: null,
    }
  }
  // §5 — independent second opinion (model-free spectral peaks on the
  // harmonic view) and windowed agreement against the primary model.
  // Agreement is evidence of transcription reliability at runtime; the
  // second opinion is never used as the arrangement's source of notes.
  let agreement = null
  let uncertainRegions = []
  if (analysis.pitchSource === 'basic-pitch') {
    const secondOpinion = spectralSecondOpinion({
      harmonicFrames: views.harmonic,
      onsets: analysis.onsets,
      totalSeconds: analysis.totalSeconds,
      fftSize: views.fftSize,
      sampleRate: imported.sampleRate,
    })
    const scored = scoreAgreement(analysis.predictedNotes, secondOpinion, { totalSeconds: analysis.totalSeconds })
    agreement = scored.agreement
    uncertainRegions = scored.uncertainRegions
  }
  analysis.transcriptionAgreement = agreement
  const windowCount = Math.max(1, Math.ceil(analysis.totalSeconds / AGREEMENT_WINDOW_SECONDS))
  analysis.uncertainRegionRatio = uncertainRegions.length / windowCount
  const transcribed = createTranscribedContent({ analysis, viewsQuality: views.quality })
  // Harmonic-double suppression (BP path only: amplitude-gated). Count is
  // reported, never silent; arrangement-grade effect measured on frozen eval.
  // A spectral second opinion was measured too (suppressHarmonicDoubles accepts
  // { samples }): with the calibrated extraction it recovers 2 real notes out
  // of 1810 and leaves the score unchanged, so production keeps the amplitude
  // rule and the evidence stays in docs/audio-vision-missed-notes.md.
  let suppressedHarmonics = 0
  if (analysis.pitchSource === 'basic-pitch' && analysis.predictedNotes.some((n) => n.amplitude != null)) {
    const filtered = suppressHarmonicDoubles(analysis.predictedNotes)
    suppressedHarmonics = filtered.suppressed
    analysis.predictedNotes = filtered.notes
  }
  transcribed.suppressedHarmonics = suppressedHarmonics
  // Melody contour from DETECTED salient frames — decides which simultaneous
  // note is the melody (evidence), so thinning protects the real line.
  const melodyContour = buildMelodyContour(analysis.melody, {
    beat0: analysis.beats.beats[0] ?? 0,
    beatPeriod: analysis.beats.beatPeriodSeconds,
  })
  transcribed.melodyContourBeats = melodyContour.size
  const quantized = quantizeToBeats(analysis.predictedNotes, analysis.beats.beats)
  // Stage: building the arrangement. Yield first so the label paints before
  // the arrangement pass runs.
  stages.onProgress?.({ stage: 'arranging', fraction: 0.92 })
  await yieldToPaint()
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  // Melody anchors for piano phrasing: strongest melody frame per onset beat.
  const melodyByBeat = (analysis.melody ?? []).map((m) => ({ beat: (m.seconds - (analysis.beats.beats[0] ?? 0)) / analysis.beats.beatPeriodSeconds, midi: m.midi }))
  let arranged
  if (targetPart === PART_INSTRUMENTS.SOLO_PIANO) {
    arranged = arrangeSoloPiano({
      quantizedNotes: quantized,
      chords: analysis.chords,
      melodyByBeat,
      difficulty,
      melodyContour,
      // Chord windows are emitted per beat, so the arranger resolves them by
      // time; it needs the beat grid's origin and period to do that.
      beat0: analysis.beats.beats[0] ?? 0,
      beatPeriod: analysis.beats.beatPeriodSeconds,
    })
  } else {
    arranged = arrangeSoloGuitar({ quantizedNotes: quantized, chords: analysis.chords, difficulty, melodyContour })
  }
  const simplified = simplifyForDifficulty(
    arranged.events.map((e) => ({ ...e, quantizedStartBeat: e.startBeat, quantizedDurBeats: e.durBeats })),
    difficulty,
  ).map((e) => ({ ...e, startBeat: e.quantizedStartBeat ?? e.startBeat, durBeats: e.quantizedDurBeats ?? e.durBeats }))
  // USER CORRECTIONS (review panel -> per-note removal). The transcription
  // evidence (`arrangementEvents`) stays whole and uncorrected; the score and
  // the practice targets are derived from it minus the musician's removals.
  // Keys use the written beat, not wall-clock seconds: a tempo rebuild keeps
  // the same key for the same written note, and a stale key is inert.
  const timeOfArrangedEvent = (event) => Number(event?.startBeat ?? 0)
  const parsedCorrections = parseNoteCorrections(corrections)
  const arrangementEvents = annotateNoteKeys(simplified, { timeOf: timeOfArrangedEvent })
  const correctionResolution = resolveCorrections(arrangementEvents, parsedCorrections, { timeOf: timeOfArrangedEvent })
  const corrected = applyNoteCorrections(arrangementEvents, parsedCorrections, { timeOf: timeOfArrangedEvent })
  const correctedEvents = corrected.events
  const notation = {
    bpm: analysis.tempo.bpm,
    beatsPerMeasure: analysis.meter?.beatsPerMeasure ?? 4,
    title: title ?? file?.name?.replace(/\.[^.]+$/, '') ?? 'Audio Arrangement',
  }
  const model = createArrangementModel({ targetPart, difficulty })
  model.parts[0].events = correctedEvents
  model.parts[0].warnings = arranged.warnings ?? []
  model.uncertainRegions = uncertainRegions
  model.transcriptionAgreement = agreement
  if (arranged.strings) model.parts[0].strings = arranged.strings
  // A9: density plausibility BEFORE confidence — extreme notes/beat usually
  // means invented detail in dense mixes, not virtuosity. The warning feeds
  // the severe-warning penalty inside confidence (no silent inflation).
  const beatCount = Math.max(1, analysis.beats.beats.length)
  const notesPerBeat = correctedEvents.length / beatCount
  if (notesPerBeat > 6) {
    model.parts[0].warnings.push({
      kind: 'dense-arrangement',
      detail: `${notesPerBeat.toFixed(1)} notes/beat — review for invented detail`,
    })
  }
  const confidence = scoreArrangementConfidence({
    analysis,
    arrangedEvents: correctedEvents,
    separationQuality: views.quality,
    warnings: model.parts[0].warnings,
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
  // Stage: generating the notation (MusicXML). Yield first so the label paints.
  stages.onProgress?.({ stage: 'notation', fraction: 0.96 })
  await yieldToPaint()
  if (cancelled()) return { ok: false, code: 'cancelled', message: 'Analysis cancelled.' }
  const musicXml = buildArrangementMusicXml({
    events: correctedEvents,
    targetPart,
    bpm: notation.bpm,
    beatsPerMeasure: notation.beatsPerMeasure,
    title: notation.title,
    warnings: model.parts[0].warnings,
  })
  model.complexity = measureComplexity(correctedEvents.map((e) => ({ ...e, startSeconds: e.startBeat })))
  stages.onProgress?.({ stage: 'done', fraction: 1 })
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
      stereo: analysis.stereo ?? null,
      tempoSource: analysis.tempo.source ?? 'estimate',
      tempoEstimatedBpm: analysis.tempo.estimatedBpm ?? null,
    },
    confidence,
    partial: verdict.partial,
    excerpt: excerptReport,
    suppressedHarmonics,
    corrections: serializeNoteCorrections(parsedCorrections),
    correctionsApplied: corrected.removedCount,
    correctionsStale: correctionResolution.stale.length,
    staleCorrectionKeys: correctionResolution.stale,
    // The uncorrected arrangement is retained as the transcription evidence:
    // undo always restores the machine's full note set, and the review panel
    // can distinguish "what was heard" from "what the musician kept".
    arrangementEvents,
    removedEvents: corrected.removedEvents,
    originalNoteCount: arrangementEvents.length,
    notation,
    transcriptionEvidence: {
      noteCount: arrangementEvents.length,
      pitchSource: analysis.pitchSource,
      events: arrangementEvents.map((event) => ({
        correctionKey: event.correctionKey,
        midi: event.midi,
        startBeat: event.startBeat,
        durBeats: event.durBeats,
        hand: event.hand ?? null,
        role: event.role ?? null,
      })),
    },
    uncertainRegions,
    transcriptionAgreement: agreement,
    durationSeconds: imported.durationSeconds,
  }
}
