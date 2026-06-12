/**
 * Resume suspended Web Audio contexts when the tab becomes visible again.
 */
export function setupAudioVisibilityResume(getContexts) {
  if (typeof document === 'undefined') {
    return () => {}
  }

  const handleVisibility = () => {
    if (document.visibilityState !== 'visible') {
      return
    }
    const contexts = typeof getContexts === 'function' ? getContexts() : []
    for (const context of contexts) {
      if (context?.state === 'suspended') {
        context.resume().catch(() => {})
      }
    }
  }

  document.addEventListener('visibilitychange', handleVisibility)
  return () => document.removeEventListener('visibilitychange', handleVisibility)
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
