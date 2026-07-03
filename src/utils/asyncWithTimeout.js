export class AsyncTimeoutError extends Error {
  constructor(message = 'Operation timed out.') {
    super(message)
    this.name = 'AsyncTimeoutError'
  }
}

/**
 * Reject when `promise` does not settle within `timeoutMs`.
 */
export function withTimeout(promise, timeoutMs, message = 'Operation timed out.') {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.resolve(promise)
  }

  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new AsyncTimeoutError(message))
    }, timeoutMs)

    Promise.resolve(promise)
      .then((value) => {
        globalThis.clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        globalThis.clearTimeout(timeoutId)
        reject(error)
      })
  })
}
