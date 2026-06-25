import { normalizeExerciseType } from './exerciseTypes.js'
import { loadStats, saveStats } from './profileStorage.js'
import { MAX_RECENT_SESSIONS, reconcileProfileStats } from './profileStatsSchema.js'

function normalizePieceTitle(value) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim().slice(0, 120)
  }
  return 'Practice session'
}

function manualPieceId(title) {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug ? `manual:${slug}` : 'manual:practice-session'
}

function normalizeNotes(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim().slice(0, 500)
}

export function saveManualSession({
  pieceTitle,
  exerciseType,
  notes = '',
  durationSeconds,
  startedAt,
  endedAt = Date.now(),
}) {
  const stats = loadStats()
  const duration = Number(durationSeconds)
  const normalizedDuration = Math.floor(duration)
  if (!Number.isFinite(duration) || normalizedDuration < 1) {
    return stats
  }

  const title = normalizePieceTitle(pieceTitle)
  const pieceId = manualPieceId(title)
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

  const session = {
    id: `manual-${safeEndedAt}-${Math.random().toString(36).slice(2, 8)}`,
    source: 'manual',
    pieceId,
    pieceTitle: title,
    exerciseType: normalizeExerciseType(exerciseType),
    notes: normalizeNotes(notes),
    startedAt: safeStartedAt,
    endedAt: safeEndedAt,
    durationSeconds: normalizedDuration,
  }

  const existingPiece = stats.pieces[pieceId]
  const piece = {
    id: pieceId,
    title,
    totalPracticeSeconds:
      (existingPiece?.totalPracticeSeconds ?? 0) + normalizedDuration,
    totalSessions: (existingPiece?.totalSessions ?? 0) + 1,
    lastPracticedAt: safeEndedAt,
  }

  const nextStats = reconcileProfileStats({
    ...stats,
    pieces: {
      ...stats.pieces,
      [piece.id]: piece,
    },
    recentSessions: [session, ...stats.recentSessions].slice(
      0,
      MAX_RECENT_SESSIONS,
    ),
  })

  saveStats(nextStats)
  return nextStats
}

export function isManualSession(session) {
  return session?.source === 'manual'
}

export function isAutoSession(session) {
  return session?.source !== 'manual'
}
