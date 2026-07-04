export const GUITAR_SCORE_TARGET = {
  NOTATION: 'notation',
  TAB: 'tab',
}

const STORAGE_PREFIX = 'scoreflow-guitar-score-target-v1-'

export function detectGuitarScoreTargetAvailability(timingMap) {
  const hasNotation = Boolean(timingMap?.notation?.hasStandardStaff)
  const hasTab = Boolean(timingMap?.notation?.hasTabStaff)
  const options = []

  if (hasNotation) {
    options.push({
      target: GUITAR_SCORE_TARGET.NOTATION,
      label: 'Follow notation',
      shortLabel: 'Notation',
    })
  }
  if (hasTab) {
    options.push({
      target: GUITAR_SCORE_TARGET.TAB,
      label: 'Follow TAB',
      shortLabel: 'TAB',
    })
  }

  const mode =
    hasNotation && hasTab
      ? 'notation-tab'
      : hasNotation
        ? 'notation-only'
        : hasTab
          ? 'tab-only'
          : 'none'

  return {
    mode,
    hasNotation,
    hasTab,
    options,
    selectable: options.length > 1,
    defaultTarget: hasNotation
      ? GUITAR_SCORE_TARGET.NOTATION
      : hasTab
        ? GUITAR_SCORE_TARGET.TAB
        : null,
  }
}

export function normalizeGuitarScoreTarget(value, availability) {
  const availableOptions = new Set(
    (availability?.options ?? []).map((option) => option.target),
  )
  if (availableOptions.has(value)) {
    return value
  }
  return availability?.defaultTarget ?? null
}

export function buildGuitarScoreTargetStorageKey({
  pdfFingerprint = null,
  pdfFileName = null,
  timingSourceId = null,
} = {}) {
  const base = pdfFingerprint || pdfFileName || timingSourceId
  if (!base) {
    return null
  }
  return `${STORAGE_PREFIX}${base}::${timingSourceId ?? 'timing'}`
}

export function loadGuitarScoreTargetPreference(storageKey) {
  if (!storageKey) {
    return null
  }
  try {
    const raw = localStorage.getItem(storageKey)
    return raw === GUITAR_SCORE_TARGET.NOTATION || raw === GUITAR_SCORE_TARGET.TAB
      ? raw
      : null
  } catch {
    return null
  }
}

export function saveGuitarScoreTargetPreference(storageKey, target) {
  if (
    !storageKey ||
    (target !== GUITAR_SCORE_TARGET.NOTATION && target !== GUITAR_SCORE_TARGET.TAB)
  ) {
    return
  }
  try {
    localStorage.setItem(storageKey, target)
  } catch {
    // Non-critical display preference; ignore storage failures.
  }
}

export function scopeScoreFollowIdentityForGuitarTarget(identity, availability, target) {
  if (!identity || availability?.mode !== 'notation-tab') {
    return identity
  }
  return target === GUITAR_SCORE_TARGET.TAB
    ? `${identity}::guitar-score-target=tab`
    : identity
}
