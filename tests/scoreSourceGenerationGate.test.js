import { beforeEach, describe, expect, it } from 'vitest'
import {
  activatePdfScoreSource,
  assertScoreSourceMutationAllowed,
  getActiveScoreSourceGeneration,
  registerOmrRunStart,
  requestOmrCancellation,
  resetScoreSourceGenerationGateForTests,
} from '../src/features/library/scoreSourceGenerationGate.js'
import { shouldAcceptOmrGeneratedResult } from '../src/features/library/autoOmrOrchestration.js'

describe('scoreSourceGenerationGate', () => {
  beforeEach(() => {
    resetScoreSourceGenerationGateForTests()
  })

  it('allows mutation only when identity, epoch, and run id all match', () => {
    activatePdfScoreSource({ pdfIdentity: 'pdf-b', epoch: 2 })
    expect(registerOmrRunStart({ runId: 11, pdfIdentity: 'pdf-b', epoch: 2 }).ok).toBe(true)

    expect(
      assertScoreSourceMutationAllowed({
        callbackPdfIdentity: 'pdf-b',
        callbackEpoch: 2,
        callbackRunId: 11,
      }).ok,
    ).toBe(true)

    expect(
      assertScoreSourceMutationAllowed({
        callbackPdfIdentity: 'pdf-a',
        callbackEpoch: 2,
        callbackRunId: 11,
      }).reason,
    ).toBe('pdf-identity-mismatch')

    expect(
      assertScoreSourceMutationAllowed({
        callbackPdfIdentity: 'pdf-b',
        callbackEpoch: 1,
        callbackRunId: 11,
      }).reason,
    ).toBe('session-epoch-mismatch')

    expect(
      assertScoreSourceMutationAllowed({
        callbackPdfIdentity: 'pdf-b',
        callbackEpoch: 2,
        callbackRunId: 99,
      }).reason,
    ).toBe('omr-run-mismatch')
  })

  it('invalidates in-flight OMR when a new PDF is activated', () => {
    activatePdfScoreSource({ pdfIdentity: 'pdf-a', epoch: 1 })
    registerOmrRunStart({ runId: 3, pdfIdentity: 'pdf-a', epoch: 1 })
    requestOmrCancellation({ previousPdfIdentity: 'pdf-a', reason: 'pdf-replacement' })
    activatePdfScoreSource({
      pdfIdentity: 'pdf-b',
      epoch: 2,
      previousPdfIdentity: 'pdf-a',
    })

    const active = getActiveScoreSourceGeneration()
    expect(active).toEqual({
      activePdfIdentity: 'pdf-b',
      activeEpoch: 2,
      activeOmrRunId: null,
    })
    expect(
      assertScoreSourceMutationAllowed({
        callbackPdfIdentity: 'pdf-a',
        callbackEpoch: 1,
        callbackRunId: 3,
      }).ok,
    ).toBe(false)
  })

  it('rejects late OMR accept via shouldAccept when run id was invalidated', () => {
    activatePdfScoreSource({ pdfIdentity: 'pdf-b', epoch: 2 })
    // No register — Piece B has not started OMR yet.
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfIdentity: 'pdf-a',
      currentPdfIdentity: 'pdf-b',
      sourcePracticeSessionEpoch: 1,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 3,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.discarded).toBe(true)
    expect(['no-active-omr-run', 'pdf-identity-mismatch', 'session-epoch-mismatch']).toContain(
      rejected.reason,
    )
  })
})
