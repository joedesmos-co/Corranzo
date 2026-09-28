import { describe, expect, it, vi } from 'vitest'
import { createScorePreparationQueue } from '../src/features/import/scorePreparationQueue.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('replacement score preparation', () => {
  it('does not start the new worker until the cancelled job has completed cleanup', async () => {
    const run = createScorePreparationQueue()
    const cleanup = deferred()
    const first = run(() => cleanup.promise)
    const startReplacement = vi.fn(() => 'new score')
    const second = run(startReplacement)
    await Promise.resolve()
    expect(startReplacement).not.toHaveBeenCalled()
    cleanup.resolve('old worker closed')
    await first
    expect(await second).toBe('new score')
    expect(startReplacement).toHaveBeenCalledTimes(1)
  })
  it('does not let a failed job block a retry', async () => {
    const run = createScorePreparationQueue()
    const failed = run(() => { throw new Error('bad scan') })
    const retry = run(() => 'prepared')
    await expect(failed).rejects.toThrow('bad scan')
    await expect(retry).resolves.toBe('prepared')
  })
  it('skips a queued import cancelled before it starts, then runs the latest score', async () => {
    const run = createScorePreparationQueue()
    const cleanup = deferred()
    const first = run(() => cleanup.promise)
    const cancelled = new AbortController()
    const staleWorker = vi.fn()
    const middle = run(staleWorker, cancelled.signal)
    const latest = run(() => 'latest')
    cancelled.abort()
    const rejected = expect(middle).rejects.toMatchObject({ name: 'AbortError' })
    cleanup.resolve()
    await first
    await rejected
    expect(staleWorker).not.toHaveBeenCalled()
    await expect(latest).resolves.toBe('latest')
  })
})
