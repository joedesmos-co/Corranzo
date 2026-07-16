/**
 * Real mic polyphony corpus tooling — UIowa import + capture script wiring.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadMicPolyphonyManifest } from '../src/features/microphone-input/micPolyphonyManifest.js'
import { loadMicAccuracyManifest } from '../src/features/microphone-input/micAccuracyManifest.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

describe('real mic polyphony corpus tooling', () => {
  it('wires npm scripts for UIowa import and developer capture', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['mic:import-uiowa-fixtures']).toContain('import-uiowa-mic-fixtures.mjs')
    expect(pkg.scripts['mic:capture-real-fixture']).toContain('capture-real-mic-fixture.mjs')
    expect(existsSync(join(root, 'scripts/import-uiowa-mic-fixtures.mjs'))).toBe(true)
    expect(existsSync(join(root, 'scripts/capture-real-mic-fixture.mjs'))).toBe(true)
  })

  it('keeps capture gated behind CORRANZO_DEVELOPER_MODE', () => {
    const src = readFileSync(join(root, 'scripts/capture-real-mic-fixture.mjs'), 'utf8')
    expect(src).toContain('CORRANZO_DEVELOPER_MODE')
    expect(src).toContain('--from-wav')
    expect(src).toContain('developer-live-mic')
    expect(src).toContain('assertAudibleCapture')
    expect(src).toContain('Refusing silent capture')
  })

  it('vendors UIowa-derived accuracy and polyphony fixtures with attribution', () => {
    const accuracy = loadMicAccuracyManifest(join(root, 'benchmarks/mic-accuracy/manifest.json'))
    const polyphony = loadMicPolyphonyManifest(join(root, 'benchmarks/mic-polyphony/manifest.json'))

    const accuracyUiowa = accuracy.clips.filter((clip) => clip.id.startsWith('uiowa-'))
    const polyUiowa = polyphony.clips.filter((clip) => clip.id.startsWith('uiowa-'))
    expect(accuracyUiowa.length).toBeGreaterThanOrEqual(3)
    expect(polyUiowa.length).toBeGreaterThanOrEqual(9)

    for (const clip of accuracyUiowa) {
      expect(clip.sourceType).toBe('uiowa-mis-derived')
      expect(clip.redistribution).toBe('uiowa-mis-unrestricted')
      expect(clip.attribution).toMatch(/University of Iowa/i)
      expect(existsSync(join(root, 'benchmarks/mic-accuracy', clip.file))).toBe(true)
    }

    for (const clip of polyUiowa) {
      expect(clip.sourceType).toBe('uiowa-mis-derived')
      expect(clip.redistribution).toBe('uiowa-mis-unrestricted')
      expect(clip.attribution).toMatch(/University of Iowa/i)
      expect(existsSync(join(root, 'benchmarks/mic-polyphony', clip.file))).toBe(true)
      expect(Array.isArray(clip.expectedMidis)).toBe(true)
      expect(clip.expectedMidis.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('documents Sprint 2 chord reliability metrics in the polyphony report', () => {
    const report = readFileSync(
      join(root, 'src/features/microphone-input/micPolyphonyReport.js'),
      'utf8',
    )
    expect(report).toContain('exactChordHitRate')
    expect(report).toContain('requiredToneRecall')
    expect(report).toContain('wrongToneAcceptanceRate')
    expect(report).toContain('firstAttemptSuccessRate')
    expect(report).toContain('meanTimeToConfirmationMs')
    expect(report).toContain('falseAdvanceRate')
  })

  it('documents the sprint measurement policy', () => {
    const doc = readFileSync(join(root, 'docs/MIC_REAL_POLYPHONY_SPRINT.md'), 'utf8')
    expect(doc).toContain('mic:import-uiowa-fixtures')
    expect(doc).toContain('Exact chord hit')
    expect(doc).toContain('CORRANZO_DEVELOPER_MODE')
  })

  it('auto-starts preview for browser mic QA when no SMOKE_BASE_URL is set', () => {
    const src = readFileSync(join(root, 'scripts/browser-mic-wfy-qa.mjs'), 'utf8')
    expect(src).toContain('ensurePreviewServer')
    expect(src).toContain("'run', 'preview'")
    expect(src).toContain('Starts `npm run preview` automatically')
  })
})
