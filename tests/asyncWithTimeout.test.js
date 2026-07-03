import { describe, expect, it } from 'vitest'
import { AsyncTimeoutError, withTimeout } from '../src/utils/asyncWithTimeout.js'

describe('withTimeout', () => {
  it('resolves when the promise settles before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('rejects with AsyncTimeoutError when the deadline passes first', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 20, 'Timed out waiting.'),
    ).rejects.toMatchObject({
      name: 'AsyncTimeoutError',
      message: 'Timed out waiting.',
    })
  })

  it('forwards the original rejection', async () => {
    const failing = (async () => {
      throw new Error('boom')
    })()
    await expect(withTimeout(failing, 50)).rejects.toThrow('boom')
  })
})
