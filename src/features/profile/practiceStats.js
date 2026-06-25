import { loadStats } from './profileStorage.js'

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

/** Automatic practice tracking is disabled — manual log is the source of truth. */
export const AUTOMATIC_PRACTICE_TRACKING_ENABLED = false

export function beginSession(piece) {
  if (!AUTOMATIC_PRACTICE_TRACKING_ENABLED) {
    activeSession = null
    return null
  }

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

export function endSession(_durationSeconds) {
  activeSession = null
  return loadStats()
}
