/**
 * Per-arrangement note correction persistence.
 *
 * Corrections are keyed by BOTH the recording identity and the arrangement
 * settings. A correction belongs to the score the musician reviewed: switching
 * target instrument, difficulty or excerpt must not silently remove a note
 * from a different arrangement of the same audio.
 *
 * The recording identity is the same fingerprint used for tempo corrections
 * (name + size + lastModified), so it survives reloads and never applies to an
 * unrelated file. The store is deliberately tiny and quota-tolerant, mirroring
 * tempoCorrectionStorage.js: localStorage, safe JSON, null/false on failure.
 */
import {
  createNoteCorrections,
  parseNoteCorrections,
  serializeNoteCorrections,
} from './noteCorrections.js'

const STORAGE_PREFIX = 'corranzo-audio-vision-corrections-v1'

function excerptIdentity(excerpt) {
  if (!excerpt) return 'full'
  const start = Number(excerpt.startSeconds)
  const duration = Number(excerpt.durationSeconds)
  if (!Number.isFinite(start) || !Number.isFinite(duration)) return 'full'
  return `${Math.round(start * 100) / 100}+${Math.round(duration * 100) / 100}`
}

function arrangementIdentity({ targetPart = null, difficulty = null, excerpt = null } = {}) {
  return [
    String(targetPart ?? ''),
    String(difficulty ?? ''),
    excerptIdentity(excerpt),
  ].join('::')
}

export function getNoteCorrectionStorageKey(fingerprint, settings = {}) {
  if (!fingerprint) return null
  return `${STORAGE_PREFIX}:${fingerprint}::${arrangementIdentity(settings)}`
}

/** Load corrections for this recording + arrangement. Always returns a record. */
export function loadNoteCorrections(fingerprint, settings = {}) {
  const key = getNoteCorrectionStorageKey(fingerprint, settings)
  if (!key || typeof localStorage === 'undefined') return createNoteCorrections()
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return createNoteCorrections()
    return parseNoteCorrections(JSON.parse(raw))
  } catch {
    return createNoteCorrections()
  }
}

/** Persist corrections. An empty set removes the key (Undo/Clear really clears). */
export function saveNoteCorrections(fingerprint, settings, corrections) {
  const key = getNoteCorrectionStorageKey(fingerprint, settings)
  if (!key || typeof localStorage === 'undefined') return false
  try {
    const serialized = serializeNoteCorrections(corrections)
    if (serialized.removed.length === 0) {
      localStorage.removeItem(key)
      return true
    }
    localStorage.setItem(
      key,
      JSON.stringify({ ...serialized, updatedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

export function clearNoteCorrections(fingerprint, settings) {
  return saveNoteCorrections(fingerprint, settings, createNoteCorrections())
}
