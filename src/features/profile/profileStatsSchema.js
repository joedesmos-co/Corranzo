import { normalizeExerciseType } from './exerciseTypes.js'
import {
  isSupportedInstrumentId,
  normalizeInstrumentId,
} from '../instruments/instruments.js'

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
    autoPracticeSeconds: 0,
    autoPracticeSecondsByInstrument: {},
    lastAutoPracticedAt: null,
    lastAutoPracticedAtByInstrument: {},
    lastPracticedAt: null,
    pieces: {},
    recentSessions: [],
  }
}

/**
 * Per-instrument counter map ({ piano: n, guitar: n }). Unsupported keys are
 * dropped; when the map is missing entirely, legacy global auto seconds are
 * attributed to piano (every pre-instrument session was piano).
 */
function normalizeInstrumentNumberMap(raw, { legacyPianoValue = 0 } = {}) {
  const map = {}
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!isSupportedInstrumentId(key)) {
        continue
      }
      const amount = nonNegativeNumber(value)
      if (amount > 0) {
        map[key] = amount
      }
    }
    return map
  }
  if (legacyPianoValue > 0) {
    map.piano = legacyPianoValue
  }
  return map
}

function normalizeInstrumentTimestampMap(raw, { legacyPianoValue = null } = {}) {
  const map = {}
  if (isRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!isSupportedInstrumentId(key)) {
        continue
      }
      const timestamp = normalizeTimestamp(value)
      if (timestamp != null) {
        map[key] = timestamp
      }
    }
    return map
  }
  const legacy = normalizeTimestamp(legacyPianoValue)
  if (legacy != null) {
    map.piano = legacy
  }
  return map
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
    // Every practice session belongs to an instrument; records predating the
    // instrument layer were all piano.
    instrumentId: normalizeInstrumentId(session.instrumentId),
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

    const lastInstrumentId = normalizeInstrumentId(value.lastInstrumentId)
    const autoPracticeSeconds = nonNegativeNumber(value.autoPracticeSeconds)
    const autoPracticeSecondsByInstrument = normalizeInstrumentNumberMap(
      value.autoPracticeSecondsByInstrument,
    )
    const hasStoredInstrumentBreakdown =
      isRecord(value.autoPracticeSecondsByInstrument) &&
      Object.keys(autoPracticeSecondsByInstrument).length > 0
    if (!hasStoredInstrumentBreakdown && autoPracticeSeconds > 0) {
      autoPracticeSecondsByInstrument[lastInstrumentId] = autoPracticeSeconds
    }

    const lastPracticedAt = normalizeTimestamp(value.lastPracticedAt)
    const lastPracticedAtByInstrument = normalizeInstrumentTimestampMap(
      value.lastPracticedAtByInstrument,
    )
    if (Object.keys(lastPracticedAtByInstrument).length === 0 && lastPracticedAt != null) {
      lastPracticedAtByInstrument[lastInstrumentId] = lastPracticedAt
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
      autoPracticeSeconds,
      autoPracticeSecondsByInstrument,
      autoPracticeInstrumentBreakdownEstimated:
        !hasStoredInstrumentBreakdown && autoPracticeSeconds > 0,
      measuresPlayed: nonNegativeNumber(value.measuresPlayed),
      loopsCompleted: nonNegativeNumber(value.loopsCompleted),
      lastTempoBpm:
        Number.isFinite(Number(value.lastTempoBpm)) && Number(value.lastTempoBpm) > 0
          ? Math.round(Number(value.lastTempoBpm))
          : null,
      wfyCorrect: nonNegativeNumber(value.wfyCorrect),
      wfyMissed: nonNegativeNumber(value.wfyMissed),
      wfySkipped: nonNegativeNumber(value.wfySkipped),
      lastPracticedAt,
      lastPracticedAtByInstrument,
      lastInstrumentId,
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

  const autoPracticeSeconds = nonNegativeNumber(raw.autoPracticeSeconds)
  const lastAutoPracticedAt = normalizeTimestamp(raw.lastAutoPracticedAt)

  return reconcileProfileStats({
    version: PROFILE_STATS_VERSION,
    totalPracticeSeconds: manualPracticeSeconds,
    totalSessions: manualSessions.length,
    manualSessionsCompleted: manualSessions.length,
    legacyAutoPracticeSeconds,
    legacyAutoSessionsCompleted: legacyAutoSessions.length,
    autoPracticeSeconds,
    autoPracticeSecondsByInstrument: normalizeInstrumentNumberMap(
      raw.autoPracticeSecondsByInstrument,
      { legacyPianoValue: autoPracticeSeconds },
    ),
    lastAutoPracticedAt,
    lastAutoPracticedAtByInstrument: normalizeInstrumentTimestampMap(
      raw.lastAutoPracticedAtByInstrument,
      { legacyPianoValue: lastAutoPracticedAt },
    ),
    lastPracticedAt:
      manualSessions[0]?.endedAt ?? normalizeTimestamp(raw.lastPracticedAt),
    pieces: normalizePieces(raw.pieces),
    recentSessions,
  })
}
