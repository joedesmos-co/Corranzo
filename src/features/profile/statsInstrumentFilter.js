import {
  getInstrument,
  isSupportedInstrumentId,
  listInstruments,
  normalizeInstrumentId,
} from '../instruments/instruments.js'
import {
  isLegacyAutoSessionRecord,
  isManualSessionRecord,
} from './profileStatsSchema.js'

/**
 * Instrument scoping for the Progress view — one stats implementation, three
 * views: both instruments combined, just piano, just guitar.
 *
 * A pure projection over the canonical stats object: "all" returns it
 * untouched; an instrument scope narrows sessions/pieces to that instrument
 * and recomputes the headline numbers from what remains (the same
 * sessions-derived math reconcileProfileStats uses).
 */

export const STATS_SCOPE_ALL = 'all'

/** Ordered scope options for the UI: combined first, then each instrument. */
export function listStatsScopes() {
  return [
    { id: STATS_SCOPE_ALL, label: 'All instruments' },
    ...listInstruments().map((instrument) => ({
      id: instrument.id,
      label: instrument.label,
    })),
  ]
}

export function normalizeStatsScope(scopeId) {
  return isSupportedInstrumentId(scopeId) ? scopeId : STATS_SCOPE_ALL
}

function sumDurations(sessions) {
  return sessions.reduce(
    (sum, session) => sum + Math.max(0, Number(session.durationSeconds) || 0),
    0,
  )
}

/**
 * Project stats down to one instrument. Returns the input object unchanged
 * for the combined scope so "all" stays byte-identical to today's view.
 */
export function filterStatsByInstrument(stats, scopeId) {
  const scope = normalizeStatsScope(scopeId)
  if (!stats || scope === STATS_SCOPE_ALL) {
    return stats
  }

  const recentSessions = (stats.recentSessions ?? []).filter(
    (session) => normalizeInstrumentId(session.instrumentId) === scope,
  )
  const manualSessions = recentSessions.filter(isManualSessionRecord)
  const legacyAutoSessions = recentSessions.filter(isLegacyAutoSessionRecord)

  const scopedAutoTotal = stats.autoPracticeSecondsByInstrument?.[scope] ?? 0
  const pieces = {}
  for (const [pieceId, piece] of Object.entries(stats.pieces ?? {})) {
    const scopedAutoSeconds = Math.max(
      0,
      Number(piece.autoPracticeSecondsByInstrument?.[scope]) || 0,
    )
    const safeScopedAutoSeconds = piece.autoPracticeInstrumentBreakdownEstimated
      ? Math.min(scopedAutoSeconds, scopedAutoTotal)
      : scopedAutoSeconds
    const includePiece =
      safeScopedAutoSeconds > 0 || normalizeInstrumentId(piece.lastInstrumentId) === scope
    if (includePiece) {
      pieces[pieceId] = {
        ...piece,
        autoPracticeSeconds: safeScopedAutoSeconds,
        lastPracticedAt:
          piece.lastPracticedAtByInstrument?.[scope] ??
          (safeScopedAutoSeconds > 0 ? piece.lastPracticedAt : null),
      }
    }
  }

  return {
    ...stats,
    statsScope: scope,
    statsScopeLabel: getInstrument(scope).label,
    recentSessions,
    totalPracticeSeconds: sumDurations(manualSessions),
    totalSessions: manualSessions.length,
    manualSessionsCompleted: manualSessions.length,
    legacyAutoPracticeSeconds: sumDurations(legacyAutoSessions),
    legacyAutoSessionsCompleted: legacyAutoSessions.length,
    autoPracticeSeconds: scopedAutoTotal,
    lastAutoPracticedAt: stats.lastAutoPracticedAtByInstrument?.[scope] ?? null,
    lastPracticedAt: manualSessions[0]?.endedAt ?? null,
    pieces,
  }
}
