/** The existing client owns one shared worker. Let a cancelled job finish its
 * cleanup before a replacement starts, without changing recognition code. */
export function createScorePreparationQueue() {
  let settled = Promise.resolve()
  return function run(prepare, signal) {
    const job = settled.then(() => {
      if (signal?.aborted) throw new DOMException('Score preparation cancelled.', 'AbortError')
      return prepare()
    })
    settled = job.catch(() => {})
    return job
  }
}

export const runScorePreparation = createScorePreparationQueue()
