/**
 * A2 — Music analysis: tempo, beats, onsets, chroma/chords, melody, bass, sections.
 * Every output item carries provenance: detected | predicted | inferred.
 * Inferred musical claims are never labeled detected.
 */
import {
  magnitudeSpectrogram,
  spectralFlux,
  pickOnsetFrames,
  estimateTempoFromEnvelope,
  buildBeatGrid,
  chromaOfSpectrum,
  recognizeChord,
  recognizeChordWithRoot,
  inferMeter,
  downgradeUnheardExtension,
  hzToMidi,
  binToHz,
} from './dsp.js'

/**
 * Downgrade claimed sevenths the transcription did not hear. A/B on 16
 * independent GuitarSet recordings (139 usable chord windows): quality 0.338
 * -> 0.468 and root+quality 0.309 -> 0.417, with no recording regressing and
 * root accuracy untouched (the guard never re-roots). Set false to re-measure
 * the guard's effect without editing call sites.
 */
export const SEVENTH_GUARD_ENABLED = true

/**
 * Yield the main thread so the host UI (React paint, progress bar) can update
 * between expensive synchronous DSP stages. Resolves on a macrotask in both the
 * browser and Node. Cheap enough to call at every stage boundary.
 */
async function yieldToUI() {
  if (typeof setTimeout === 'function') {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export const PROVENANCE = {  DETECTED: 'detected', // direct DSP evidence (onsets, spectral peaks)
  PREDICTED: 'predicted', // neural model output (Basic Pitch note events)
  INFERRED: 'inferred', // musical inference from evidence (chords, sections, quantization)
  ARRANGED: 'arranged', // arrangement decision for playability
}

// Melody search band. The 1400 Hz cap hid 22-27% of TRIOS viola frames (real
// high-register melodic content); widened to 3500 Hz so violin/flute/oboe and
// harmonics of guitar/piano leads are visible. The bass band below stays
// separate so the two never compete for the same partials.
function dominantMelodyMidi(spectrum, fftSize, sampleRate, { minHz = 130, maxHz = 3500 } = {}) {
  let bestBin = -1
  let bestVal = 0
  for (let b = 1; b < spectrum.length; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    if (spectrum[b] > bestVal) {
      bestVal = spectrum[b]
      bestBin = b
    }
  }
  if (bestBin < 0 || bestVal <= 1e-9) return null
  // Parabolic interpolation for sub-bin accuracy.
  const prev = spectrum[bestBin - 1] ?? 0
  const next = spectrum[bestBin + 1] ?? 0
  const denom = prev - 2 * spectrum[bestBin] + next
  const delta = denom !== 0 ? (0.5 * (prev - next)) / denom : 0
  const hz = binToHz(bestBin + Math.max(-0.5, Math.min(0.5, delta)), fftSize, sampleRate)
  return { midiFloat: hzToMidi(hz), strength: bestVal, hz }
}

function bassMidi(spectrum, fftSize, sampleRate, { minHz = 40, maxHz = 250 } = {}) {
  let bestBin = -1
  let bestVal = 0
  for (let b = 1; b < spectrum.length; b += 1) {
    const hz = binToHz(b, fftSize, sampleRate)
    if (hz < minHz || hz > maxHz) continue
    if (spectrum[b] > bestVal) {
      bestVal = spectrum[b]
      bestBin = b
    }
  }
  if (bestBin < 0 || bestVal <= 1e-9) return null
  return { midiFloat: hzToMidi(binToHz(bestBin, fftSize, sampleRate)), strength: bestVal }
}

/**
 * Analyze mono 22050 Hz samples. views: { harmonic, percussive } magnitude frames (optional).
 * predictNotes: async (samples) => [{ midi, startSeconds, endSeconds }] | null (Basic Pitch).
 */
export async function analyzeMusic(samples, sampleRate, { views = null, predictNotes = null, onProgress = null, tempoOverride = null, isCancelled = null, corroborateNotes = true } = {}) {
  const totalSeconds = samples.length / sampleRate
  const report = (stage, fraction) => {
    try { onProgress?.({ stage, fraction }) } catch { /* noop */ }
  }
  // Cancellation is honoured at every stage boundary: a cancelled run stops
  // doing expensive DSP work instead of running to completion in the background.
  const cancelled = () => {
    try { return Boolean(isCancelled?.()) } catch { return false }
  }
  const abort = () => {
    const err = new Error('analysis-cancelled')
    err.code = 'cancelled'
    throw err
  }
  report('spectrogram', 0.05)
  await yieldToUI()
  if (cancelled()) abort()
  // The caller has usually already computed this exact spectrogram (the
  // analysis views need it for HPSS). Reusing it halves the FFT work; a
  // separately computed one is identical, so the result does not change.
  // The reuse only happens when the view carries the full grid description —
  // a partial view would silently change the tempo search.
  const reusable = views?.mix?.length && Number.isFinite(views.frameSeconds) && Number.isFinite(views.fftSize)
    ? views
    : null
  const { frames, fftSize, hop, frameSeconds } = reusable
    ? { frames: reusable.mix, fftSize: reusable.fftSize, hop: reusable.hop, frameSeconds: reusable.frameSeconds }
    : await magnitudeSpectrogram(samples, { sampleRate })
  const harmFrames = views?.harmonic ?? frames
  report('onsets', 0.2)
  await yieldToUI()
  if (cancelled()) abort()
  const flux = spectralFlux(frames)
  const onsetFrames = pickOnsetFrames(flux)
  const onsets = onsetFrames.map((f) => ({
    seconds: Math.round(f * frameSeconds * 1000) / 1000,
    strength: Math.round(flux[f] * 1e6) / 1e6,
    provenance: PROVENANCE.DETECTED,
  }))
  report('melody-bass', 0.2)
  await yieldToUI()
  if (cancelled()) abort()
  const melody = []
  const bassLine = []
  for (let f = 0; f < harmFrames.length; f += 1) {
    const m = dominantMelodyMidi(harmFrames[f], fftSize, sampleRate)
    if (m && m.strength > 1e-7) {
      melody.push({
        seconds: Math.round(f * frameSeconds * 1000) / 1000,
        midiFloat: Math.round(m.midiFloat * 10) / 10,
        midi: Math.round(m.midiFloat),
        strength: m.strength,
        provenance: PROVENANCE.DETECTED,
      })
    }
    if (f % 2 === 0) {
      const b = bassMidi(frames[f], fftSize, sampleRate)
      if (b) {
        bassLine.push({
          seconds: Math.round(f * frameSeconds * 1000) / 1000,
          midi: Math.round(b.midiFloat),
          provenance: PROVENANCE.DETECTED,
        })
      }
    }
  }
  // The pitch model runs BEFORE the beat grid: it is the longest step, and its
  // first note is the earliest musical event we know exactly, so it anchors the
  // grid's phase (a grid anchored on a missed first onset folds the recording's
  // first beat into the second one).
  report('notes', 0.3)
  await yieldToUI()
  if (cancelled()) abort()
  let predictedNotes = []
  let pitchSource = 'spectral-fallback'
  if (typeof predictNotes === 'function') {
    try {
      // The pitch estimator reports its real window progress when it can
      // (Basic Pitch measures every window), so the progress bar shows measured
      // progress instead of a frozen bar during the longest stage.
      const events = await predictNotes(samples, (fraction) => {
        const f = Number(fraction)
        if (Number.isFinite(f) && f >= 0 && f <= 1) report('notes', 0.3 + 0.25 * f)
      })
      if (Array.isArray(events) && events.length) {
        predictedNotes = events.map((e) => ({
          midi: Math.round(e.midi ?? e.pitchMidi ?? 0),
          startSeconds: Number(e.startSeconds ?? e.startTimeSeconds ?? 0),
          endSeconds: Number(e.endSeconds ?? (e.startTimeSeconds ?? 0) + (e.durationSeconds ?? 0)),
          amplitude: Number.isFinite(e.amplitude) ? e.amplitude : null,
          provenance: PROVENANCE.PREDICTED,
        })).filter((e) => e.midi >= 21 && e.midi <= 108 && e.endSeconds > e.startSeconds)
        pitchSource = 'basic-pitch'
      }
    } catch {
      predictedNotes = []
    }
  }
  if (predictedNotes.length && corroborateNotes) {
    // ONSET CORROBORATION (independent evidence, not taste).
    //
    // The pitch model claims a note at a time. The spectral-flux onset detector
    // independently claims where the music attacks. A short transcribed note
    // that lands where nothing attacks is usually a harmonic artifact, and in
    // the arrangement it is worse than useless: it lands between two real
    // notes and CHOPS them (the voice can only hold one note, so the real note
    // is cut to a stub).
    //
    // A note that is already sounding (legato) has no attack of its own, so
    // only SHORT notes are judged: a sustained note is never dropped for
    // lacking an onset.
    predictedNotes = corroborateNotesByOnset(predictedNotes, onsets)
  }
  if (!predictedNotes.length) {
    predictedNotes = contourToNotes(melody, onsets)
  }
  report('tempo', 0.6)
  await yieldToUI()
  if (cancelled()) abort()
  const tempo = await estimateTempoFromEnvelope(flux, frameSeconds)
  // Sectional re-estimate for tempo variation: split in thirds, flag drift.
  const third = Math.floor(flux.length / 3)
  const sectionTempos = []
  for (let s = 0; s < 3; s += 1) {
    const seg = flux.slice(s * third, s === 2 ? flux.length : (s + 1) * third)
    sectionTempos.push((await estimateTempoFromEnvelope(seg, frameSeconds)).bpm)
  }
  const tempoVaries = Math.max(...sectionTempos) - Math.min(...sectionTempos) >= 8
  report('beats', 0.7)
  await yieldToUI()
  if (cancelled()) abort()
  // M3: an explicit tempo override (from the review UI) replaces the estimated
  // beat period. It is carried as the *tempo used*, so everything downstream -
  // beats, quantization, arrangement, MusicXML, preview, checkpoints - follows
  // the corrected value rather than a display label.
  const effectiveTempo = Number.isFinite(tempoOverride) && tempoOverride > 0
    ? { ...tempo, bpm: Math.round(tempoOverride), source: 'user-override', estimatedBpm: tempo.bpm, octaveAlternative: null }
    : { ...tempo, source: 'estimate' }
  // The grid's phase: the earliest note the model heard (exact), otherwise the
  // earliest detected onset.
  const firstNoteSeconds = predictedNotes.length
    ? Math.min(...predictedNotes.map((n) => n.startSeconds))
    : null
  const anchorSeconds = Number.isFinite(firstNoteSeconds)
    ? firstNoteSeconds
    : (onsets[0]?.seconds ?? 0)
  const { beats, beatPeriodSeconds } = buildBeatGrid({ onsetFrames, frameSeconds, bpm: effectiveTempo.bpm, totalSeconds, anchorSeconds })
  // M3 meter: infer instead of assuming 4/4. An unverified meter keeps the 4/4
  // default for engraving but is reported as uncertain, so callers can say so.
  const meterReading = inferMeter(onsetFrames, frameSeconds, tempo.bpm)
  const beatsPerMeasure = meterReading.uncertain ? 4 : meterReading.meter
  report('harmony', 0.78)
  await yieldToUI()
  if (cancelled()) abort()
  // Chord per beat window from harmonic-view chroma. A3: windows span at
  // least ~1.2 s (fast-tempo beats are melody-dominated alone) and a
  // detected bass root re-picks the winner when close (bass/harmony cue).
  const bassPcPerFrame = harmFrames.map((spectrum, f) => {
    if (f % 2 !== 0) return null
    const b = bassMidi(frames[f], fftSize, sampleRate)
    if (!b || !(b.strength > 1e-7)) return null
    return ((Math.round(b.midiFloat) % 12) + 12) % 12
  })
  const CHORD_WINDOW_SECONDS = 1.2
  const chords = []
  for (let i = 0; i < beats.length; i += 1) {
    const start = beats[i]
    const beatEnd = i + 1 < beats.length ? beats[i + 1] : totalSeconds
    const end = Math.min(totalSeconds, Math.max(beatEnd, start + CHORD_WINDOW_SECONDS))
    const f0 = Math.max(0, Math.floor(start / frameSeconds))
    const f1 = Math.min(harmFrames.length - 1, Math.ceil(end / frameSeconds))
    const acc = new Float64Array(12)
    let count = 0
    for (let f = f0; f <= f1; f += 1) {
      const c = chromaOfSpectrum(harmFrames[f], fftSize, sampleRate)
      for (let k = 0; k < 12; k += 1) acc[k] += c[k]
      count += 1
    }
    if (count > 0) for (let k = 0; k < 12; k += 1) acc[k] /= count
    let rec = recognizeChord(acc)
    // Bass-root prior, gated on a CREDIBLE bass:
    //   (a) sustained — >=4 frames echoing one pitch class,
    //   (b) dominant — >=50% of the window's bass frames,
    //   (c) present — that pitch class carries >=15% of the window's
    //       strongest chroma energy (else drum/low artifacts would re-root).
    // Measured on 5 real mixes: plain prior 0.364 -> 0.408 root accuracy
    // but broke take_five (0.47 -> 0.29); this gate gives 0.413 overall
    // while take_five stays at 0.44. Confidence still passes 0.95.
    const bassVotes = new Array(12).fill(0)
    for (let f = f0; f <= f1; f += 1) {
      const pc = bassPcPerFrame[f]
      if (pc != null) bassVotes[pc] += 1
    }
    const bassTotal = bassVotes.reduce((a, b) => a + b, 0)
    const bassPc = bassVotes.indexOf(Math.max(...bassVotes))
    const maxChroma = Math.max(...acc)
    const credibleBass = bassVotes[bassPc] >= 4
      && bassTotal > 0 && bassVotes[bassPc] / bassTotal >= 0.5
      && maxChroma > 0 && acc[bassPc] >= 0.15 * maxChroma
    if (credibleBass && bassPc !== rec.root) {
      const alt = recognizeChordWithRoot(acc, bassPc)
      if (alt && alt.score >= rec.score * 0.95) rec = alt
    }
    chords.push({
      startSeconds: start,
      endSeconds: Math.round(end * 1000) / 1000,
      ...rec,
      confidence: Math.round(Math.min(1, rec.score) * 100) / 100,
      provenance: PROVENANCE.INFERRED,
    })
  }
  report('sections', 0.85)
  await yieldToUI()
  if (cancelled()) abort()
  const sections = detectSections(frames, frameSeconds, totalSeconds)
  // Harmony voicing from the TRANSCRIBED notes (predicted, never inferred):
  // the chord LABEL is unreliable on mixtures, but the pitch classes the model
  // actually heard are direct evidence. Attach the dominant heard pitch classes
  // per chord window so arrangers voice accompaniment from evidence, and keep
  // the template label only for naming/bass-prior decisions.
  attachHeardVoicings(chords, predictedNotes)
  // Re-recognize each window from a NOTE-DURATION-WEIGHTED chroma when the
  // transcription heard something. Measured on 16 GuitarSet recordings with
  // bar-aligned chord labels: the detected bass agrees with the label root on
  // only 32% of bars (guitar voicings invert), so the spectral chroma - which
  // is dominated by the loudest low partials - is poor root evidence. Notes the
  // model actually attached time to are better evidence: a comping voicing is
  // sustained, a bass line and melodic passing tones are not. Spectral chroma
  // remains the fallback where the transcription heard nothing.
  reRecognizeFromHeardChromas(chords, predictedNotes, CHORD_CHROMA_FROM_NOTES)
  // Downgrade claimed sevenths the transcription did not actually hear
  // (chroma smearing alone must not invent extensions).
  for (const chord of chords) {
    if (!Array.isArray(chord.heardPcs) || !chord.heardPcs.length) continue
    const revised = downgradeUnheardExtension(chord, chord.heardPcs, { enabled: SEVENTH_GUARD_ENABLED })
    if (revised !== chord) {
      chord.root = revised.root
      chord.quality = revised.quality
      chord.label = revised.label
      chord.downgradedFrom = revised.downgradedFrom
    }
  }
  report('done', 1)
  await yieldToUI()
  if (cancelled()) abort()
  const hopSeconds = hop / sampleRate
  return {
    totalSeconds: Math.round(totalSeconds * 1000) / 1000,
    sampleRate,
    tempo: {
      ...effectiveTempo,
      ambiguousTempo: effectiveTempo.source === 'user-override' ? false : (tempo.ambiguousTempo ?? false),
      varies: tempoVaries,
      sectionTempos,
      provenance: PROVENANCE.INFERRED,
    },
    meter: {
      beatsPerMeasure,
      uncertain: meterReading.uncertain,
      scores: meterReading.scores ?? {},
      provenance: PROVENANCE.INFERRED,
    },
    beats: { beats, beatPeriodSeconds, provenance: PROVENANCE.INFERRED },
    onsets,
    chords,
    melody,
    bassLine,
    sections,
    predictedNotes,
    pitchSource,
    frameSeconds,
    hopSeconds,
    spectrum: { fftSize, frameCount: frames.length },
  }
}

/**
 * Drop transcribed notes that no independent detector heard attack.
 *
 * A note is judged only when it is SHORT (it claims to be a new attack): a
 * sustained note inside a legato phrase has no attack of its own and must not
 * be punished for it. The tolerance is generous enough for a soft attack to
 * be seen by the flux detector, and small enough to reject a note that
 * appears between two real attacks.
 */
export function corroborateNotesByOnset(notes, onsets, { maxSustainSeconds = 0.35, toleranceSeconds = 0.07 } = {}) {
  const onsetTimes = (onsets ?? []).map((o) => o?.seconds).filter((s) => Number.isFinite(s))
  if (!notes?.length || !onsetTimes.length) return notes ?? []
  const kept = []
  for (const note of notes) {
    const duration = (note.endSeconds ?? 0) - (note.startSeconds ?? 0)
    if (duration <= maxSustainSeconds) {
      let nearest = Infinity
      for (const onset of onsetTimes) {
        const delta = Math.abs(onset - note.startSeconds)
        if (delta < nearest) nearest = delta
        if (nearest <= toleranceSeconds) break
      }
      if (nearest > toleranceSeconds) continue
    }
    kept.push(note)
  }
  return kept
}

/** Novelty-based section boundaries (self-similarity drop). Inferred, low-stakes. */
/**
 * Attach hearsay-free voicing evidence to each chord window: the pitch classes
 * the pitch model actually transcribed there (weighted by duration), plus the
 * lowest heard pitch class. Falls back to the template tones when the model
 * heard almost nothing (spectral path), so arrangers keep a sane default.
 */
export function attachHeardVoicings(chords, notes) {
  for (const chord of chords) {
    const window = { start: chord.startSeconds, end: chord.endSeconds }
    const heard = notes.filter((n) => n.startSeconds <= window.end - 0.01 && n.endSeconds >= window.start + 0.01)
    if (!heard.length) {
      chord.heardPcs = []
      chord.provenanceVoicing = PROVENANCE.INFERRED
      continue
    }
    const weight = new Map()
    for (const n of heard) {
      const pc = ((n.midi % 12) + 12) % 12
      const overlap = Math.min(n.endSeconds, window.end) - Math.max(n.startSeconds, window.start)
      weight.set(pc, (weight.get(pc) ?? 0) + Math.max(0.05, overlap))
    }
    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([pc]) => pc)
    // Keep the strongest classes that still leave the top note (usually the
    // melody) in place; at most 5 classes, at least 1.
    chord.heardPcs = ranked.slice(0, 5)
    chord.heardBassPc = ranked[ranked.length - 1]
    chord.provenanceVoicing = PROVENANCE.PREDICTED
  }
  return chords
}

/**
 * Re-recognize chords from duration-weighted transcribed pitch classes.
 * Toggle so the effect can be A/B measured end to end (tests, probes).
 */
export const CHORD_CHROMA_FROM_NOTES = true

/**
 * Re-recognize chords from duration-weighted transcribed pitch classes.
 * One pass over the chord windows, using only notes the model transcribed;
 * a window with no notes keeps its spectral recognition untouched.
 */
function reRecognizeFromHeardChromas(chords, notes, enabled = CHORD_CHROMA_FROM_NOTES) {
  if (!enabled) return
  for (const chord of chords) {
    const inWindow = notes.filter((n) => n.startSeconds < chord.endSeconds - 1e-9 && n.endSeconds > chord.startSeconds + 1e-9)
    if (!inWindow.length) continue
    const weights = new Array(12).fill(0)
    let total = 0
    for (const n of inWindow) {
      const p = ((n.midi % 12) + 12) % 12
      const overlap = Math.min(n.endSeconds, chord.endSeconds) - Math.max(n.startSeconds, chord.startSeconds)
      const weight = Math.max(0.05, overlap)
      weights[p] += weight
      total += weight
    }
    if (!(total > 0)) continue
    for (let i = 0; i < 12; i += 1) weights[i] /= total
    const revised = recognizeChord(weights)
    if (!revised) continue
    chord.spectralLabel = chord.label
    chord.spectralRoot = chord.root
    chord.spectralQuality = chord.quality
    chord.root = revised.root
    chord.quality = revised.quality
    chord.label = revised.label
    chord.chromaSource = 'notes'
    // Keep the SPECTRAL recognition's confidence for downstream texture
    // decisions: re-scoring the same window with a different chroma changes the
    // template score's meaning, and selectTexture keys off it. Preserving the
    // original score means improving chord labels cannot silently change the
    // arrangement's texture (and with it, which notes survive).
  }
}

function detectSections(frames, frameSeconds, totalSeconds) {
  if (frames.length < 16) {
    return [{ startSeconds: 0, endSeconds: Math.round(totalSeconds * 1000) / 1000, label: 'A', provenance: PROVENANCE.INFERRED }]
  }
  const step = Math.max(1, Math.floor(frames.length / 64))
  const sampled = frames.filter((_, i) => i % step === 0)
  const novelty = []
  for (let i = 4; i < sampled.length - 4; i += 1) {
    let before = 0
    let after = 0
    for (let k = 1; k <= 4; k += 1) {
      before += cosineDist(sampled[i], sampled[i - k])
      after += cosineDist(sampled[i], sampled[i + k])
    }
    novelty.push({ index: i, value: (before + after) / 8 })
  }
  const mean = novelty.reduce((a, b) => a + b.value, 0) / Math.max(1, novelty.length)
  const boundaries = novelty
    .filter((n) => n.value > mean * 1.6)
    .filter((n, i, arr) => i === 0 || n.index - arr[i - 1].index > 6)
    .slice(0, 6)
    .map((n) => Math.round((n.index * step * frameSeconds) * 1000) / 1000)
    .filter((t) => t > 3 && t < totalSeconds - 3)
    .sort((a, b) => a - b)
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  const points = [0, ...boundaries, Math.round(totalSeconds * 1000) / 1000]
  return points.slice(0, -1).map((start, i) => ({
    startSeconds: start,
    endSeconds: points[i + 1],
    label: labels[i % labels.length],
    provenance: PROVENANCE.INFERRED,
  }))
}

function cosineDist(a, b) {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / (Math.sqrt(na * nb) + 1e-12)
}

/** Fallback: melody contour → note events segmented at onsets. Provenance stays detected-derived. */
export function contourToNotes(melodyFrames, onsets) {
  if (!melodyFrames.length) return []
  const boundaries = new Set(onsets.map((o) => o.seconds))
  const notes = []
  let current = null
  for (const m of melodyFrames) {
    if (!current || boundaries.has(m.seconds) || Math.abs(m.midi - current.midi) > 1.5) {
      if (current) {
        current.endSeconds = m.seconds
        if (current.endSeconds - current.startSeconds >= 0.08) notes.push(current)
      }
      current = { midi: m.midi, startSeconds: m.seconds, endSeconds: m.seconds + 0.15, provenance: PROVENANCE.DETECTED }
    } else {
      current.endSeconds = m.seconds + 0.05
    }
  }
  if (current) {
    if (current.endSeconds - current.startSeconds >= 0.08) notes.push(current)
  }
  return notes
}
