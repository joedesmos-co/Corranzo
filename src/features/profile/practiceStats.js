import { loadStats, saveStats } from './profileStorage.js'
import { MAX_RECENT_SESSIONS } from './profileStatsSchema.js'

let activeSession = null

function normalizePiece(piece) {
  const id = String(piece?.id ?? '').trim()
  if (!id) {
    return null
  }

  return {
    id,
    title:
      typeof piece.title === 'string' && piece.title.trim()
        ? piece.title.trim().slice(0, 120)
        : 'Untitled piece',
  }
}

export function beginSession(piece) {
  const normalizedPiece = normalizePiece(piece)
  if (!normalizedPiece) {
    activeSession = null
    return null
  }

  const startedAt = Date.now()
  activeSession = {
    id: `session-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    pieceId: normalizedPiece.id,
    pieceTitle: normalizedPiece.title,
    startedAt,
  }

  return { ...activeSession }
}

export function endSession(durationSeconds) {
  const sessionDraft = activeSession
  activeSession = null

  const stats = loadStats()
  const duration = Number(durationSeconds)
  const normalizedDuration = Math.floor(duration)
  if (
    !sessionDraft ||
    !Number.isFinite(duration) ||
    normalizedDuration < 1
  ) {
    return stats
  }

  const endedAt = Date.now()
  const session = {
    ...sessionDraft,
    endedAt,
    durationSeconds: normalizedDuration,
  }
  const existingPiece = stats.pieces[session.pieceId]
  const piece = {
    id: session.pieceId,
    title: session.pieceTitle,
    totalPracticeSeconds:
      (existingPiece?.totalPracticeSeconds ?? 0) + normalizedDuration,
    totalSessions: (existingPiece?.totalSessions ?? 0) + 1,
    lastPracticedAt: endedAt,
  }
  const nextStats = {
    ...stats,
    totalPracticeSeconds: stats.totalPracticeSeconds + normalizedDuration,
    totalSessions: stats.totalSessions + 1,
    lastPracticedAt: endedAt,
    pieces: {
      ...stats.pieces,
      [piece.id]: piece,
    },
    recentSessions: [session, ...stats.recentSessions].slice(
      0,
      MAX_RECENT_SESSIONS,
    ),
  }

  saveStats(nextStats)
  return nextStats
}
