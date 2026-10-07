import { normalizeInstrumentId } from '../instruments/instruments.js'
import { loadStats, loadStatsWithStatus, saveStats } from './profileStorage.js'
import { MAX_RECENT_SESSIONS, reconcileProfileStats } from './profileStatsSchema.js'
import { resolveCanonicalPieceId, titleAliasKey } from './pieceIdentity.js'

export const AUTO_CHECKPOINT_KEY = 'scoreflow-auto-checkpoint-v1'

let activeSession = null
let lastTickAt = null

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function resolvePracticePieceId({
  pdfFingerprint = null,
  pdfFileName = null,
  musicXmlFileName = null,
}) {
  const { pieceId } = resolveCanonicalPieceId({ pdfFingerprint, pdfFileName, musicXmlFileName })
  return pieceId
}

function normalizePieceTitle(title) {
  if (typeof title === 'string' && title.trim()) {
    return title.trim().slice(0, 120)
  }
  return 'Untitled piece'
}

function readCheckpoint() {
  try {
    const storage = getLocalStorage()
    if (!storage) {
      return null
    }
    const raw = storage.getItem(AUTO_CHECKPOINT_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.pieceId) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCheckpoint() {
  try {
    const storage = getLocalStorage()
    if (!storage || !activeSession) {
      return
    }
    storage.setItem(
      AUTO_CHECKPOINT_KEY,
      JSON.stringify({
        pieceId: activeSession.pieceId,
        pieceTitle: activeSession.pieceTitle,
        instrumentId: activeSession.instrumentId,
        startedAt: activeSession.startedAt,
        accumulatedSeconds: activeSession.accumulatedSeconds,
        measuresVisited: [...activeSession.measuresVisited],
        loopsCompleted: activeSession.loopsCompleted,
        tempoBpm: activeSession.tempoBpm,
        wfyCorrect: activeSession.wfyCorrect,
        wfyMissed: activeSession.wfyMissed,
        wfySkipped: activeSession.wfySkipped,
        wfyManualContinues: activeSession.wfyManualContinues,
        practiceMode: activeSession.practiceMode ?? null,
        updatedAt: Date.now(),
      }),
    )
  } catch {
    // ignore checkpoint write failures; in-memory session still tracks
  }
}

function clearCheckpoint() {
  try {
    getLocalStorage()?.removeItem(AUTO_CHECKPOINT_KEY)
  } catch {
    // ignore
  }
}

export function loadAutoCheckpoint() {
  return readCheckpoint()
}

export function beginAutoPracticeSession(piece, { instrumentId = null, practiceMode = null } = {}) {
  const id = String(piece?.id ?? '').trim()
  if (!id) {
    activeSession = null
    lastTickAt = null
    return null
  }

  // Reload safety: resume durable checkpoint for the same piece instead of
  // silently dropping the active segment. The reload gap itself is not added.
  const checkpoint = readCheckpoint()
  const normalizedInstrument = normalizeInstrumentId(instrumentId)
  if (checkpoint && checkpoint.pieceId === id) {
    activeSession = {
      pieceId: id,
      pieceTitle: normalizePieceTitle(piece.title ?? checkpoint.pieceTitle),
      instrumentId: normalizedInstrument,
      startedAt: Number(checkpoint.startedAt) > 0 ? Number(checkpoint.startedAt) : Date.now(),
      accumulatedSeconds: Math.max(0, Math.floor(Number(checkpoint.accumulatedSeconds) || 0)),
      measuresVisited: new Set(
        Array.isArray(checkpoint.measuresVisited) ? checkpoint.measuresVisited : [],
      ),
      loopsCompleted: Math.max(0, Math.floor(Number(checkpoint.loopsCompleted) || 0)),
      tempoBpm: Number.isFinite(Number(checkpoint.tempoBpm)) ? Math.round(Number(checkpoint.tempoBpm)) : null,
      wfyCorrect: Math.max(0, Math.floor(Number(checkpoint.wfyCorrect) || 0)),
      wfyMissed: Math.max(0, Math.floor(Number(checkpoint.wfyMissed) || 0)),
      wfySkipped: Math.max(0, Math.floor(Number(checkpoint.wfySkipped) || 0)),
      wfyManualContinues: Math.max(0, Math.floor(Number(checkpoint.wfyManualContinues) || 0)),
      practiceMode: typeof practiceMode === 'string' ? practiceMode : checkpoint.practiceMode ?? null,
    }
  } else {
    activeSession = {
      pieceId: id,
      pieceTitle: normalizePieceTitle(piece.title),
      instrumentId: normalizedInstrument,
      startedAt: Date.now(),
      accumulatedSeconds: 0,
      measuresVisited: new Set(),
      loopsCompleted: 0,
      tempoBpm: null,
      wfyCorrect: 0,
      wfyMissed: 0,
      wfySkipped: 0,
      wfyManualContinues: 0,
      practiceMode: typeof practiceMode === 'string' ? practiceMode : null,
    }
  }
  lastTickAt = Date.now()
  writeCheckpoint()
  return snapshotActiveSession()
}

export function snapshotActiveSession() {
  if (!activeSession) {
    return null
  }
  return {
    pieceId: activeSession.pieceId,
    pieceTitle: activeSession.pieceTitle,
    instrumentId: activeSession.instrumentId,
    startedAt: activeSession.startedAt,
    practiceSeconds: activeSession.accumulatedSeconds,
    measuresPlayed: activeSession.measuresVisited.size,
    loopsCompleted: activeSession.loopsCompleted,
    tempoBpm: activeSession.tempoBpm,
    wfyCorrect: activeSession.wfyCorrect,
    wfyMissed: activeSession.wfyMissed,
    wfySkipped: activeSession.wfySkipped,
    wfyManualContinues: activeSession.wfyManualContinues,
  }
}

export function tickAutoPracticeSession() {
  if (!activeSession || !lastTickAt) {
    return 0
  }
  const now = Date.now()
  const delta = Math.floor((now - lastTickAt) / 1000)
  if (delta >= 1) {
    activeSession.accumulatedSeconds += delta
    lastTickAt = now
    writeCheckpoint()
  }
  return activeSession.accumulatedSeconds
}

/** Durably persist the current active segment without ending it (reload/background safe). */
export function checkpointAutoPracticeSession() {
  if (!activeSession) {
    return 0
  }
  tickAutoPracticeSession()
  writeCheckpoint()
  return activeSession.accumulatedSeconds
}

export function recordAutoPracticeMeasure(measureNumber) {
  if (!activeSession || measureNumber == null) {
    return
  }
  activeSession.measuresVisited.add(measureNumber)
  writeCheckpoint()
}

export function recordAutoPracticeLoop() {
  if (!activeSession) {
    return
  }
  activeSession.loopsCompleted += 1
  writeCheckpoint()
}

export function recordAutoPracticeTempo(bpm) {
  if (!activeSession || !Number.isFinite(bpm) || bpm <= 0) {
    return
  }
  activeSession.tempoBpm = Math.round(bpm)
  writeCheckpoint()
}

export function recordWfyPracticeEvent(type) {
  if (!activeSession) {
    return
  }
  switch (type) {
    case 'correct':
      activeSession.wfyCorrect += 1
      break
    case 'missed':
      activeSession.wfyMissed += 1
      break
    case 'skipped':
      activeSession.wfySkipped += 1
      break
    case 'manual-continue':
      activeSession.wfyManualContinues += 1
      break
    default:
      break
  }
  writeCheckpoint()
}

function applySessionToStats(stats, session) {
  const pieceId = session.pieceId
  const existing = stats.pieces[pieceId] ?? {
    id: pieceId,
    title: session.pieceTitle,
  }
  const endedAt = Date.now()
  const duration = Math.max(0, Math.floor(Number(session.accumulatedSeconds) || 0))
  const instrumentId = normalizeInstrumentId(session.instrumentId)
  const secondsByInstrument = { ...(stats.autoPracticeSecondsByInstrument ?? {}) }
  secondsByInstrument[instrumentId] = (secondsByInstrument[instrumentId] ?? 0) + duration
  const lastByInstrument = { ...(stats.lastAutoPracticedAtByInstrument ?? {}) }
  lastByInstrument[instrumentId] = endedAt
  const pieceSecondsByInstrument = { ...(existing.autoPracticeSecondsByInstrument ?? {}) }
  pieceSecondsByInstrument[instrumentId] =
    (pieceSecondsByInstrument[instrumentId] ?? 0) + duration
  const pieceLastByInstrument = { ...(existing.lastPracticedAtByInstrument ?? {}) }
  pieceLastByInstrument[instrumentId] = endedAt

  const autoSession = {
    id: `auto-${session.startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'auto',
    pieceId,
    pieceTitle: session.pieceTitle,
    instrumentId,
    startedAt: session.startedAt,
    endedAt,
    durationSeconds: duration,
    practiceMode: session.practiceMode ?? null,
    measuresVisited: session.measuresVisited.size,
    measuresPlayed: session.measuresVisited.size,
    loopsCompleted: session.loopsCompleted,
    tempoBpm: session.tempoBpm,
    wfyCorrect: session.wfyCorrect,
    wfyMissed: session.wfyMissed,
    wfySkipped: session.wfySkipped,
    wfyManualContinues: session.wfyManualContinues,
    completed: true,
  }

  const aliasSlug = titleAliasKey(session.pieceTitle) ?? slugify(session.pieceTitle)
  const pieceTitleAliases = { ...(stats.pieceTitleAliases ?? {}) }
  if (aliasSlug) {
    pieceTitleAliases[aliasSlug] = pieceId
  }

  return reconcileProfileStats({
    ...stats,
    autoPracticeSeconds: (stats.autoPracticeSeconds ?? 0) + duration,
    autoPracticeSecondsByInstrument: secondsByInstrument,
    lastAutoPracticedAt: endedAt,
    lastAutoPracticedAtByInstrument: lastByInstrument,
    pieces: {
      ...stats.pieces,
      [pieceId]: {
        ...existing,
        id: pieceId,
        title: session.pieceTitle,
        autoPracticeSeconds: (existing.autoPracticeSeconds ?? 0) + duration,
        autoPracticeSecondsByInstrument: pieceSecondsByInstrument,
        autoPracticeInstrumentBreakdownEstimated: false,
        measuresPlayed:
          (existing.measuresPlayed ?? 0) + session.measuresVisited.size,
        loopsCompleted: (existing.loopsCompleted ?? 0) + session.loopsCompleted,
        lastTempoBpm: session.tempoBpm ?? existing.lastTempoBpm ?? null,
        wfyCorrect: (existing.wfyCorrect ?? 0) + session.wfyCorrect,
        wfyMissed: (existing.wfyMissed ?? 0) + session.wfyMissed,
        wfySkipped: (existing.wfySkipped ?? 0) + session.wfySkipped,
        lastPracticedAt: endedAt,
        lastPracticedAtByInstrument: pieceLastByInstrument,
        lastInstrumentId: normalizeInstrumentId(session.instrumentId),
        totalPracticeSeconds: existing.totalPracticeSeconds ?? 0,
        totalSessions: existing.totalSessions ?? 0,
      },
    },
    recentSessions: [autoSession, ...(stats.recentSessions ?? [])]
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, MAX_RECENT_SESSIONS),
    pieceTitleAliases,
  })
}

export function tryEndAutoPracticeSession() {
  tickAutoPracticeSession()
  if (!activeSession) {
    return { ok: true, stats: loadStats(), session: null }
  }
  const sessionSnapshot = activeSession
  const stats = loadStatsWithStatus().stats
  const next = applySessionToStats(stats, sessionSnapshot)
  if (saveStats(next)) {
    activeSession = null
    lastTickAt = null
    clearCheckpoint()
    return { ok: true, stats: next, session: sessionSnapshot }
  }
  // Truthful failure: keep the checkpoint so the active segment is not
  // silently dropped; caller can retry.
  writeCheckpoint()
  return { ok: false, stats: loadStats(), error: 'storage-full', session: sessionSnapshot }
}

export function endAutoPracticeSession() {
  const result = tryEndAutoPracticeSession()
  return result.stats
}

/** Test helper — reset in-memory session without touching storage. */
export function __resetAutoPracticeSession() {
  activeSession = null
  lastTickAt = null
}

/** Test helper — clear durable checkpoint without touching stats. */
export function __clearAutoCheckpointForTest() {
  clearCheckpoint()
}
