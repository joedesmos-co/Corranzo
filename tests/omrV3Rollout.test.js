import { describe, expect, it } from 'vitest'
import { runPdfOmrPipeline } from '../src/features/omr/runPdfOmrPipeline.js'
import {
  DEFAULT_OMR_V3_ROLLOUT,
  resolveOmrV3RolloutOptions,
} from '../src/features/omr/v3/omrV3Rollout.js'
import { rhythmicPianoPage, renderPagesFromArray } from './helpers/syntheticScore.js'

describe('OMR V3 disabled-by-default rollout', () => {
  it('keeps every promotion off until a later explicit gated implementation', () => {
    expect(DEFAULT_OMR_V3_ROLLOUT.shadow).toBe(false)
    expect(Object.values(DEFAULT_OMR_V3_ROLLOUT.promotions).every((value) => value === false)).toBe(true)

    const requested = resolveOmrV3RolloutOptions({
      shadow: true,
      promotions: { structure: true, fullV3: true },
    })
    expect(requested).toMatchObject({
      shadow: true,
      mode: 'shadow',
      anyPromotionRequested: true,
      anyPromotionEnabled: false,
      promotedToRuntime: false,
    })
    expect(Object.values(requested.promotions).every((value) => value === false)).toBe(true)
  })

  it('runs V3 beside production while preserving production MusicXML byte-for-byte', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const base = {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      title: 'v3-shadow-rollout',
    }
    const production = await runPdfOmrPipeline('synthetic', base)
    const shadow = await runPdfOmrPipeline('synthetic', { ...base, omrV3Shadow: true })

    expect(shadow.musicXml).toBe(production.musicXml)
    expect(production).not.toHaveProperty('omrV3Shadow')
    expect(shadow.omrV3Shadow).toMatchObject({
      status: 'ready',
      engine: 'omr-v3-shadow',
      promotedToRuntime: false,
    })
    expect(shadow.omrV3Shadow.musicXml).not.toBe(shadow.musicXml)
    expect(shadow.omrV3Shadow.debugJson).toContain('"schemaVersion": 1')
    expect(shadow.omrV3Shadow.serializer.promotedToRuntime).toBe(false)
  })

  it('suppresses shadow analysis with the rollback switch', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    const result = await runPdfOmrPipeline('synthetic', {
      numPages: 1,
      preprocessPages: false,
      renderPage: renderPagesFromArray([page]),
      title: 'v3-shadow-rollback',
      omrV3Shadow: true,
      omrV3Rollback: true,
    })

    expect(result.omrV3Shadow).toMatchObject({
      status: 'disabled-by-rollback',
      promotedToRuntime: false,
      rollout: { mode: 'off', rollback: true },
    })
  })
})
