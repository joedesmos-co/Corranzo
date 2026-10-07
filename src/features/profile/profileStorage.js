import { createEmptyStats, normalizeStats } from './profileStatsSchema.js'

export const STATS_STORAGE_KEY = 'scoreflow-practice-stats-v1'
export const STATS_BACKUP_KEY = 'scoreflow-practice-stats-v1:backup'
export const STATS_CORRUPT_KEY = 'scoreflow-practice-stats-v1:corrupt'

function getLocalStorage() {
  try {
    return typeof globalThis.localStorage === 'undefined'
      ? null
      : globalThis.localStorage
  } catch {
    return null
  }
}

function quarantineCorruptStats(raw) {
  const storage = getLocalStorage()
  if (!storage || raw == null) {
    return
  }
  try {
    const existing = storage.getItem(STATS_CORRUPT_KEY)
    if (existing !== raw) {
      storage.setItem(STATS_CORRUPT_KEY, raw)
    }
  } catch {
    // ignore quarantine failures
  }
}

function tryParseStats(raw) {
  if (!raw) {
    return null
  }
  try {
    return { corrupt: false, parsed: JSON.parse(raw) }
  } catch {
    return { corrupt: true, parsed: null }
  }
}

/**
 * Detailed loader: never silently degrades corrupt bytes to empty.
 * Returns { stats, corrupted, recoveredFromBackup, status }.
 * - none: no bytes stored anywhere.
 * - ok: current bytes valid.
 * - recovered: current corrupt, backup valid (last-good returned).
 * - corrupted: bytes existed but neither current nor backup is usable.
 * The app never overwrites corrupt bytes merely by opening.
 */
export function loadStatsWithStatus() {
  const storage = getLocalStorage()
  if (!storage) {
    return { stats: createEmptyStats(), corrupted: false, recoveredFromBackup: false, status: 'unavailable' }
  }
  try {
    const raw = storage.getItem(STATS_STORAGE_KEY)
    if (!raw) {
      try {
        const backupRaw = storage.getItem(STATS_BACKUP_KEY)
        const backup = tryParseStats(backupRaw)
        if (backup && !backup.corrupt && backup.parsed) {
          return {
            stats: normalizeStats(backup.parsed),
            corrupted: false,
            recoveredFromBackup: true,
            status: 'recovered',
          }
        }
      } catch {
        // ignore
      }
      return { stats: createEmptyStats(), corrupted: false, recoveredFromBackup: false, status: 'none' }
    }
    const current = tryParseStats(raw)
    if (!current.corrupt) {
      try {
        return { stats: normalizeStats(current.parsed), corrupted: false, recoveredFromBackup: false, status: 'ok' }
      } catch {
        quarantineCorruptStats(raw)
      }
    } else {
      quarantineCorruptStats(raw)
    }
    try {
      const backupRaw = storage.getItem(STATS_BACKUP_KEY)
      const backup = tryParseStats(backupRaw)
      if (backup && !backup.corrupt && backup.parsed) {
        return {
          stats: normalizeStats(backup.parsed),
          corrupted: true,
          recoveredFromBackup: true,
          status: 'recovered',
        }
      }
    } catch {
      // ignore
    }
    return { stats: createEmptyStats(), corrupted: true, recoveredFromBackup: false, status: 'corrupted' }
  } catch {
    return { stats: createEmptyStats(), corrupted: false, recoveredFromBackup: false, status: 'none' }
  }
}

export function loadStats() {
  return loadStatsWithStatus().stats
}

export function saveStats(stats) {
  const storage = getLocalStorage()
  if (!storage) {
    return false
  }

  try {
    // Preserve last-good before overwriting. localStorage.setItem is atomic:
    // a quota throw leaves the current value intact.
    try {
      const currentRaw = storage.getItem(STATS_STORAGE_KEY)
      if (currentRaw) {
        const current = tryParseStats(currentRaw)
        if (!current.corrupt) {
          try {
            storage.setItem(STATS_BACKUP_KEY, currentRaw)
          } catch {
            // ignore backup failures
          }
        }
      }
    } catch {
      // ignore backup read failures
    }
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
    try {
      storage.removeItem(STATS_BACKUP_KEY)
    } catch {
      // ignore
    }
    try {
      storage.removeItem(STATS_CORRUPT_KEY)
    } catch {
      // ignore
    }
    return true
  } catch {
    return false
  }
}
