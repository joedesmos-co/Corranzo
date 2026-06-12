import { createDefaultProfile, createEmptyStatsStore } from './profileStatsSchema.js'
import { computeStreakFromSessions } from './computeProfileMetrics.js'
import { saveProfile, saveStatsStore } from './profileStorage.js'

const DEMO_PIECE_ID = 'Minuet in G.pdf::Minuet in G.musicxml'
const DEMO_PIECE_TITLE = 'Minuet in G'

function daysAgo(days, hour = 18) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hour, 0, 0, 0)
  return date.getTime()
}

function buildSession({
  id,
  daysBack,
  practiceSecondsActive,
  waitForYouSeconds = 0,
  wfyNotesMatched = 0,
  wfyNotesAttempted = 0,
  loopsPracticed = 0,
  dominantInputMode = 'manual',
  practiceMode = 'normal',
}) {
  const endedAt = daysAgo(daysBack)
  const startedAt = endedAt - practiceSecondsActive * 1000 - 30000
  const completed =
    practiceSecondsActive >= 60 || wfyNotesMatched >= 3

  return {
    id,
    startedAt,
    endedAt,
    pieceId: DEMO_PIECE_ID,
    pieceTitle: DEMO_PIECE_TITLE,
    isDemoPiece: true,
    practiceSecondsActive,
    waitForYouSeconds,
    loopsPracticed,
    practiceMode,
    inputModesUsed: {
      midi: dominantInputMode === 'midi' ? waitForYouSeconds || 30 : 0,
      microphone: dominantInputMode === 'microphone' ? waitForYouSeconds || 30 : 0,
      manual: dominantInputMode === 'manual' ? waitForYouSeconds || practiceSecondsActive : 0,
    },
    wfyNotesMatched,
    wfyNotesAttempted,
    manualContinues: dominantInputMode === 'manual' ? 4 : 0,
    completed,
    dominantInputMode,
  }
}

/**
 * Writes calm sample stats for demos/screenshots (local only).
 */
export function buildDemoProfileStatsStore() {
  const sessions = [
    buildSession({
      id: 'demo-session-today',
      daysBack: 0,
      practiceSecondsActive: 78,
      waitForYouSeconds: 24,
      wfyNotesMatched: 5,
      wfyNotesAttempted: 7,
      loopsPracticed: 2,
      dominantInputMode: 'midi',
      practiceMode: 'wait-for-you',
    }),
    buildSession({
      id: 'demo-session-yesterday',
      daysBack: 1,
      practiceSecondsActive: 62,
      waitForYouSeconds: 18,
      wfyNotesMatched: 3,
      wfyNotesAttempted: 4,
      dominantInputMode: 'manual',
      practiceMode: 'wait-for-you',
    }),
    buildSession({
      id: 'demo-session-3d',
      daysBack: 3,
      practiceSecondsActive: 45,
      waitForYouSeconds: 0,
      practiceMode: 'normal',
    }),
  ]

  const totals = {
    practiceSecondsActive: 0,
    waitForYouSeconds: 0,
    sessionsCompleted: 0,
    notesMatched: 0,
    notesAttempted: 0,
    loopsPracticed: 0,
    xp: 0,
  }

  for (const session of sessions) {
    totals.practiceSecondsActive += session.practiceSecondsActive
    totals.waitForYouSeconds += session.waitForYouSeconds
    totals.loopsPracticed += session.loopsPracticed
    totals.notesMatched += session.wfyNotesMatched
    totals.notesAttempted += session.wfyNotesAttempted
    if (session.completed) {
      totals.sessionsCompleted += 1
    }
    totals.xp += 10 + Math.min(24, Math.floor(session.practiceSecondsActive / 60) * 2)
    totals.xp += Math.min(20, session.wfyNotesMatched)
    if (session.loopsPracticed > 0) {
      totals.xp += 3
    }
  }

  const store = {
    ...createEmptyStatsStore(),
    sessions,
    totals,
    pieces: {
      [DEMO_PIECE_ID]: {
        id: DEMO_PIECE_ID,
        title: DEMO_PIECE_TITLE,
        totalSeconds: totals.practiceSecondsActive,
        sessionCount: sessions.length,
        lastPracticedAt: sessions[0].endedAt,
        isDemoPiece: true,
      },
    },
    streak: computeStreakFromSessions(sessions),
  }

  return store
}

export function applyDemoProfileSeed() {
  const profile = {
    ...createDefaultProfile(),
    displayName: 'Demo musician',
    updatedAt: Date.now(),
  }
  const store = buildDemoProfileStatsStore()
  saveProfile(profile)
  saveStatsStore(store)
  return { profile, store }
}
