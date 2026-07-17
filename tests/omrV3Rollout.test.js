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
    expect(shadow.omrV3Shadow.evidence.independentPrimaryEventRate).toBe(0)
    expect(shadow.omrV3IndependentShadow).toMatchObject({
      status: 'ready',
      engine: 'omr-v3-independent-shadow',
      promotedToRuntime: false,
      evidence: {
        independentSourceSymbolRate: 1,
        independentPrimaryEventRate: 1,
      },
    })
  })

  it('owns a zero-symbol rejection independently while retaining the V2 observation', async () => {
    const page = rhythmicPianoPage({ measuresPerSystem: 2 })
    let rejection
    try {
      await runPdfOmrPipeline('synthetic', {
        numPages: 1,
        preprocessPages: false,
        renderPage: renderPagesFromArray([page]),
        title: 'v3-shadow-rejection',
        omrV3Shadow: true,
        analyzePage: (imageData, context) => ({
          pageEntry: { page: context.page, systems: [] },
          measureRhythms: [],
          measureGrid: [],
          nextMeasureNumber: context.measureNumberStart,
          stats: { systems: 0, measures: 0, notes: 0, uncertainMeasures: 0 },
          omrV3ShadowInput: {
            page: context.page,
            width: imageData.width,
            height: imageData.height,
            contentBounds: { x0: 0, x1: 1 },
            systems: [],
            systemMeasureBoxes: [],
            measureRhythms: [],
            measureGrid: [],
            rawDetectorSymbols: [],
          },
        }),
      })
    } catch (error) {
      rejection = error
    }

    expect(rejection).toBeInstanceOf(Error)
    expect(rejection.omrV3Shadow).toMatchObject({
      status: 'structure-ready',
      decision: { status: 'observe-production-rejection', ownedBy: 'v2-policy', independent: false },
    })
    expect(rejection.omrV3IndependentShadow).toMatchObject({
      status: 'structure-ready',
      engine: 'omr-v3-independent-shadow',
      decision: {
        status: 'reject',
        ownedBy: 'omr-v3',
        independent: true,
        failureReason: 'no-independent-symbols',
      },
    })
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
      rollout: { mode: 'rollback', rollback: true },
    })
  })
})
