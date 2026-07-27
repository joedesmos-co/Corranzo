import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildPdfSourceIdentity,
  clearLiveBundleCompanions,
  companionBelongsToPdf,
  describeScoreSourceIdentities,
  hadCompanionScoreSources,
  invalidatePreviousScoreSideEffects,
  reconcileCompanionsToPdfIdentity,
  withOwnerPdfIdentity,
} from '../src/features/library/scoreSourceReplacement.js'
import { shouldAcceptOmrGeneratedResult } from '../src/features/library/autoOmrOrchestration.js'
import {
  activatePdfScoreSource,
  registerOmrRunStart,
  resetScoreSourceGenerationGateForTests,
} from '../src/features/library/scoreSourceGenerationGate.js'
import { buildPdfFingerprint } from '../src/features/score-follow/scoreFollowStorage.js'
import { buildAutoSetupKey } from '../src/features/score-follow/scoreFollowAutoSetupStorage.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (...parts) => readFileSync(join(root, 'src', ...parts), 'utf8')

function installMemoryStorage() {
  const store = new Map()
  const api = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(String(key), String(value))
    },
    removeItem: (key) => {
      store.delete(String(key))
    },
    clear: () => store.clear(),
  }
  vi.stubGlobal('localStorage', api)
  const sessionStore = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => {
      sessionStore.set(String(key), String(value))
    },
    removeItem: (key) => {
      sessionStore.delete(String(key))
    },
    clear: () => sessionStore.clear(),
  })
  return api
}

const pieceA = { fileName: 'piece-a.pdf', size: 100, lastModified: 1 }
const pieceB = { fileName: 'piece-b.pdf', size: 200, lastModified: 2 }
const idA = buildPdfSourceIdentity(pieceA)
const idB = buildPdfSourceIdentity(pieceB)

describe('score source replacement helpers', () => {
  beforeEach(() => {
    installMemoryStorage()
    resetScoreSourceGenerationGateForTests()
  })

  it('detects prior MusicXML or MIDI companions', () => {
    expect(hadCompanionScoreSources({})).toBe(false)
    expect(
      hadCompanionScoreSources({
        musicXmlSource: { data: new ArrayBuffer(2), fileName: 'a.mxl', source: 'upload' },
      }),
    ).toBe(true)
    expect(
      hadCompanionScoreSources({
        midiSource: { data: new ArrayBuffer(2), fileName: 'a.mid' },
      }),
    ).toBe(true)
  })

  it('builds stable PDF identities from fingerprint, not filename alone', () => {
    expect(idA).toBe(buildPdfFingerprint(pieceA))
    expect(idA).not.toBe(idB)
    expect(idA).toContain('piece-a.pdf')
    expect(idA).toContain('100')
  })

  it('clears previous score-follow anchors and auto-setup flags for the old PDF', () => {
    const fingerprint = buildPdfFingerprint(pieceA)
    const anchorKey = `scoreflow-score-follow-v1-${fingerprint}`
    const setupKey = buildAutoSetupKey(fingerprint, 'piece-a.musicxml')
    localStorage.setItem(anchorKey, JSON.stringify({ anchors: [{ id: 'a' }] }))
    sessionStorage.setItem(setupKey, 'attempted')

    invalidatePreviousScoreSideEffects({
      previousPdfMeta: pieceA,
      previousFileName: 'piece-a.pdf',
      previousMusicXmlSource: {
        fileName: 'piece-a.musicxml',
        data: new ArrayBuffer(4),
        source: 'upload',
      },
    })

    expect(localStorage.getItem(anchorKey)).toBeNull()
    expect(sessionStorage.getItem(setupKey)).toBeNull()
  })

  it('wipes live bundle companions synchronously', () => {
    const live = {
      midiSource: { data: new ArrayBuffer(2), fileName: 'a.mid', ownerPdfIdentity: idA },
      musicXmlSource: {
        data: new ArrayBuffer(4),
        fileName: 'a.mxl',
        source: 'upload',
        ownerPdfIdentity: idA,
      },
      demoPieceActive: true,
      pdfMeta: pieceA,
    }
    clearLiveBundleCompanions(live)
    expect(live.midiSource).toBeNull()
    expect(live.musicXmlSource).toBeNull()
    expect(live.demoPieceActive).toBe(false)
    expect(live.pdfMeta).toEqual(pieceA)
  })

  it('rejects companions that do not belong to the active PDF identity', () => {
    const musicXmlA = withOwnerPdfIdentity(
      { data: new ArrayBuffer(4), fileName: 'a.mxl', source: 'upload' },
      idA,
    )
    const midiA = withOwnerPdfIdentity({ data: new ArrayBuffer(2), fileName: 'a.mid' }, idA)

    expect(companionBelongsToPdf(musicXmlA, idA)).toBe(true)
    expect(companionBelongsToPdf(musicXmlA, idB)).toBe(false)

    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity: idB,
      musicXmlSource: musicXmlA,
      midiSource: midiA,
    })
    expect(reconciled.musicXmlRejected).toBe(true)
    expect(reconciled.midiRejected).toBe(true)
    expect(reconciled.musicXmlSource).toBeNull()
    expect(reconciled.midiSource).toBeNull()
  })

  it('rejects legacy unowned companions instead of attaching them to a new PDF', () => {
    const legacy = { data: new ArrayBuffer(4), fileName: 'a.mxl', source: 'upload' }
    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity: idB,
      musicXmlSource: legacy,
      midiSource: null,
    })
    expect(reconciled.musicXmlRejected).toBe(true)
    expect(reconciled.musicXmlSource).toBeNull()
  })

  it('describes identities for diagnostics across replacement phases', () => {
    const snapshot = describeScoreSourceIdentities({
      pdfMeta: pieceB,
      musicXmlSource: null,
      midiSource: null,
      practiceSessionEpoch: 3,
      bundle: { pdfMeta: pieceB, musicXmlSource: null, midiSource: null },
    })
    expect(snapshot.pdfIdentity).toBe(idB)
    expect(snapshot.musicXmlIdentity).toBeNull()
    expect(snapshot.practiceSessionEpoch).toBe(3)
  })
})

describe('Piece A → Piece B ownership regression matrix', () => {
  it('A(PDF+MXL) → B(PDF only): Piece A MusicXML is rejected against Piece B identity', () => {
    const musicXmlA = withOwnerPdfIdentity(
      { data: new ArrayBuffer(8), fileName: 'a.mxl', source: 'upload' },
      idA,
    )
    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity: idB,
      musicXmlSource: musicXmlA,
      midiSource: null,
    })
    expect(reconciled.musicXmlSource).toBeNull()
    expect(shouldQueueNeedsClear(reconciled)).toBe(true)
  })

  it('A(PDF+MXL+MIDI) → B(PDF only): both companions clear', () => {
    const reconciled = reconcileCompanionsToPdfIdentity({
      pdfIdentity: idB,
      musicXmlSource: withOwnerPdfIdentity(
        { data: new ArrayBuffer(4), fileName: 'a.mxl', source: 'upload' },
        idA,
      ),
      midiSource: withOwnerPdfIdentity({ data: new ArrayBuffer(2), fileName: 'a.mid' }, idA),
    })
    expect(reconciled.musicXmlSource).toBeNull()
    expect(reconciled.midiSource).toBeNull()
  })

  it('A OMR completion after B active is rejected by pdf identity + session epoch', () => {
    activatePdfScoreSource({ pdfIdentity: idB, epoch: 2 })
    registerOmrRunStart({ runId: 8, pdfIdentity: idB, epoch: 2 })
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfFileName: pieceA.fileName,
      currentPdfFileName: pieceB.fileName,
      sourcePdfIdentity: idA,
      currentPdfIdentity: idB,
      sourcePracticeSessionEpoch: 1,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 8,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.discarded).toBe(true)
    expect(['session-epoch-mismatch', 'pdf-identity-mismatch']).toContain(rejected.reason)
  })

  it('rejects OMR that omits source identity once Piece B already has an identity', () => {
    activatePdfScoreSource({ pdfIdentity: idB, epoch: 2 })
    registerOmrRunStart({ runId: 8, pdfIdentity: idB, epoch: 2 })
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfIdentity: null,
      currentPdfIdentity: idB,
      sourcePracticeSessionEpoch: null,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 8,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('missing-source-pdf-identity')
  })

  it('A completion with matching epoch but wrong PDF identity is still rejected', () => {
    activatePdfScoreSource({ pdfIdentity: idB, epoch: 2 })
    registerOmrRunStart({ runId: 8, pdfIdentity: idB, epoch: 2 })
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfIdentity: idA,
      currentPdfIdentity: idB,
      sourcePracticeSessionEpoch: 2,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 8,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('pdf-identity-mismatch')
  })

  it('OMR owned by Piece A cannot remain when Piece B is active', () => {
    activatePdfScoreSource({ pdfIdentity: idB, epoch: 2 })
    registerOmrRunStart({ runId: 8, pdfIdentity: idB, epoch: 2 })
    const omrA = withOwnerPdfIdentity(
      {
        data: new ArrayBuffer(4),
        fileName: 'a.omr.musicxml',
        source: 'omr',
      },
      idA,
    )
    const rejected = shouldAcceptOmrGeneratedResult({
      musicXmlSource: omrA,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfIdentity: idB,
      currentPdfIdentity: idB,
      sourcePracticeSessionEpoch: 2,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 8,
    })
    expect(rejected.ok).toBe(false)
    expect(rejected.reason).toBe('companion-owner-mismatch')
  })

  it('B OMR is accepted when epoch and PDF identity match and companions are clear', () => {
    activatePdfScoreSource({ pdfIdentity: idB, epoch: 2 })
    registerOmrRunStart({ runId: 8, pdfIdentity: idB, epoch: 2 })
    const accepted = shouldAcceptOmrGeneratedResult({
      musicXmlSource: null,
      sourceInstrumentId: 'piano',
      currentInstrumentId: 'piano',
      sourcePdfIdentity: idB,
      currentPdfIdentity: idB,
      sourcePracticeSessionEpoch: 2,
      currentPracticeSessionEpoch: 2,
      sourceOmrRunId: 8,
      sourcePdfFileName: pieceB.fileName,
      currentPdfFileName: pieceB.fileName,
    })
    expect(accepted).toEqual({ ok: true })
  })
})

function shouldQueueNeedsClear(reconciled) {
  return reconciled.musicXmlRejected || reconciled.midiRejected
}

describe('PDF replacement wiring', () => {
  const app = readSrc('App.jsx')
  const omrPanel = readSrc('components', 'library', 'PdfOmrPlaybackPanel.jsx')
  const persistence = readSrc('hooks', 'useSessionPersistence.js')

  it('runs a full source replacement before a different PDF becomes active', () => {
    expect(app).toContain('beginPdfScoreSourceReplacement')
    expect(app).toContain('invalidatePreviousScoreSideEffects')
    expect(app).toContain('clearLiveBundleCompanions')
    expect(app).toContain('clearSessionCompanionFiles')
    expect(app).toMatch(
      /beginPdfScoreSourceReplacement[\s\S]*setMusicXmlSource\(null\)[\s\S]*setMidiSource\(null\)/,
    )
    expect(app).toMatch(
      /handleFileSelect[\s\S]*beginPdfScoreSourceReplacement\(\{[\s\S]*previousMusicXml: musicXmlSource/,
    )
    expect(app).toMatch(
      /classified\.pdf\[0\][\s\S]*beginPdfScoreSourceReplacement\(\{[\s\S]*previousMidi: loadedMidi/,
    )
  })

  it('bumps practiceSessionEpochRef synchronously before OMR can accept stale results', () => {
    expect(app).toContain('practiceSessionEpochRef')
    expect(app).toContain('sessionSaveGenerationRef')
    expect(app).toMatch(
      /practiceSessionEpochRef\.current = nextEpoch[\s\S]*setPracticeSessionEpoch\(nextEpoch\)/,
    )
    expect(app).toContain('currentPracticeSessionEpoch: practiceSessionEpochRef.current')
  })

  it('never lets stale OMR callbacks revive Piece A MusicXML/MIDI via nullish coalescing', () => {
    expect(app).toContain('const liveMusicXmlSource = reconciled.musicXmlSource')
    expect(app).toContain('const liveMidiSource = reconciled.midiSource')
    expect(app).toContain('musicXmlSource: liveMusicXmlSource')
    expect(app).toContain('setMidiSource(ownedMidi)')
    expect(app).not.toContain('currentBundle.musicXmlSource ?? musicXmlSource')
  })

  it('captures PDF identity, session epoch, and OMR run id at generate start', () => {
    expect(omrPanel).toContain('sourcePdfIdentity: runPdfIdentity')
    expect(omrPanel).toContain('sourcePracticeSessionEpoch: runPracticeSessionEpoch')
    expect(omrPanel).toContain('sourceOmrRunId: runId')
    expect(omrPanel).toContain('registerOmrRunStart')
    expect(app).toContain('sourcePdfIdentity = null')
    expect(app).toContain('sourcePracticeSessionEpoch = null')
    expect(app).toContain('sourceOmrRunId = null')
    expect(app).toContain('assertScoreSourceMutationAllowed')
    expect(app).toContain('activatePdfScoreSource')
  })

  it('calls the latest onGenerated through a ref so PDF replacement cannot keep Piece A closures', () => {
    expect(omrPanel).toContain('onGeneratedRef')
    expect(omrPanel).toContain('await onGeneratedRef.current?.(')
  })

  it('aborts stale session persistence with a shared save-generation ref', () => {
    expect(app).toContain('sessionSaveGenerationRef')
    expect(persistence).toContain('sessionSaveGenerationRef')
    expect(persistence).toContain('readSaveGeneration')
    expect(persistence).toContain('clearSessionCompanionFiles')
    expect(persistence).toContain('persistence-save')
  })

  it('logs replacement diagnostics at the required phases', () => {
    expect(app).toContain("'before-pdf-replacement'")
    expect(app).toContain("'after-companions-cleared'")
    expect(app).toContain("'before-omr-queue'")
    expect(app).toContain("'omr-complete'")
    expect(app).toContain("'persistence-after-omr'")
  })

  it('documents the Piece A → Piece B replacement matrix in orchestration comments', () => {
    const replacement = readSrc('features', 'library', 'scoreSourceReplacement.js')
    expect(replacement).toContain('A new PDF must not keep the previous piece')
    expect(replacement).toContain('MusicXML/MXL, MIDI, OMR output')
  })
})
