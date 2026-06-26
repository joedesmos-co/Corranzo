export const DEMO_UNAVAILABLE_MESSAGE = 'Demo unavailable — refresh or try again.'

const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
  /load failed/i,
]

/** True when the failure looks like a stale or missing JS chunk after deploy. */
export function isDemoChunkLoadFailure(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (!message) {
    return false
  }
  if (CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }
  return /\/assets\/[\w-]+\.js/i.test(message)
}

/**
 * User-safe demo load errors — never surface raw module URLs or fetch stack text.
 */
export function formatDemoLoadError(error) {
  if (!error) {
    return DEMO_UNAVAILABLE_MESSAGE
  }
  const message = error instanceof Error ? error.message : String(error)
  if (isDemoChunkLoadFailure(error)) {
    return DEMO_UNAVAILABLE_MESSAGE
  }
  if (/demo file not found/i.test(message)) {
    return DEMO_UNAVAILABLE_MESSAGE
  }
  if (/network|failed to fetch|load failed/i.test(message)) {
    return 'Demo unavailable — check your connection and try again.'
  }
  return DEMO_UNAVAILABLE_MESSAGE
}
