import { normalizeExerciseType } from './exerciseTypes.js'
import {
  isSupportedInstrumentId,
  normalizeInstrumentId,
} from '../instruments/instruments.js'
import { slugifyPieceTitle } from './pieceIdentity.js'

export const PROFILE_STATS_VERSION = 2
export const PROFILE_STATS_VERSION_V1 = 1
/** Bounded display list only. Lifetime totals are cumulative and never truncated. */
export const MAX_RECENT_SESSIONS = 20

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function nonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : 0
}

function nonNegativeInt(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
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
    manualPracticeSecondsByInstrument: {},
    manualSessionsByInstrument: {},
    legacyAutoPracticeSeconds: 0,
    legacyAutoSessionsCompleted: 0,
    autoPracticeSeconds: 0,
    autoPracticeSecondsByInstrument: {},
    lastAutoPracticedAt: null,
    lastAutoPracticedAtByInstrument: {},
    lastPracticedAt: null,
    pieces: {},
    recentSessions: [],
    pieceTitleAliases: {},
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

function normalizeInstrumentCountMap(raw) {
  const map = {}
  if (!isRecord(raw)) {
    return map
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isSupportedInstrumentId(key)) {
      continue
    }
    const count = nonNegativeInt(value)
    if (count > 0) {
      map[key] = count
    }
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

function normalizeTitleAliases(raw) {
  if (!isRecord(raw)) {
    return {}
  }
  const aliases = {}
  for (const [key, value] of Object.entries(raw)) {
    const slug = slugifyPieceTitle(key)
    const pieceId = String(value ?? '').trim()
    if (slug && pieceId) {
      aliases[slug] = pieceId.slice(0, 160)
    }
  }
  return aliases
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
 * V2: lifetime totals are durable cumulative counters, never recomputed from
 * the bounded display slice. `recentSessions` is display-only (newest 20).
 * Repair rule: stored totals are preserved, but bumped up to at least the
 * per-piece sums / slice sums so legacy truncated totals (20/1200 with piece
 * 21/1260) heal to honest lifetime values. Never bump down.
 */
export function reconcileProfileStats(stats) {
  const normalizedSessions = Array.isArray(stats.recentSessions)
    ? stats.recentSessions.map(normalizeSession).filter(Boolean)
    : []
  // Display bound only; totals below do not derive from this slice.
  const recentSessions = [...normalizedSessions]
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
    .slice(0, MAX_RECENT_SESSIONS)

  const pieces = isRecord(stats.pieces) ? stats.pieces : {}
  const pieceValues = Object.values(pieces)
  const piecesManualSessions = pieceValues.reduce(
    (sum, piece) => sum + nonNegativeInt(piece.totalSessions),
    0,
  )
  const piecesManualSeconds = pieceValues.reduce(
    (sum, piece) => sum + nonNegativeNumber(piece.totalPracticeSeconds),
    0,
  )

  const sliceManual = normalizedSessions.filter(isManualSessionRecord)
  const sliceManualSessions = sliceManual.length
  const sliceManualSeconds = sumSessionDurations(sliceManual)

  const isV2Stats = stats.version === PROFILE_STATS_VERSION
  const storedTotalSessions = isV2Stats ? nonNegativeInt(stats.totalSessions) : 0
  const storedTotalSeconds = isV2Stats ? nonNegativeNumber(stats.totalPracticeSeconds) : 0
  const storedManualCompleted = isV2Stats
    ? nonNegativeInt(stats.manualSessionsCompleted ?? stats.totalSessions)
    : 0

  const totalSessions = Math.max(storedTotalSessions, piecesManualSessions, sliceManualSessions)
  const totalPracticeSeconds = Math.max(storedTotalSeconds, piecesManualSeconds, sliceManualSeconds)
  const manualSessionsCompleted = Math.max(storedManualCompleted, piecesManualSessions, sliceManualSessions)

  const storedLegacySeconds = nonNegativeNumber(stats.legacyAutoPracticeSeconds)
  const storedLegacyCount = nonNegativeInt(stats.legacyAutoSessionsCompleted)
  const sliceAuto = normalizedSessions.filter(isLegacyAutoSessionRecord)
  const legacyAutoPracticeSeconds = Math.max(storedLegacySeconds, sumSessionDurations(sliceAuto))
  const legacyAutoSessionsCompleted = Math.max(storedLegacyCount, sliceAuto.length)

  const manualNewest = normalizedSessions.filter(isManualSessionRecord)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]

  return {
    ...stats,
    version: PROFILE_STATS_VERSION,
    recentSessions,
    totalPracticeSeconds,
    totalSessions,
    manualSessionsCompleted,
    manualPracticeSecondsByInstrument: normalizeInstrumentNumberMap(
      stats.manualPracticeSecondsByInstrument,
    ),
    manualSessionsByInstrument: normalizeInstrumentCountMap(stats.manualSessionsByInstrument),
    legacyAutoPracticeSeconds,
    legacyAutoSessionsCompleted,
    lastPracticedAt: manualNewest?.endedAt ?? normalizeTimestamp(stats.lastPracticedAt),
    pieceTitleAliases: normalizeTitleAliases(stats.pieceTitleAliases),
  }
}

function normalizePieceId(pieceId) {
  const id = String(pieceId ?? '').trim()
  if (!id) {
    return null
  }
  // Migrate legacy manual: namespace into canonical piece: namespace.
  if (id.startsWith('manual:')) {
    const slug = id.slice('manual:'.length)
    return slug ? `piece:${slug}` : null
  }
  return id.slice(0, 160)
}

function normalizeSession(session) {
  if (!isRecord(session)) {
    return null
  }

  const rawPieceId = String(session.pieceId ?? '').trim()
  if (!rawPieceId) {
    return null
  }
  const pieceId = normalizePieceId(rawPieceId)
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
    // Canonical auto metrics preserved when present (unified ledger).
    practiceMode: typeof session.practiceMode === 'string' ? session.practiceMode.slice(0, 40) : null,
    measuresVisited: nonNegativeInt(session.measuresVisited ?? session.measuresPlayed),
    loopsCompleted: nonNegativeInt(session.loopsCompleted),
    tempoBpm:
      Number.isFinite(Number(session.tempoBpm ?? session.lastTempoBpm)) &&
      Number(session.tempoBpm ?? session.lastTempoBpm) > 0
        ? Math.round(Number(session.tempoBpm ?? session.lastTempoBpm))
        : null,
    wfyCorrect: nonNegativeInt(session.wfyCorrect),
    wfyMissed: nonNegativeInt(session.wfyMissed),
    wfySkipped: nonNegativeInt(session.wfySkipped),
    wfyManualContinues: nonNegativeInt(session.wfyManualContinues),
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

    const rawId = String(value.id ?? key).trim()
    const id = normalizePieceId(rawId)
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

    // Merge legacy manual: entries into canonical piece: entries when both
    // exist (same slug, different prefix). Manual totals + auto totals combine.
    const existing = pieces[id]
    const mergedManualSeconds =
      nonNegativeNumber(value.totalPracticeSeconds ?? value.totalSeconds) +
      (existing ? 0 : 0)
    const mergedManualSessions =
      nonNegativeNumber(value.totalSessions ?? value.sessionCount) + (existing ? 0 : 0)

    pieces[id] = {
      id,
      title:
        typeof value.title === 'string' && value.title.trim()
          ? value.title.trim().slice(0, 120)
          : existing?.title ?? 'Untitled piece',
      totalPracticeSeconds: existing
        ? existing.totalPracticeSeconds + nonNegativeNumber(value.totalPracticeSeconds ?? value.totalSeconds)
        : nonNegativeNumber(value.totalPracticeSeconds ?? value.totalSeconds),
      totalSessions: existing
        ? existing.totalSessions + nonNegativeNumber(value.totalSessions ?? value.sessionCount)
        : nonNegativeNumber(value.totalSessions ?? value.sessionCount),
      autoPracticeSeconds: (existing?.autoPracticeSeconds ?? 0) + autoPracticeSeconds,
      autoPracticeSecondsByInstrument: mergeInstrumentMaps(
        existing?.autoPracticeSecondsByInstrument ?? {},
        autoPracticeSecondsByInstrument,
      ),
      autoPracticeInstrumentBreakdownEstimated:
        (!hasStoredInstrumentBreakdown && autoPracticeSeconds > 0) ||
        Boolean(existing?.autoPracticeInstrumentBreakdownEstimated),
      measuresPlayed: (existing?.measuresPlayed ?? 0) + nonNegativeNumber(value.measuresPlayed),
      loopsCompleted: (existing?.loopsCompleted ?? 0) + nonNegativeNumber(value.loopsCompleted),
      lastTempoBpm:
        Number.isFinite(Number(value.lastTempoBpm)) && Number(value.lastTempoBpm) > 0
          ? Math.round(Number(value.lastTempoBpm))
          : existing?.lastTempoBpm ?? null,
      wfyCorrect: (existing?.wfyCorrect ?? 0) + nonNegativeNumber(value.wfyCorrect),
      wfyMissed: (existing?.wfyMissed ?? 0) + nonNegativeNumber(value.wfyMissed),
      wfySkipped: (existing?.wfySkipped ?? 0) + nonNegativeNumber(value.wfySkipped),
      lastPracticedAt: Math.max(existing?.lastPracticedAt ?? 0, lastPracticedAt ?? 0) || null,
      lastPracticedAtByInstrument: mergeTimestampMaps(
        existing?.lastPracticedAtByInstrument ?? {},
        lastPracticedAtByInstrument,
      ),
      lastInstrumentId: value.lastInstrumentId ? lastInstrumentId : existing?.lastInstrumentId ?? lastInstrumentId,
    }
    void mergedManualSeconds
    void mergedManualSessions
  }

  return pieces
}

function mergeInstrumentMaps(left, right) {
  const merged = { ...left }
  for (const [key, value] of Object.entries(right)) {
    if (!isSupportedInstrumentId(key)) {
      continue
    }
    merged[key] = (merged[key] ?? 0) + nonNegativeNumber(value)
  }
  const cleaned = {}
  for (const [key, value] of Object.entries(merged)) {
    if (value > 0) {
      cleaned[key] = value
    }
  }
  return cleaned
}

function mergeTimestampMaps(left, right) {
  const merged = { ...left }
  for (const [key, value] of Object.entries(right)) {
    const timestamp = normalizeTimestamp(value)
    if (timestamp == null) {
      continue
    }
    merged[key] = Math.max(merged[key] ?? 0, timestamp)
  }
  return merged
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
  // Normalize all for repair math, then bound display to newest 20.
  const allSessions = recentSessionsSource.map(normalizeSession).filter(Boolean)
    .sort((left, right) => (right.endedAt ?? 0) - (left.endedAt ?? 0))
  const recentSessions = allSessions.slice(0, MAX_RECENT_SESSIONS)

  const manualSessions = allSessions.filter(isManualSessionRecord)
  const legacyAutoSessions = allSessions.filter(isLegacyAutoSessionRecord)
  const sliceManualSeconds = sumSessionDurations(manualSessions)
  const sliceLegacySeconds = sumSessionDurations(legacyAutoSessions)

  const pieces = normalizePieces(raw.pieces)
  const pieceValues = Object.values(pieces)
  const piecesManualSessions = pieceValues.reduce(
    (sum, piece) => sum + nonNegativeInt(piece.totalSessions),
    0,
  )
  const piecesManualSeconds = pieceValues.reduce(
    (sum, piece) => sum + nonNegativeNumber(piece.totalPracticeSeconds),
    0,
  )

  const autoPracticeSeconds = nonNegativeNumber(raw.autoPracticeSeconds)
  const lastAutoPracticedAt = normalizeTimestamp(raw.lastAutoPracticedAt)

  // Headline repair: legacy v1 recomputed from the 20-slice (20/1200 with
  // piece 21/1260) and stored totals are slice-derived, not cumulative — so
  // v1 raw totals must be ignored for manual repair. V2 preserves cumulative
  // counters; migration heals v1 by pieces sums + slice sums, and preserves
  // v2 via max with stored.
  const isV2 = raw.version === PROFILE_STATS_VERSION
  const storedTotalSessions = isV2 ? nonNegativeInt(raw.totalSessions ?? raw.manualSessionsCompleted) : 0
  const storedTotalSeconds = isV2 ? nonNegativeNumber(raw.totalPracticeSeconds) : 0
  const storedManualCompleted = isV2
    ? nonNegativeInt(raw.manualSessionsCompleted ?? raw.totalSessions)
    : 0
  const totalSessions = Math.max(
    storedTotalSessions,
    nonNegativeInt(raw.manualSessionsCompleted !== undefined && isV2 ? raw.manualSessionsCompleted : 0),
    piecesManualSessions,
    manualSessions.length,
  )
  const totalPracticeSeconds = Math.max(
    storedTotalSeconds,
    piecesManualSeconds,
    sliceManualSeconds,
  )
  const manualSessionsCompleted = Math.max(
    storedManualCompleted,
    piecesManualSessions,
    manualSessions.length,
  )
  const legacyAutoPracticeSeconds = Math.max(
    nonNegativeNumber(raw.legacyAutoPracticeSeconds),
    sliceLegacySeconds,
  )
  const legacyAutoSessionsCompleted = Math.max(
    nonNegativeInt(raw.legacyAutoSessionsCompleted),
    legacyAutoSessions.length,
  )

  // Title-alias join map: slug(title) -> canonical pieceId, rebuilt from
  // pieces + sessions so manual + auto views reference the same work.
  const pieceTitleAliases = {
    ...normalizeTitleAliases(raw.pieceTitleAliases),
  }
  for (const piece of pieceValues) {
    const slug = slugifyPieceTitle(piece.title)
    if (slug && !pieceTitleAliases[slug]) {
      pieceTitleAliases[slug] = piece.id
    }
  }
  for (const session of allSessions) {
    const slug = slugifyPieceTitle(session.pieceTitle)
    if (slug && !pieceTitleAliases[slug]) {
      pieceTitleAliases[slug] = session.pieceId
    }
  }

  // Per-instrument manual lifetime repair: raw counters (exact for new saves)
  // healed with pieces-by-lastInstrument estimates + slice sums for legacy data.
  const sliceManualByInstrument = { seconds: {}, counts: {} }
  for (const session of manualSessions) {
    const instrument = session.instrumentId ?? 'piano'
    sliceManualByInstrument.seconds[instrument] =
      (sliceManualByInstrument.seconds[instrument] ?? 0) + (session.durationSeconds ?? 0)
    sliceManualByInstrument.counts[instrument] =
      (sliceManualByInstrument.counts[instrument] ?? 0) + 1
  }
  const piecesManualByInstrument = { seconds: {}, counts: {} }
  for (const piece of pieceValues) {
    const instrument = piece.lastInstrumentId ?? 'piano'
    piecesManualByInstrument.seconds[instrument] =
      (piecesManualByInstrument.seconds[instrument] ?? 0) + (piece.totalPracticeSeconds ?? 0)
    piecesManualByInstrument.counts[instrument] =
      (piecesManualByInstrument.counts[instrument] ?? 0) + (piece.totalSessions ?? 0)
  }
  const rawManualSecondsByInstrument =
    isV2 && isRecord(raw.manualPracticeSecondsByInstrument)
      ? raw.manualPracticeSecondsByInstrument
      : {}
  const rawManualCountsByInstrument =
    isV2 && isRecord(raw.manualSessionsByInstrument) ? raw.manualSessionsByInstrument : {}
  const manualPracticeSecondsByInstrument = {}
  const manualSessionsByInstrument = {}
  for (const instrument of ['piano', 'guitar']) {
    manualPracticeSecondsByInstrument[instrument] = Math.max(
      nonNegativeNumber(rawManualSecondsByInstrument[instrument]),
      nonNegativeNumber(piecesManualByInstrument.seconds[instrument]),
      nonNegativeNumber(sliceManualByInstrument.seconds[instrument]),
    )
    manualSessionsByInstrument[instrument] = Math.max(
      nonNegativeInt(rawManualCountsByInstrument[instrument]),
      nonNegativeInt(piecesManualByInstrument.counts[instrument]),
      nonNegativeInt(sliceManualByInstrument.counts[instrument]),
    )
  }
  // Drop zero entries for clean shape (matches instrument map norms).
  for (const instrument of ['piano', 'guitar']) {
    if (!manualPracticeSecondsByInstrument[instrument]) {
      delete manualPracticeSecondsByInstrument[instrument]
    }
    if (!manualSessionsByInstrument[instrument]) {
      delete manualSessionsByInstrument[instrument]
    }
  }

  return reconcileProfileStats({
    version: PROFILE_STATS_VERSION,
    totalPracticeSeconds,
    totalSessions,
    manualSessionsCompleted,
    manualPracticeSecondsByInstrument,
    manualSessionsByInstrument,
    legacyAutoPracticeSeconds,
    legacyAutoSessionsCompleted,
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
      [...manualSessions].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]?.endedAt ??
      normalizeTimestamp(raw.lastPracticedAt),
    pieces,
    recentSessions,
    pieceTitleAliases,
  })
}
