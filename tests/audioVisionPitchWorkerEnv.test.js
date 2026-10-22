import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Regression cover for the Audio Vision 90% stall.
 *
 * TF.js's browser platform guards its custom-timer path with a bare
 * `!window`:
 *
 *     setTimeoutCustom(func, delay) {
 *       if (!window || !ENV.getBool('USE_SETTIMEOUTCUSTOM')) { setTimeout(func, delay); return }
 *       ...
 *     }
 *
 * In a Web Worker `window` is not declared, so that probe throws
 * "ReferenceError: Can't find variable: window" instead of falling back to the
 * platform timer. The throw happens inside the WebGL backend's fence polling,
 * so the fence promise never settles, `evaluateModel()` never returns and the
 * worker never posts its result — the arrangement generation stalls at 90%
 * forever, with no error and no way to retry.
 */
describe('audio vision pitch worker environment', () => {
  it('the worker imports the environment shim before TF.js', () => {
    const source = readFileSync(
      join(root, 'src', 'features', 'audio-vision', 'audioVisionPitchWorker.js'),
      'utf8',
    )
    const shimImport = source.indexOf("import './audioVisionWorkerEnv.js'")
    const tfjsImport = source.indexOf('@tensorflow/tfjs')
    expect(shimImport).toBeGreaterThan(-1)
    expect(tfjsImport).toBeGreaterThan(-1)
    expect(shimImport).toBeLessThan(tfjsImport)
  })

  it('declares window as undefined so the bare `!window` probe cannot throw', async () => {
    // Simulate a worker scope: `self` exists, `window` does not.
    const hadSelf = 'self' in globalThis
    const hadWindow = 'window' in globalThis
    globalThis.self = globalThis
    delete globalThis.window
    try {
      await import('../src/features/audio-vision/audioVisionWorkerEnv.js')
      // `typeof window` must still read "undefined" so every other TF.js
      // feature probe is unchanged...
      expect(typeof globalThis.window).toBe('undefined')
      // ...and evaluating the bare probe must NOT throw (that is the bug).
      expect(() => !globalThis.window).not.toThrow()
      expect(!globalThis.window).toBe(true)
    } finally {
      if (!hadSelf) delete globalThis.self
      if (hadWindow) globalThis.window = undefined
    }
  })

  it('is idempotent and does not disturb an existing window', async () => {
    const hadWindow = 'window' in globalThis
    const original = globalThis.window
    globalThis.self = globalThis
    globalThis.window = { marker: true }
    try {
      await import('../src/features/audio-vision/audioVisionWorkerEnv.js')
      expect(globalThis.window.marker).toBe(true)
    } finally {
      if (!hadWindow) delete globalThis.window
      else globalThis.window = original
    }
  })
})
