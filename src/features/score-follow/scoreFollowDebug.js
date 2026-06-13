/** Temporary score-follow decision logging (dev builds). */
export function logScoreFollowDecision(payload) {
  const isDev = import.meta.env?.DEV ?? globalThis.process?.env?.NODE_ENV !== 'production'
  if (!isDev) {
    return
  }
  console.info('[score-follow]', payload)
}
