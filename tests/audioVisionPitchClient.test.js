import { afterEach, describe, expect, it } from 'vitest'

/**
 * Regression cover for the Audio Vision 90% stall.
 *
 * A pitch job that is never settled leaves the generation stuck at its last
 * reported percentage forever: no arrangement, no error, no way to retry. Every
 * job the client starts must therefore reach a terminal state — resolved,
 * rejected (the caller then falls back to the inline path), or timed out.
 */

class FakeWorker {
  static instances = []

  constructor() {
    this.onmessage = null
    this.onerror = null
    this.onmessageerror = null
    this.posted = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }

  postMessage(message) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }
}

function withFakeWorker(fn) {
  const originalWorker = globalThis.Worker
  const hadDocument = 'document' in globalThis
  const originalDocument = globalThis.document
  FakeWorker.instances = []
  globalThis.Worker = FakeWorker
  // The client resolves the model URL against the document base.
  globalThis.document = { baseURI: 'https://corranzo.com/' }
  return Promise.resolve(fn()).finally(() => {
    if (originalWorker === undefined) delete globalThis.Worker
    else globalThis.Worker = originalWorker
    if (!hadDocument) delete globalThis.document
    else globalThis.document = originalDocument
  })
}

afterEach(() => {
  if (globalThis.Worker === FakeWorker) delete globalThis.Worker
})

describe('audio vision pitch client — a job always settles', () => {
  it('rejects when the worker reports a failure', async () => {
    await withFakeWorker(async () => {
      const { inferNotesInWorker, disposePitchWorker } = await import(
        '../src/features/audio-vision/audioVisionPitchClient.js'
      )
      const promise = inferNotesInWorker(new Float32Array(22050))
      const worker = FakeWorker.instances[0]
      expect(worker).toBeTruthy()
      const jobId = worker.posted[0].jobId
      // The worker answers with a failure (e.g. the model could not load).
      worker.onmessage({ data: { jobId, ok: false, error: 'model unavailable' } })
      await expect(promise).rejects.toThrow(/model unavailable/)
      disposePitchWorker()
    })
  })

  it('rejects every pending job when the worker crashes', async () => {
    await withFakeWorker(async () => {
      const { inferNotesInWorker, disposePitchWorker } = await import(
        '../src/features/audio-vision/audioVisionPitchClient.js'
      )
      const promise = inferNotesInWorker(new Float32Array(22050))
      const worker = FakeWorker.instances[0]
      worker.onerror({ message: 'worker crashed' })
      await expect(promise).rejects.toThrow(/worker crashed/)
      disposePitchWorker()
    })
  })

  it('rejects when the worker cannot deliver a message', async () => {
    await withFakeWorker(async () => {
      const { inferNotesInWorker, disposePitchWorker } = await import(
        '../src/features/audio-vision/audioVisionPitchClient.js'
      )
      const promise = inferNotesInWorker(new Float32Array(22050))
      const worker = FakeWorker.instances[0]
      worker.onmessageerror({})
      await expect(promise).rejects.toThrow(/message error/)
      disposePitchWorker()
    })
  })

  it('times out a job the worker simply stops answering', async () => {
    await withFakeWorker(async () => {
      const { inferNotesInWorker, disposePitchWorker } = await import(
        '../src/features/audio-vision/audioVisionPitchClient.js'
      )
      // A short explicit limit keeps the test fast; production uses a limit
      // scaled by the recording length.
      const promise = inferNotesInWorker(new Float32Array(22050), { timeoutMs: 40 })
      await expect(promise).rejects.toThrow(/timed out/)
      disposePitchWorker()
    })
  })

  it('resolves with the notes the worker produced', async () => {
    await withFakeWorker(async () => {
      const { inferNotesInWorker, disposePitchWorker } = await import(
        '../src/features/audio-vision/audioVisionPitchClient.js'
      )
      const promise = inferNotesInWorker(new Float32Array(22050))
      const worker = FakeWorker.instances[0]
      const jobId = worker.posted[0].jobId
      worker.onmessage({ data: { jobId, progress: 0.5 } })
      worker.onmessage({
        data: {
          jobId,
          ok: true,
          notes: [{ midi: 60, startOffsetSeconds: 0, endOffsetSeconds: 1 }],
        },
      })
      await expect(promise).resolves.toEqual([
        { midi: 60, startOffsetSeconds: 0, endOffsetSeconds: 1 },
      ])
      disposePitchWorker()
    })
  })
})
