/**
 * Practice input-source modal: shown once when entering Practice so the same
 * choice applies to Play Along and Wait For You.
 */

export function shouldShowPracticeInputSourceModal({
  practiceActive = false,
  sourceSelectedThisSession = false,
} = {}) {
  return Boolean(practiceActive && !sourceSelectedThisSession)
}

export function practiceInputSourceIsReady({
  sourceSelectedThisSession = false,
} = {}) {
  return Boolean(sourceSelectedThisSession)
}

/** @deprecated Use shouldShowPracticeInputSourceModal */
export function shouldShowWaitForYouInputSourceModal({
  isWaitForYou = false,
  practiceActive = isWaitForYou,
  sourceSelectedThisSession = false,
} = {}) {
  return shouldShowPracticeInputSourceModal({ practiceActive, sourceSelectedThisSession })
}

/** @deprecated Use practiceInputSourceIsReady */
export function waitForYouInputSourceIsReady({
  sourceSelectedThisSession = false,
} = {}) {
  return practiceInputSourceIsReady({ sourceSelectedThisSession })
}
