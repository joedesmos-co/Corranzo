import { getLevelFromXp } from './practiceXp.js'

function toLocalDayKey(timestamp) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayDiff(laterKey, earlierKey) {
  const later = new Date(`${laterKey}T12:00:00`)
  const earlier = new Date(`${earlierKey}T12:00:00`)
  return Math.round((later - earlier) / 86400000)
}

export function computeStreakFromSessions(sessions) {
  const practiceDays = [
    ...new Set(
      sessions
        .filter((session) => session.completed || session.practiceSecondsActive >= 60)
        .map((session) => toLocalDayKey(session.endedAt ?? session.startedAt)),
    ),
  ].sort()

  if (practiceDays.length === 0) {
    return { current: 0, longest: 0, lastPracticeDay: null }
  }

  let longest = 1
  let run = 1
  for (let index = 1; index < practiceDays.length; index += 1) {
    if (dayDiff(practiceDays[index], practiceDays[index - 1]) === 1) {
      run += 1
      longest = Math.max(longest, run)
    } else {
      run = 1
    }
  }

  const today = toLocalDayKey(Date.now())
  const lastDay = practiceDays[practiceDays.length - 1]
  let current = 0
  if (dayDiff(today, lastDay) <= 1) {
    current = 1
    for (let index = practiceDays.length - 2; index >= 0; index -= 1) {
      if (dayDiff(practiceDays[index + 1], practiceDays[index]) === 1) {
        current += 1
      } else {
        break
      }
    }
  }

  return { current, longest, lastPracticeDay: lastDay }
}

export function computeWeeklyPracticeMinutes(sessions, days = 7) {
  const buckets = []
  const now = new Date()
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - offset)
    buckets.push({
      dayKey: toLocalDayKey(date.getTime()),
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      minutes: 0,
    })
  }

  const bucketByKey = Object.fromEntries(buckets.map((bucket) => [bucket.dayKey, bucket]))

  for (const session of sessions) {
    const key = toLocalDayKey(session.endedAt ?? session.startedAt)
    if (bucketByKey[key]) {
      bucketByKey[key].minutes += Math.round((session.practiceSecondsActive ?? 0) / 60)
    }
  }

  const maxMinutes = Math.max(1, ...buckets.map((bucket) => bucket.minutes))
  return buckets.map((bucket) => ({
    ...bucket,
    heightPercent: Math.round((bucket.minutes / maxMinutes) * 100),
  }))
}

export function computePracticeHeatmap(sessions, weeks = 12) {
  const dayTotals = {}
  for (const session of sessions) {
    const key = toLocalDayKey(session.endedAt ?? session.startedAt)
    dayTotals[key] = (dayTotals[key] ?? 0) + (session.practiceSecondsActive ?? 0)
  }

  const cells = []
  const today = new Date()
  for (let index = weeks * 7 - 1; index >= 0; index -= 1) {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    const key = toLocalDayKey(date.getTime())
    const seconds = dayTotals[key] ?? 0
    let level = 0
    if (seconds >= 900) {
      level = 4
    } else if (seconds >= 600) {
      level = 3
    } else if (seconds >= 300) {
      level = 2
    } else if (seconds > 0) {
      level = 1
    }
    cells.push({ dayKey: key, level })
  }
  return cells
}

export function computeWfyAccuracyTrend(sessions, limit = 8) {
  const withAttempts = sessions
    .filter((session) => (session.wfyNotesAttempted ?? 0) > 0)
    .slice(0, limit)
    .reverse()

  return withAttempts.map((session) => {
    const attempted = session.wfyNotesAttempted ?? 0
    const matched = session.wfyNotesMatched ?? 0
    const percent = attempted > 0 ? Math.round((matched / attempted) * 100) : null
    return {
      sessionId: session.id,
      label: new Date(session.endedAt ?? session.startedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      percent,
    }
  })
}

export function rankPieces(piecesRecord, limit = 6) {
  return Object.values(piecesRecord ?? {})
    .sort((left, right) => (right.totalSeconds ?? 0) - (left.totalSeconds ?? 0))
    .slice(0, limit)
}

export function computeProfileMetrics(store, profile) {
  const sessions = [...(store.sessions ?? [])].sort(
    (left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt),
  )

  const streak = computeStreakFromSessions(sessions)
  const weeklyChart = computeWeeklyPracticeMinutes(sessions)
  const heatmap = computePracticeHeatmap(sessions)
  const wfyTrend = computeWfyAccuracyTrend(sessions)
  const recentSessions = sessions.slice(0, 8)
  const favoritePieces = rankPieces(store.pieces)
  const uniquePieces = Object.keys(store.pieces ?? {}).length

  const totals = store.totals ?? {}
  const notesAttempted = totals.notesAttempted ?? 0
  const notesMatched = totals.notesMatched ?? 0
  const accuracyPercent =
    notesAttempted > 0 ? Math.round((notesMatched / notesAttempted) * 100) : null

  const level = getLevelFromXp(totals.xp ?? 0)
  const totalPracticeMinutes = Math.round((totals.practiceSecondsActive ?? 0) / 60)

  return {
    displayName: profile.displayName,
    totalPracticeMinutes,
    totalPracticeHours: (totals.practiceSecondsActive ?? 0) / 3600,
    sessionsCompleted: totals.sessionsCompleted ?? 0,
    uniquePieces,
    notesMatched,
    notesAttempted,
    accuracyPercent,
    waitForYouMinutes: Math.round((totals.waitForYouSeconds ?? 0) / 60),
    loopsPracticed: totals.loopsPracticed ?? 0,
    streak,
    level,
    weeklyChart,
    heatmap,
    wfyTrend,
    recentSessions,
    favoritePieces,
  }
}
