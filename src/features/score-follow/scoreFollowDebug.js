/** Temporary score-follow decision logging (dev builds). */
export function logScoreFollowDecision(payload) {
  const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV !== 'production'
  if (!isDev) {
    return
  }
  console.info('[score-follow]', payload)
}
