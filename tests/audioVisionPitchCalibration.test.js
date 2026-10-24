/**
 * Guards for the Audio Vision note-extraction calibration.
 *
 * The values in NOTE_EXTRACTION were measured on real GuitarSet performances
 * and independently reproduced from current production on 2026-10-24:
 *
 *   five development takes:  arrangement F1 0.692 -> 0.724
 *   five unseen holdout:     arrangement F1 0.751 -> 0.807
 *                            precision      0.761 -> 0.906
 *                            invented       0.102 -> 0.038
 *
 * Same weights, same audio, same browser worker; only how the model's
 * probabilities become notes changed. A future threshold change must re-run
 * `scripts/audio-vision-threshold-sweep.mjs` and update this test deliberately.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOTE_EXTRACTION } from '../src/features/audio-vision/noteExtraction.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('Audio Vision note-extraction calibration', () => {
  it('keeps the measured threshold triple', () => {
    expect(NOTE_EXTRACTION).toEqual({
      onsetThreshold: 0.65,
      frameThreshold: 0.5,
      minNoteFrames: 3,
    })
  })

  it('is stricter than the library defaults it replaced', () => {
    expect(NOTE_EXTRACTION.onsetThreshold).toBeGreaterThan(0.5)
    expect(NOTE_EXTRACTION.frameThreshold).toBeGreaterThan(0.3)
    expect(NOTE_EXTRACTION.minNoteFrames).toBeLessThan(5)
  })

  it('is frozen so a caller cannot silently mutate the calibration', () => {
    expect(Object.isFrozen(NOTE_EXTRACTION)).toBe(true)
  })

  it('is the single source used by both the browser worker and the Node harness', () => {
    const worker = readFileSync(join(root, 'src/features/audio-vision/audioVisionPitchWorker.js'), 'utf8')
    const nodeHarness = readFileSync(join(root, 'scripts/lib/basicPitchNode.mjs'), 'utf8')
    expect(worker).toContain('NOTE_EXTRACTION.onsetThreshold')
    expect(worker).toContain('NOTE_EXTRACTION.frameThreshold')
    expect(worker).toContain('NOTE_EXTRACTION.minNoteFrames')
    expect(nodeHarness).toContain('onsetThreshold = 0.65')
    expect(nodeHarness).toContain('frameThreshold = 0.5')
    expect(nodeHarness).toContain('minNoteFrames = 3')
  })
})
