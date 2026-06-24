import { hasUserUnlockedAudio } from './toneAudioUnlock.js'

/**
 * Resume suspended Web Audio contexts when the tab becomes visible again.
 * Skips resume before the user has unlocked audio (avoids console spam).
 */
export function setupAudioVisibilityResume(getContexts, { onlyAfterUserUnlock = false } = {}) {
  if (typeof document === 'undefined') {
    return () => {}
  }

  const handleVisibility = () => {
    if (document.visibilityState !== 'visible') {
      return
    }
    if (onlyAfterUserUnlock && !hasUserUnlockedAudio()) {
      return
    }
    resumeContexts(getContexts)
  }

  document.addEventListener('visibilitychange', handleVisibility)
  return () => document.removeEventListener('visibilitychange', handleVisibility)
}

function resumeContexts(getContexts) {
  const contexts = typeof getContexts === 'function' ? getContexts() : []
  for (const context of contexts) {
    if (context?.state === 'suspended') {
      context.resume().catch(() => {})
    }
  }
}

export async function resumeAudioContext(context) {
  if (context?.state === 'suspended') {
    try {
      await context.resume()
    } catch {
      // ignore
    }
  }
}
