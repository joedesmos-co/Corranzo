import {
  MIN_SESSION_ACTIVE_SECONDS,
  MAX_STORED_SESSIONS,
  createDefaultProfile,
  createEmptyStatsStore,
  normalizeProfile,
  normalizeStatsStore,
} from './profileStatsSchema.js'
import { computeStreakFromSessions } from './computeProfileMetrics.js'
import { xpForSession } from './practiceXp.js'

const PROFILE_KEY = 'scoreflow-profile-v1'
const STATS_KEY = 'scoreflow-practice-stats-v1'

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) {
      return createDefaultProfile()
    }
    return normalizeProfile(JSON.parse(raw))
  } catch {
    return createDefaultProfile()
  }
}

export function saveProfile(profile) {
  try {
    const next = {
      ...profile,
      updatedAt: Date.now(),
    }
    localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function loadStatsStore() {
  try {
    const raw = localStorage.getItem(STATS_KEY)
    if (!raw) {
      return createEmptyStatsStore()
    }
    return normalizeStatsStore(JSON.parse(raw))
  } catch {
    return createEmptyStatsStore()
  }
}

export function saveStatsStore(store) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

function dominantInputMode(inputModesUsed) {
  const entries = Object.entries(inputModesUsed ?? {})
  if (entries.length === 0) {
    return 'manual'
  }
  entries.sort((left, right) => right[1] - left[1])
  const top = entries[0]
  const second = entries[1]
  if (second && second[1] > 0 && top[1] / (top[1] + second[1]) < 0.6) {
    return 'mixed'
  }
  return top[0]
}

export function finalizeSession(store, draft) {
  const endedAt = Date.now()
  const practiceSecondsActive = Math.max(0, draft.practiceSecondsActive ?? 0)
  const completed =
    practiceSecondsActive >= MIN_SESSION_ACTIVE_SECONDS ||
    (draft.wfyNotesMatched ?? 0) >= 3

  const session = {
    ...draft,
    endedAt,
    practiceSecondsActive,
    completed,
    dominantInputMode: dominantInputMode(draft.inputModesUsed),
  }

  const xpGain = xpForSession(session)
  const sessions = [session, ...(store.sessions ?? [])].slice(0, MAX_STORED_SESSIONS)

  const totals = { ...store.totals }
  totals.practiceSecondsActive += practiceSecondsActive
  totals.waitForYouSeconds += draft.waitForYouSeconds ?? 0
  totals.loopsPracticed += draft.loopsPracticed ?? 0
  totals.notesMatched += draft.wfyNotesMatched ?? 0
  totals.notesAttempted += draft.wfyNotesAttempted ?? 0
  totals.xp += xpGain
  if (completed) {
    totals.sessionsCompleted += 1
  }

  const pieces = { ...store.pieces }
  const pieceKey = draft.pieceId
  const existing = pieces[pieceKey] ?? {
    id: pieceKey,
    title: draft.pieceTitle,
    totalSeconds: 0,
    sessionCount: 0,
    lastPracticedAt: null,
    isDemoPiece: draft.isDemoPiece,
  }
  pieces[pieceKey] = {
    ...existing,
    title: draft.pieceTitle ?? existing.title,
    totalSeconds: existing.totalSeconds + practiceSecondsActive,
    sessionCount: existing.sessionCount + 1,
    lastPracticedAt: endedAt,
    isDemoPiece: draft.isDemoPiece,
  }

  const streak = computeStreakFromSessions(sessions)

  return {
    ...store,
    sessions,
    totals,
    pieces,
    streak,
  }
}

export function clearAllProfileData() {
  try {
    localStorage.removeItem(PROFILE_KEY)
    localStorage.removeItem(STATS_KEY)
    return true
  } catch {
    return false
  }
}
