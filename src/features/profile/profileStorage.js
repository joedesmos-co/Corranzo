import { createEmptyStats, normalizeStats } from './profileStatsSchema.js'

export const STATS_STORAGE_KEY = 'scoreflow-practice-stats-v1'

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    return null
  }
}

export function loadStats() {
  const storage = getLocalStorage()
  if (!storage) {
    return createEmptyStats()
  }

  try {
    const raw = storage.getItem(STATS_STORAGE_KEY)
    return raw ? normalizeStats(JSON.parse(raw)) : createEmptyStats()
  } catch {
    return createEmptyStats()
  }
}

export function saveStats(stats) {
  const storage = getLocalStorage()
  if (!storage) {
    return false
  }

  try {
    storage.setItem(STATS_STORAGE_KEY, JSON.stringify(normalizeStats(stats)))
    return true
  } catch {
    return false
  }
}

export function clearStats() {
  const storage = getLocalStorage()
  if (!storage) {
    return false
  }

  try {
    storage.removeItem(STATS_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
