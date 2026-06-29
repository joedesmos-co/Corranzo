import { loadStats, saveStats } from './profileStorage.js'
import { reconcileProfileStats } from './profileStatsSchema.js'

let activeSession = null
let lastTickAt = null

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function resolvePracticePieceId({
  pdfFingerprint = null,
  pdfFileName = null,
  musicXmlFileName = null,
}) {
  if (pdfFingerprint) {
    return `piece:${pdfFingerprint}`
  }
  const name = musicXmlFileName || pdfFileName
  if (name) {
    const slug = slugify(name.replace(/\.[^.]+$/, ''))
    return slug ? `piece:${slug}` : null
  }
  return null
}

function normalizePieceTitle(title) {
  if (typeof title === 'string' && title.trim()) {
    return title.trim().slice(0, 120)
  }
  return 'Untitled piece'
}

export function beginAutoPracticeSession(piece) {
  const id = String(piece?.id ?? '').trim()
  if (!id) {
    activeSession = null
    lastTickAt = null
    return null
  }

  activeSession = {
    pieceId: id,
    pieceTitle: normalizePieceTitle(piece.title),
    startedAt: Date.now(),
    accumulatedSeconds: 0,
    measuresVisited: new Set(),
    loopsCompleted: 0,
    tempoBpm: null,
    wfyCorrect: 0,
    wfyMissed: 0,
    wfySkipped: 0,
    wfyManualContinues: 0,
  }
  lastTickAt = Date.now()
  return snapshotActiveSession()
}

export function snapshotActiveSession() {
  if (!activeSession) {
    return null
  }
  return {
    pieceId: activeSession.pieceId,
    pieceTitle: activeSession.pieceTitle,
    startedAt: activeSession.startedAt,
    practiceSeconds: activeSession.accumulatedSeconds,
    measuresPlayed: activeSession.measuresVisited.size,
    loopsCompleted: activeSession.loopsCompleted,
    tempoBpm: activeSession.tempoBpm,
    wfyCorrect: activeSession.wfyCorrect,
    wfyMissed: activeSession.wfyMissed,
    wfySkipped: activeSession.wfySkipped,
    wfyManualContinues: activeSession.wfyManualContinues,
  }
}

export function tickAutoPracticeSession() {
  if (!activeSession || !lastTickAt) {
    return 0
  }
  const now = Date.now()
  const delta = Math.floor((now - lastTickAt) / 1000)
  if (delta >= 1) {
    activeSession.accumulatedSeconds += delta
    lastTickAt = now
  }
  return activeSession.accumulatedSeconds
}

export function recordAutoPracticeMeasure(measureNumber) {
  if (!activeSession || measureNumber == null) {
    return
  }
  activeSession.measuresVisited.add(measureNumber)
}

export function recordAutoPracticeLoop() {
  if (!activeSession) {
    return
  }
  activeSession.loopsCompleted += 1
}

export function recordAutoPracticeTempo(bpm) {
  if (!activeSession || !Number.isFinite(bpm) || bpm <= 0) {
    return
  }
  activeSession.tempoBpm = Math.round(bpm)
}

export function recordWfyPracticeEvent(type) {
  if (!activeSession) {
    return
  }
  switch (type) {
    case 'correct':
      activeSession.wfyCorrect += 1
      break
    case 'missed':
      activeSession.wfyMissed += 1
      break
    case 'skipped':
      activeSession.wfySkipped += 1
      break
    case 'manual-continue':
      activeSession.wfyManualContinues += 1
      break
    default:
      break
  }
}

function applySessionToStats(stats, session) {
  const pieceId = session.pieceId
  const existing = stats.pieces[pieceId] ?? {
    id: pieceId,
    title: session.pieceTitle,
  }
  const endedAt = Date.now()
  const duration = session.accumulatedSeconds

  return reconcileProfileStats({
    ...stats,
    autoPracticeSeconds: (stats.autoPracticeSeconds ?? 0) + duration,
    lastAutoPracticedAt: endedAt,
    pieces: {
      ...stats.pieces,
      [pieceId]: {
        ...existing,
        id: pieceId,
        title: session.pieceTitle,
        autoPracticeSeconds: (existing.autoPracticeSeconds ?? 0) + duration,
        measuresPlayed:
          (existing.measuresPlayed ?? 0) + session.measuresVisited.size,
        loopsCompleted: (existing.loopsCompleted ?? 0) + session.loopsCompleted,
        lastTempoBpm: session.tempoBpm ?? existing.lastTempoBpm ?? null,
        wfyCorrect: (existing.wfyCorrect ?? 0) + session.wfyCorrect,
        wfyMissed: (existing.wfyMissed ?? 0) + session.wfyMissed,
        wfySkipped: (existing.wfySkipped ?? 0) + session.wfySkipped,
        lastPracticedAt: endedAt,
      },
    },
  })
}

export function endAutoPracticeSession() {
  tickAutoPracticeSession()
  if (!activeSession) {
    return loadStats()
  }
  const stats = loadStats()
  const next = applySessionToStats(stats, activeSession)
  saveStats(next)
  activeSession = null
  lastTickAt = null
  return next
}

/** Test helper — reset in-memory session without touching storage. */
export function __resetAutoPracticeSession() {
  activeSession = null
  lastTickAt = null
}
