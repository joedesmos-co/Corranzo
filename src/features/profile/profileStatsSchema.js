import { normalizeExerciseType } from './exerciseTypes.js'

export const PROFILE_STATS_VERSION = 1
export const MAX_RECENT_SESSIONS = 20

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function normalizeTimestamp(value) {
  const timestamp = Number(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null
}

export function createEmptyStats() {
  return {
    version: PROFILE_STATS_VERSION,
    totalPracticeSeconds: 0,
    totalSessions: 0,
    manualSessionsCompleted: 0,
    legacyAutoPracticeSeconds: 0,
    legacyAutoSessionsCompleted: 0,
    lastPracticedAt: null,
    pieces: {},
    recentSessions: [],
  }
}

function sumSessionDurations(sessions) {
  return sessions.reduce(
    (sum, session) => sum + nonNegativeNumber(session.durationSeconds),
    0,
  )
}

export function isManualSessionRecord(session) {
  return session?.source === 'manual'
}

export function isLegacyAutoSessionRecord(session) {
  return session?.source !== 'manual'
}

/**
 * Recompute headline totals from stored sessions. Manual sessions drive the
 * primary totals; older automatic sessions are kept separately for display.
 */
export function reconcileProfileStats(stats) {
  const recentSessions = Array.isArray(stats.recentSessions)
    ? stats.recentSessions.map(normalizeSession).filter(Boolean)
    : []
  const manualSessions = recentSessions.filter(isManualSessionRecord)
  const legacyAutoSessions = recentSessions.filter(isLegacyAutoSessionRecord)

  return {
    ...stats,
    version: PROFILE_STATS_VERSION,
    recentSessions,
    totalPracticeSeconds: sumSessionDurations(manualSessions),
    totalSessions: manualSessions.length,
    manualSessionsCompleted: manualSessions.length,
    legacyAutoPracticeSeconds: sumSessionDurations(legacyAutoSessions),
    legacyAutoSessionsCompleted: legacyAutoSessions.length,
    lastPracticedAt: manualSessions[0]?.endedAt ?? null,
  }
}

function normalizeSession(session) {
  if (!isRecord(session)) {
    return null
  }

  const pieceId = String(session.pieceId ?? '').trim()
  if (!pieceId) {
    return null
  }

  const endedAt = normalizeTimestamp(session.endedAt)
  const startedAt = normalizeTimestamp(session.startedAt) ?? endedAt

  const source = session.source === 'manual' ? 'manual' : 'auto'

  return {
    id:
      typeof session.id === 'string' && session.id
        ? session.id
        : `session-${endedAt ?? startedAt ?? 0}-${pieceId}`,
    source,
    pieceId,
    pieceTitle:
      typeof session.pieceTitle === 'string' && session.pieceTitle.trim()
        ? session.pieceTitle.trim().slice(0, 120)
        : 'Untitled piece',
    exerciseType:
      source === 'manual' ? normalizeExerciseType(session.exerciseType) : null,
    notes:
      source === 'manual' && typeof session.notes === 'string'
        ? session.notes.trim().slice(0, 500)
        : '',
    startedAt,
    endedAt,
    durationSeconds: nonNegativeNumber(
      session.durationSeconds ?? session.practiceSecondsActive,
    ),
  }
}

function normalizePieces(rawPieces) {
  if (!isRecord(rawPieces)) {
    return {}
  }

  const pieces = {}
  for (const [key, value] of Object.entries(rawPieces)) {
    if (!isRecord(value)) {
      continue
    }

    const id = String(value.id ?? key).trim()
    if (!id) {
      continue
    }

    pieces[id] = {
      id,
      title:
        typeof value.title === 'string' && value.title.trim()
          ? value.title.trim().slice(0, 120)
          : 'Untitled piece',
      totalPracticeSeconds: nonNegativeNumber(
        value.totalPracticeSeconds ?? value.totalSeconds,
      ),
      totalSessions: nonNegativeNumber(value.totalSessions ?? value.sessionCount),
      lastPracticedAt: normalizeTimestamp(value.lastPracticedAt),
    }
  }

  return pieces
}

export function normalizeStats(raw) {
  if (!isRecord(raw)) {
    return createEmptyStats()
  }

  const recentSessionsSource = Array.isArray(raw.recentSessions)
    ? raw.recentSessions
    : Array.isArray(raw.sessions)
      ? raw.sessions
      : []
  const recentSessions = recentSessionsSource
    .map(normalizeSession)
    .filter(Boolean)
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
    .slice(0, MAX_RECENT_SESSIONS)

  const manualSessions = recentSessions.filter(isManualSessionRecord)
  const legacyAutoSessions = recentSessions.filter(isLegacyAutoSessionRecord)
  const manualPracticeSeconds = sumSessionDurations(manualSessions)
  const legacyAutoPracticeSeconds = sumSessionDurations(legacyAutoSessions)

  return reconcileProfileStats({
    version: PROFILE_STATS_VERSION,
    totalPracticeSeconds: manualPracticeSeconds,
    totalSessions: manualSessions.length,
    manualSessionsCompleted: manualSessions.length,
    legacyAutoPracticeSeconds,
    legacyAutoSessionsCompleted: legacyAutoSessions.length,
    lastPracticedAt:
      manualSessions[0]?.endedAt ?? normalizeTimestamp(raw.lastPracticedAt),
    pieces: normalizePieces(raw.pieces),
    recentSessions,
  })
}
