export const PROFILE_STATS_VERSION = 1
export const PROFILE_META_VERSION = 1

export const MAX_STORED_SESSIONS = 150
export const MIN_SESSION_ACTIVE_SECONDS = 60

export const INPUT_MODE = {
  MIDI: 'midi',
  MICROPHONE: 'microphone',
  MANUAL: 'manual',
  MIXED: 'mixed',
}

export function createDefaultProfile() {
  return {
    version: PROFILE_META_VERSION,
    displayName: 'Musician',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function createEmptyStatsStore() {
  return {
    version: PROFILE_STATS_VERSION,
    sessions: [],
    totals: {
      practiceSecondsActive: 0,
      waitForYouSeconds: 0,
      sessionsCompleted: 0,
      notesMatched: 0,
      notesAttempted: 0,
      loopsPracticed: 0,
      xp: 0,
    },
    streak: {
      current: 0,
      longest: 0,
      lastPracticeDay: null,
    },
    pieces: {},
  }
}

export function createSessionDraft({ pieceId, pieceTitle, isDemoPiece = false }) {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: Date.now(),
    endedAt: null,
    pieceId,
    pieceTitle,
    isDemoPiece,
    practiceSecondsActive: 0,
    waitForYouSeconds: 0,
    loopsPracticed: 0,
    practiceMode: 'normal',
    inputModesUsed: {
      midi: 0,
      microphone: 0,
      manual: 0,
    },
    wfyNotesMatched: 0,
    wfyNotesAttempted: 0,
    completed: false,
  }
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeProfile(raw) {
  if (!isRecord(raw)) {
    return createDefaultProfile()
  }
  const displayName =
    typeof raw.displayName === 'string' && raw.displayName.trim()
      ? raw.displayName.trim().slice(0, 40)
      : 'Musician'
  return {
    version: PROFILE_META_VERSION,
    displayName,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  }
}

export function normalizeStatsStore(raw) {
  if (!isRecord(raw)) {
    return createEmptyStatsStore()
  }

  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.filter((session) => isRecord(session)).slice(0, MAX_STORED_SESSIONS)
    : []

  const totals = isRecord(raw.totals) ? raw.totals : {}
  const streak = isRecord(raw.streak) ? raw.streak : {}
  const pieces = isRecord(raw.pieces) ? raw.pieces : {}

  return {
    version: PROFILE_STATS_VERSION,
    sessions,
    totals: {
      practiceSecondsActive: Math.max(0, Number(totals.practiceSecondsActive) || 0),
      waitForYouSeconds: Math.max(0, Number(totals.waitForYouSeconds) || 0),
      sessionsCompleted: Math.max(0, Number(totals.sessionsCompleted) || 0),
      notesMatched: Math.max(0, Number(totals.notesMatched) || 0),
      notesAttempted: Math.max(0, Number(totals.notesAttempted) || 0),
      loopsPracticed: Math.max(0, Number(totals.loopsPracticed) || 0),
      xp: Math.max(0, Number(totals.xp) || 0),
    },
    streak: {
      current: Math.max(0, Number(streak.current) || 0),
      longest: Math.max(0, Number(streak.longest) || 0),
      lastPracticeDay:
        typeof streak.lastPracticeDay === 'string' ? streak.lastPracticeDay : null,
    },
    pieces,
  }
}
