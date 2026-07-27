/**
 * ActiveScore — single source of truth for the currently open score.
 *
 * Phase 1: App still owns pdf/midi/musicXml React state; activeScore is built
 * from those fields and published for derived systems + DEV/E2E.
 *
 * Later phases migrate consumers to read only from activeScore, then remove
 * the duplicate React fields.
 *
 * Invariant: companions (musicXml, midi) must carry ownerScoreId === scoreId.
 * Re-parenting foreign MusicXML onto a new PDF identity is forbidden.
 */

import {
  contentIdentitySync,
  describeMusicXmlContent,
  describePdfContent,
  pushScoreSourceContentTrace,
} from '../library/scoreSourceContentIdentity.js'
import { buildPdfSourceIdentity } from '../library/scoreSourceReplacement.js'
import { getActiveScoreSourceGeneration } from '../library/scoreSourceGenerationGate.js'

let scoreIdCounter = 0

export function createScoreId() {
  scoreIdCounter += 1
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `s${Date.now().toString(36)}-${scoreIdCounter}`
  return `score-${rand}`
}

export function createEmptyActiveScore({ generation = 0 } = {}) {
  return {
    scoreId: null,
    generation: Number.isFinite(generation) ? generation : 0,
    pdf: null,
    musicXml: null,
    midi: null,
    activeOmrRunId: null,
  }
}

/**
 * Build PDF slice from App-level fields. identity prefers content hash when
 * buffer is available; metaIdentity remains for score-follow fingerprints.
 */
export function buildActiveScorePdf({
  pdfFile = null,
  pdfBuffer = null,
  pdfMeta = null,
  fileName = '',
} = {}) {
  if (!pdfFile && !pdfBuffer && !pdfMeta) {
    return null
  }
  const described = describePdfContent(pdfMeta, pdfBuffer)
  const metaIdentity = buildPdfSourceIdentity(pdfMeta)
  return {
    identity: described.contentHash ?? metaIdentity ?? null,
    metaIdentity: metaIdentity ?? described.metaIdentity ?? null,
    contentHash: described.contentHash ?? null,
    blobUrl: pdfFile ?? null,
    buffer: pdfBuffer ?? null,
    fileName: pdfMeta?.fileName ?? fileName ?? null,
    meta: pdfMeta ?? null,
  }
}

export function buildActiveScoreMusicXml(musicXmlSource, ownerScoreId = null) {
  if (!musicXmlSource?.data) {
    return null
  }
  const described = describeMusicXmlContent(musicXmlSource)
  const resolvedOwner =
    musicXmlSource.ownerScoreId ?? ownerScoreId ?? null
  return {
    ownerScoreId: resolvedOwner,
    ownerPdfIdentity: musicXmlSource.ownerPdfIdentity ?? null,
    hash: described.contentHash ?? null,
    sourceType: musicXmlSource.source ?? null,
    data: musicXmlSource.data,
    fileName: musicXmlSource.fileName ?? null,
    omrMeta: musicXmlSource.omrMeta ?? null,
    // Keep the legacy companion object for gradual migration.
    legacySource: musicXmlSource,
  }
}

export function buildActiveScoreMidi(midiSource, ownerScoreId = null) {
  if (!midiSource?.data) {
    return null
  }
  const hash = contentIdentitySync(midiSource.data)?.hash ?? null
  return {
    ownerScoreId: midiSource.ownerScoreId ?? ownerScoreId ?? null,
    ownerPdfIdentity: midiSource.ownerPdfIdentity ?? null,
    hash,
    data: midiSource.data,
    fileName: midiSource.fileName ?? null,
    legacySource: midiSource,
  }
}

/**
 * Synchronize activeScore from legacy App fields.
 *
 * - New PDF identity (or first PDF) → new scoreId (do not mutate prior score).
 * - Same PDF identity → keep scoreId; refresh companions.
 * - Companions whose ownerScoreId disagrees with scoreId are dropped (not re-parented).
 */
export function syncActiveScoreFromLegacy(
  previousScore,
  {
    pdfFile = null,
    pdfBuffer = null,
    pdfMeta = null,
    fileName = '',
    musicXmlSource = null,
    midiSource = null,
    generation = 0,
    activeOmrRunId = null,
  } = {},
) {
  const pdf = buildActiveScorePdf({ pdfFile, pdfBuffer, pdfMeta, fileName })
  const generationValue = Number.isFinite(generation) ? generation : 0

  if (!pdf) {
    return createEmptyActiveScore({ generation: generationValue })
  }

  const pdfKey = pdf.identity ?? pdf.metaIdentity
  const previousKey =
    previousScore?.pdf?.identity ?? previousScore?.pdf?.metaIdentity ?? null
  const pdfChanged = !previousScore?.scoreId || previousKey !== pdfKey
  const scoreId = pdfChanged ? createScoreId() : previousScore.scoreId

  let musicXml = buildActiveScoreMusicXml(musicXmlSource, scoreId)
  let midi = buildActiveScoreMidi(midiSource, scoreId)

  if (pdfChanged) {
    // Atomic replacement: never carry A companions onto a new B scoreId unless
    // they already declare ownership of B's PDF meta identity (library/upload pair).
    const xmlOwnsPdf =
      musicXml?.ownerPdfIdentity &&
      pdf.metaIdentity &&
      musicXml.ownerPdfIdentity === pdf.metaIdentity
    const xmlOwnsScore = musicXmlSource?.ownerScoreId === scoreId
    if (!xmlOwnsPdf && !xmlOwnsScore) {
      musicXml = null
    }
    const midiOwnsPdf =
      midi?.ownerPdfIdentity &&
      pdf.metaIdentity &&
      midi.ownerPdfIdentity === pdf.metaIdentity
    const midiOwnsScore = midiSource?.ownerScoreId === scoreId
    if (!midiOwnsPdf && !midiOwnsScore) {
      midi = null
    }
  }

  // Drop companions that belong to another score — never re-parent.
  if (musicXml?.ownerScoreId && musicXml.ownerScoreId !== scoreId) {
    musicXml = null
  }
  if (
    musicXml &&
    !musicXmlSource?.ownerScoreId &&
    musicXml.ownerPdfIdentity &&
    pdf.metaIdentity &&
    musicXml.ownerPdfIdentity !== pdf.metaIdentity
  ) {
    musicXml = null
  }

  if (midi?.ownerScoreId && midi.ownerScoreId !== scoreId) {
    midi = null
  }
  if (
    midi &&
    !midiSource?.ownerScoreId &&
    midi.ownerPdfIdentity &&
    pdf.metaIdentity &&
    midi.ownerPdfIdentity !== pdf.metaIdentity
  ) {
    midi = null
  }

  // Stamp ownerScoreId onto accepted companions so derived systems can check.
  if (musicXml && !musicXml.ownerScoreId) {
    musicXml = { ...musicXml, ownerScoreId: scoreId }
  }
  if (midi && !midi.ownerScoreId) {
    midi = { ...midi, ownerScoreId: scoreId }
  }

  return {
    scoreId,
    generation: generationValue,
    pdf,
    musicXml,
    midi,
    activeOmrRunId:
      activeOmrRunId ?? getActiveScoreSourceGeneration().activeOmrRunId ?? null,
  }
}

/** Attach MusicXML to an existing activeScore (same scoreId). Rejects foreign owners. */
export function withActiveScoreMusicXml(activeScore, musicXmlSource, { allowReparent = false } = {}) {
  if (!activeScore?.scoreId) {
    return activeScore
  }
  if (!musicXmlSource?.data) {
    return { ...activeScore, musicXml: null }
  }
  const ownerScoreId = musicXmlSource.ownerScoreId ?? activeScore.scoreId
  if (!allowReparent && musicXmlSource.ownerScoreId && musicXmlSource.ownerScoreId !== activeScore.scoreId) {
    return activeScore
  }
  const stamped = {
    ...musicXmlSource,
    ownerScoreId,
  }
  return {
    ...activeScore,
    musicXml: buildActiveScoreMusicXml(stamped, activeScore.scoreId),
  }
}

export function withActiveScoreMidi(activeScore, midiSource, { allowReparent = false } = {}) {
  if (!activeScore?.scoreId) {
    return activeScore
  }
  if (!midiSource?.data) {
    return { ...activeScore, midi: null }
  }
  const ownerScoreId = midiSource.ownerScoreId ?? activeScore.scoreId
  if (!allowReparent && midiSource.ownerScoreId && midiSource.ownerScoreId !== activeScore.scoreId) {
    return activeScore
  }
  const stamped = {
    ...midiSource,
    ownerScoreId,
  }
  return {
    ...activeScore,
    midi: buildActiveScoreMidi(stamped, activeScore.scoreId),
  }
}

export function withActiveScoreOmrRunId(activeScore, activeOmrRunId) {
  if (!activeScore) {
    return activeScore
  }
  return { ...activeScore, activeOmrRunId: activeOmrRunId ?? null }
}

export function describeActiveScore(activeScore) {
  if (!activeScore?.scoreId) {
    return {
      scoreId: null,
      generation: activeScore?.generation ?? 0,
      pdfHash: null,
      pdfMetaIdentity: null,
      musicXmlHash: null,
      musicXmlOwnerScoreId: null,
      midiHash: null,
      activeOmrRunId: null,
    }
  }
  return {
    scoreId: activeScore.scoreId,
    generation: activeScore.generation,
    pdfHash: activeScore.pdf?.contentHash ?? activeScore.pdf?.identity ?? null,
    pdfMetaIdentity: activeScore.pdf?.metaIdentity ?? null,
    musicXmlHash: activeScore.musicXml?.hash ?? null,
    musicXmlOwnerScoreId: activeScore.musicXml?.ownerScoreId ?? null,
    midiHash: activeScore.midi?.hash ?? null,
    activeOmrRunId: activeScore.activeOmrRunId ?? null,
  }
}

export function logActiveScoreChange(reason, activeScore) {
  const described = describeActiveScore(activeScore)
  const line = [
    'ACTIVE SCORE:',
    `scoreId=${described.scoreId}`,
    `generation=${described.generation}`,
    `PDF hash=${described.pdfHash}`,
    `MusicXML hash=${described.musicXmlHash}`,
    `MusicXML ownerScoreId=${described.musicXmlOwnerScoreId}`,
    `MIDI hash=${described.midiHash}`,
    `OMR runId=${described.activeOmrRunId}`,
    `reason=${reason}`,
  ].join(' ')
  pushScoreSourceContentTrace('active-score-changed', { reason, ...described })
  try {
    console.info(line)
  } catch {
    // ignore
  }
  return described
}

export function publishActiveScore(activeScore, { reason = 'sync' } = {}) {
  if (typeof window === 'undefined') {
    return describeActiveScore(activeScore)
  }
  const described = describeActiveScore(activeScore)
  window.__SCOREFLOW_ACTIVE_SCORE__ = {
    ...described,
    // Full mirrors for E2E content asserts (no ArrayBuffers in logs).
    hasPdf: Boolean(activeScore?.pdf?.buffer || activeScore?.pdf?.blobUrl),
    hasMusicXml: Boolean(activeScore?.musicXml?.data),
    hasMidi: Boolean(activeScore?.midi?.data),
    musicXmlSourceType: activeScore?.musicXml?.sourceType ?? null,
    measureCount: activeScore?.musicXml?.omrMeta?.measureCount ?? null,
    durationSeconds: activeScore?.musicXml?.omrMeta?.durationSeconds ?? null,
    noteCount: activeScore?.musicXml?.omrMeta?.noteCount ?? null,
    at: Date.now(),
    reason,
  }
  return described
}

/**
 * DEV: throw when a derived object belongs to a different score than activeScore.
 * Production: returns { ok:false } without throwing.
 */
export function assertDerivedBelongsToActiveScore(derived, activeScore, label = 'derived') {
  const derivedOwner = derived?.ownerScoreId ?? null
  const activeId = activeScore?.scoreId ?? null
  if (!activeId) {
    return { ok: false, reason: 'no-active-score' }
  }
  if (!derivedOwner) {
    return { ok: false, reason: 'missing-ownerScoreId' }
  }
  if (derivedOwner !== activeId) {
    const message = `[ActiveScore] ${label} ownerScoreId=${derivedOwner} !== activeScore.scoreId=${activeId}`
    if (import.meta.env?.DEV) {
      throw new Error(message)
    }
    try {
      console.error(message)
    } catch {
      // ignore
    }
    return { ok: false, reason: 'owner-mismatch', message }
  }
  return { ok: true }
}

export function logPlaybackSourceCheck({
  activeScore = null,
  playbackOwnerScoreId = null,
  musicXmlHash = null,
} = {}) {
  const activeId = activeScore?.scoreId ?? null
  const line = [
    'PLAYBACK SOURCE:',
    `activeScoreId=${activeId}`,
    `playbackOwnerScoreId=${playbackOwnerScoreId}`,
    `MusicXML hash=${musicXmlHash ?? activeScore?.musicXml?.hash ?? null}`,
  ].join(' ')
  pushScoreSourceContentTrace('playback-source-check', {
    activeScoreId: activeId,
    playbackOwnerScoreId,
    musicXmlHash: musicXmlHash ?? activeScore?.musicXml?.hash ?? null,
  })
  try {
    console.info(line)
  } catch {
    // ignore
  }
  if (
    import.meta.env?.DEV &&
    activeId &&
    playbackOwnerScoreId &&
    activeId !== playbackOwnerScoreId
  ) {
    throw new Error(
      `[ActiveScore] PLAYBACK SOURCE mismatch active=${activeId} playback=${playbackOwnerScoreId}`,
    )
  }
  return {
    activeScoreId: activeId,
    playbackOwnerScoreId,
    aligned: Boolean(activeId && playbackOwnerScoreId && activeId === playbackOwnerScoreId),
  }
}

/** Stamp ownerScoreId onto a legacy MusicXML companion before setState. */
export function stampMusicXmlOwnerScoreId(musicXmlSource, scoreId) {
  if (!musicXmlSource?.data || !scoreId) {
    return musicXmlSource
  }
  return {
    ...musicXmlSource,
    ownerScoreId: scoreId,
  }
}

export function stampMidiOwnerScoreId(midiSource, scoreId) {
  if (!midiSource?.data || !scoreId) {
    return midiSource
  }
  return {
    ...midiSource,
    ownerScoreId: scoreId,
  }
}
