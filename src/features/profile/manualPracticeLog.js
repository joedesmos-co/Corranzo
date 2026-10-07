import { normalizeExerciseType } from './exerciseTypes.js'
import { normalizeInstrumentId } from '../instruments/instruments.js'
import { loadStats, loadStatsWithStatus, saveStats } from './profileStorage.js'
import { MAX_RECENT_SESSIONS, reconcileProfileStats } from './profileStatsSchema.js'
import {
  resolveCanonicalPieceId,
  slugifyPieceTitle,
  titleAliasKey,
} from './pieceIdentity.js'

export const MANUAL_PENDING_KEY = 'scoreflow-manual-pending-v1'

function normalizePieceTitle(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 120)
  }
  return 'Practice session'
}

function legacyManualPieceId(title) {
  const slug = String(title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug ? `manual:${slug}` : 'manual:practice-session'
}

/** Canonical piece id for new manual saves (unified with auto ledger). */
export function manualPieceId(title) {
  const { pieceId } = resolveCanonicalPieceId({ pieceTitle: title })
  return pieceId ?? 'piece:practice-session'
}

function normalizeNotes(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, 500)
}

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function readPendingManual() {
  try {
    const storage = getLocalStorage()
    if (!storage) {
      return null
    }
    const raw = storage.getItem(MANUAL_PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writePendingManual(pending) {
  try {
    const storage = getLocalStorage()
    if (!storage) {
      return
    }
    if (!pending) {
      storage.removeItem(MANUAL_PENDING_KEY)
      return
    }
    storage.setItem(MANUAL_PENDING_KEY, JSON.stringify(pending))
  } catch {
    // ignore pending-write failures; in-memory form still preserves work
  }
}

export function loadPendingManualSession() {
  const pending = readPendingManual()
  if (!pending || typeof pending !== 'object') {
    return null
  }
  return pending
}

export function clearPendingManualSession() {
  writePendingManual(null)
}

function resolveJoinPieceId(stats, title, explicitPieceId) {
  if (explicitPieceId && String(explicitPieceId).trim()) {
    const { pieceId } = resolveCanonicalPieceId({ pieceId: explicitPieceId, pieceTitle: title })
    return pieceId
  }
  const slug = slugifyPieceTitle(title)
  const alias = slug ? stats.pieceTitleAliases?.[slug] : null
  if (alias && stats.pieces?.[alias]) {
    return alias
  }
  // Join on matching title slug across existing pieces (manual + auto share
  // the canonical namespace after migration).
  if (slug) {
    for (const piece of Object.values(stats.pieces ?? {})) {
      if (slugifyPieceTitle(piece.title) === slug) {
        return piece.id
      }
    }
    // Legacy manual: entries migrate to piece: on load; also check raw manual:.
    const legacyId = `manual:${slug}`
    if (stats.pieces?.[legacyId]) {
      return stats.pieces[legacyId].id ?? `piece:${slug}`
    }
  }
  const { pieceId } = resolveCanonicalPieceId({ pieceTitle: title })
  return pieceId ?? 'piece:practice-session'
}

export function trySaveManualSession({
  pieceTitle,
  exerciseType,
  notes = '',
  durationSeconds,
  startedAt,
  endedAt = Date.now(),
  instrumentId = null,
  pieceId = null,
  practiceMode = null,
}) {
  const loaded = loadStatsWithStatus()
  const stats = loaded.stats
  const duration = Number(durationSeconds)
  const normalizedDuration = Math.floor(duration)
  if (!Number.isFinite(duration) || normalizedDuration < 1) {
    return { ok: false, stats, error: 'invalid-duration', session: null }
  }

  const title = normalizePieceTitle(pieceTitle)
  const resolvedPieceId = resolveJoinPieceId(stats, title, pieceId)
  const endedAtTimestamp = Number(endedAt)
  const startedAtTimestamp = Number(startedAt)
  const safeEndedAt =
    Number.isFinite(endedAtTimestamp) && endedAtTimestamp > 0
      ? endedAtTimestamp
      : Date.now()
  const safeStartedAt =
    Number.isFinite(startedAtTimestamp) && startedAtTimestamp > 0
      ? startedAtTimestamp
      : safeEndedAt - normalizedDuration * 1000

  const normalizedInstrumentId = normalizeInstrumentId(instrumentId)
  const session = {
    id: `manual-${safeEndedAt}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'manual',
    pieceId: resolvedPieceId,
    pieceTitle: title,
    instrumentId: normalizedInstrumentId,
    exerciseType: normalizeExerciseType(exerciseType),
    notes: normalizeNotes(notes),
    startedAt: safeStartedAt,
    endedAt: safeEndedAt,
    durationSeconds: normalizedDuration,
    practiceMode: typeof practiceMode === 'string' ? practiceMode.slice(0, 40) : null,
    completed: true,
  }

  const existingPiece = stats.pieces[resolvedPieceId]
  const piece = {
    id: resolvedPieceId,
    title,
    totalPracticeSeconds:
      (existingPiece?.totalPracticeSeconds ?? 0) + normalizedDuration,
    totalSessions: (existingPiece?.totalSessions ?? 0) + 1,
    lastPracticedAt: safeEndedAt,
    lastInstrumentId: normalizedInstrumentId,
    autoPracticeSeconds: existingPiece?.autoPracticeSeconds ?? 0,
    autoPracticeSecondsByInstrument: existingPiece?.autoPracticeSecondsByInstrument ?? {},
    autoPracticeInstrumentBreakdownEstimated:
      existingPiece?.autoPracticeInstrumentBreakdownEstimated ?? false,
    measuresPlayed: existingPiece?.measuresPlayed ?? 0,
    loopsCompleted: existingPiece?.loopsCompleted ?? 0,
    lastTempoBpm: existingPiece?.lastTempoBpm ?? null,
    wfyCorrect: existingPiece?.wfyCorrect ?? 0,
    wfyMissed: existingPiece?.wfyMissed ?? 0,
    wfySkipped: existingPiece?.wfySkipped ?? 0,
    lastPracticedAtByInstrument: existingPiece?.lastPracticedAtByInstrument ?? {},
  }

  const aliasSlug = titleAliasKey(title)
  const pieceTitleAliases = { ...(stats.pieceTitleAliases ?? {}) }
  if (aliasSlug) {
    pieceTitleAliases[aliasSlug] = resolvedPieceId
  }

  const manualPracticeSecondsByInstrument = { ...(stats.manualPracticeSecondsByInstrument ?? {}) }
  manualPracticeSecondsByInstrument[normalizedInstrumentId] =
    (manualPracticeSecondsByInstrument[normalizedInstrumentId] ?? 0) + normalizedDuration
  const manualSessionsByInstrument = { ...(stats.manualSessionsByInstrument ?? {}) }
  manualSessionsByInstrument[normalizedInstrumentId] =
    (manualSessionsByInstrument[normalizedInstrumentId] ?? 0) + 1

  const nextStats = reconcileProfileStats({
    ...stats,
    totalSessions: (stats.totalSessions ?? 0) + 1,
    totalPracticeSeconds: (stats.totalPracticeSeconds ?? 0) + normalizedDuration,
    manualSessionsCompleted: (stats.manualSessionsCompleted ?? 0) + 1,
    manualPracticeSecondsByInstrument,
    manualSessionsByInstrument,
    lastPracticedAt: safeEndedAt,
    pieces: {
      ...stats.pieces,
      [piece.id]: piece,
    },
    recentSessions: [session, ...(stats.recentSessions ?? [])]
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, MAX_RECENT_SESSIONS),
    pieceTitleAliases,
  })

  if (saveStats(nextStats)) {
    writePendingManual(null)
    return { ok: true, stats: nextStats, error: null, session }
  }
  // Truthful failure: preserve last-good (saveStats keeps backup) and keep
  // the pending session for retry instead of reporting false success.
  writePendingManual({ session, savedAt: Date.now() })
  return { ok: false, stats: loadStats(), error: 'storage-full', session }
}

export function saveManualSession(details) {
  const result = trySaveManualSession(details)
  // Legacy callers expect the stats object. On failure return the persisted
  // (last-good) stats so the returned totals do not falsely include the
  // unsaved session.
  return result.stats
}

export function isManualSession(session) {
  return session?.source === 'manual'
}

export function isAutoSession(session) {
  return session?.source !== 'manual'
}

// Kept for migration/tests: legacy manual: ids remain readable.
export function __legacyManualPieceIdForTest(title) {
  return legacyManualPieceId(title)
}
