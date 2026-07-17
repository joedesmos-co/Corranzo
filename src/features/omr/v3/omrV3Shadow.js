/** Adapter and orchestrator for running OMR V3 beside the legacy pipeline. */

import { createOmrDocumentIR, exportOmrV3DebugJson } from './omrV3Ir.js'
import {
  analyzeOmrV3PageStructure,
  recoverOmrV3DocumentStructure,
} from './omrV3Structure.js'
import { buildOmrV3DocumentMeasureColumns } from './omrV3Measures.js'
import { assignOmrV3DocumentSymbolOwnership } from './omrV3Ownership.js'
import { buildOmrV3PianoVoiceCandidates } from './omrV3Voices.js'
import { buildOmrV3GuitarFusion } from './omrV3Guitar.js'
import { serializeOmrV3MusicXml } from './omrV3MusicXml.js'
import { evaluateOmrV3Shadow } from './omrV3Evaluation.js'

const DEFAULT_MEASURE_DIVISIONS = 16

export const OMR_V3_SYMBOL_EVIDENCE_MODE = Object.freeze({
  LEGACY_RUNTIME_EVENTS: 'legacy-runtime-events',
  RAW_DETECTOR_SYMBOLS: 'raw-detector-symbols',
})

function uniqueNumbers(values) {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right)
}

function legacyStaves(system) {
  return system?.staves?.length ? system.staves : system ? [system] : []
}

function measuresForLegacySystem(pageInput, systemIndex) {
  const role = pageInput.systemRoles?.[systemIndex]
  const sourceIndex = role?.kind === 'tab' && role.pairedWithIndex != null
    ? role.pairedWithIndex
    : systemIndex
  return pageInput.systemMeasureBoxes?.[sourceIndex] ?? []
}

function runtimeRecordsForSystem(pageInput, systemIndex) {
  return (pageInput.measureRhythms ?? []).filter((measure) => measure.systemIndex === systemIndex)
}

function pairedNotationSystemIndex(pageInput, systemIndex) {
  const role = pageInput.systemRoles?.[systemIndex]
  if (role?.kind === 'tab' && Number.isInteger(role.pairedWithIndex)) {
    return role.pairedWithIndex
  }
  return (pageInput.systemRoles ?? []).some(
    (candidate) => candidate?.kind === 'tab' && candidate.pairedWithIndex === systemIndex,
  )
    ? systemIndex
    : null
}

function staffBandsFromPage(pageInput, instrumentId) {
  const bands = []
  for (let systemIndex = 0; systemIndex < (pageInput.systems ?? []).length; systemIndex += 1) {
    const system = pageInput.systems[systemIndex]
    const role = pageInput.systemRoles?.[systemIndex]
    const staves = legacyStaves(system)
    const boxes = measuresForLegacySystem(pageInput, systemIndex)
    const pairedNotationIndex = pairedNotationSystemIndex(pageInput, systemIndex)
    const sourceSystemId = `legacy-page-${pageInput.page}-system-${systemIndex}`
    const sourcePairId = Number.isInteger(pairedNotationIndex)
      ? `legacy-page-${pageInput.page}-notation-tab-pair-${pairedNotationIndex}`
      : null
    const boundaries = uniqueNumbers(boxes.flatMap((box) => [box.x0, box.x1]))
    const records = runtimeRecordsForSystem(
      pageInput,
      role?.kind === 'tab' && role.pairedWithIndex != null ? role.pairedWithIndex : systemIndex,
    )
    const noteCount = records.reduce(
      (sum, measure) =>
        sum +
        (measure.events ?? []).reduce(
          (eventSum, event) => eventSum + (event.notes?.length ?? (event.type === 'note' ? 1 : 0)),
          0,
        ),
      0,
    )
    staves.forEach((staff, staffIndex) => {
      // The legacy detector exposes both its canonical physical lines and the
      // raw raster rows that supported them. V3 classifies canonical lines,
      // while retaining the noisier rows as source geometry for provenance.
      const lineRows = staff.lineYs?.length ? staff.lineYs : staff.detectedLineYs ?? []
      const rawLineRows = staff.detectedLineYs?.length ? staff.detectedLineYs : lineRows
      const isTab =
        role?.kind === 'tab' ||
        (role?.kind === 'mixed' && Number(staff.lineCount ?? lineRows.length) === 6)
      const isNotation = !isTab
      let clefs = []
      if (isNotation) {
        if (instrumentId === 'guitar') clefs = ['treble-8vb']
        else if (staves.length > 1) clefs = [staffIndex === 0 ? 'treble' : 'bass']
        else clefs = ['treble', 'bass']
      }
      bands.push({
        sourceId: `legacy-page-${pageInput.page}-system-${systemIndex}-staff-${staffIndex}`,
        sourceSystemId,
        sourcePairId,
        sourceRole: isTab ? 'tab' : 'notation',
        space: 'normalized',
        lineRows,
        rawLineRows,
        xStart: boxes[0]?.x0 ?? pageInput.contentBounds?.x0 ?? 0,
        xEnd: boxes.at(-1)?.x1 ?? pageInput.contentBounds?.x1 ?? 1,
        clefs,
        noteheadCount: isNotation ? noteCount : 0,
        explicitNotation: isNotation,
        explicitTab: isTab,
        tabDigitCount: isTab ? Math.max(2, pageInput.tabDiagnostics?.tabNotes ?? 0) : 0,
        barlines: boundaries.map((x, index) => ({
          evidenceId: `legacy-boundary-${pageInput.page}-${systemIndex}-${index}`,
          x,
          kind: 'barline',
          confidence: system.barlineConfident ? 0.86 : 0.62,
          verticalSpanRatio: 1,
          source: 'legacy-system-measure-grid-shadow-adapter',
          completeGrid: true,
        })),
        confidence: 0.72,
      })
    })
  }
  return bands.filter((band) => band.lineRows.length > 0)
}

function normalizedCenter(value, scale, fallback) {
  if (!Number.isFinite(value)) return fallback
  return value > 1 ? value / scale : value
}

function staffCenter(system, clef) {
  const staves = legacyStaves(system)
  if (staves.length > 1) {
    const staff = clef === 'bass' ? staves[staves.length - 1] : staves[0]
    return staff.center ?? ((staff.y0 ?? 0) + (staff.y1 ?? 0)) / 2
  }
  const y0 = system?.y0 ?? 0.2
  const y1 = system?.y1 ?? y0 + 0.08
  return clef === 'bass' ? y0 + (y1 - y0) * 0.7 : y0 + (y1 - y0) * 0.3
}

function legacyStaffIndex(system, clef) {
  const staves = legacyStaves(system)
  if (staves.length <= 1) return 0
  return clef === 'bass' ? staves.length - 1 : 0
}

function legacyStaffSourceId(pageInput, systemIndex, staffIndex) {
  return `legacy-page-${pageInput.page}-system-${systemIndex}-staff-${staffIndex}`
}

function tabStaffSourceId(pageInput, notationSystemIndex) {
  const pairedIndex = (pageInput.systemRoles ?? []).findIndex(
    (role) => role?.kind === 'tab' && role.pairedWithIndex === notationSystemIndex,
  )
  const systemIndex = pairedIndex >= 0 ? pairedIndex : notationSystemIndex
  const staves = legacyStaves(pageInput.systems?.[systemIndex])
  const detectedIndex = staves.findIndex(
    (staff) => Number(staff.lineCount ?? staff.lineYs?.length) === 6,
  )
  return legacyStaffSourceId(
    pageInput,
    systemIndex,
    detectedIndex >= 0 ? detectedIndex : Math.max(0, staves.length - 1),
  )
}

function tabSystemForNotation(pageInput, systemIndex) {
  const pairedIndex = (pageInput.systemRoles ?? []).findIndex(
    (role) => role?.kind === 'tab' && role.pairedWithIndex === systemIndex,
  )
  return pairedIndex >= 0 ? pageInput.systems[pairedIndex] : pageInput.systems[systemIndex]
}

function tabY(pageInput, systemIndex, stringNumber = 3) {
  const system = tabSystemForNotation(pageInput, systemIndex)
  const staves = legacyStaves(system)
  const tab = staves.find((staff) => (staff.lineCount ?? staff.lineYs?.length) === 6) ?? staves.at(-1)
  const lines = tab?.lineYs ?? tab?.detectedLineYs ?? []
  if (lines.length >= stringNumber) return lines[stringNumber - 1]
  return tab?.center ?? system?.center ?? 0.5
}

function measureGridByNumber(pageInput) {
  return new Map((pageInput.measureGrid ?? []).map((entry) => [entry.measureNumber, entry]))
}

function eventX(event, grid, totalDivisions) {
  const start = Number.isFinite(event.startDivision) ? event.startDivision : 0
  const relative = Math.min(1, Math.max(0, start / Math.max(1, totalDivisions)))
  return (grid?.xStart ?? 0.1) + relative * ((grid?.xEnd ?? 0.9) - (grid?.xStart ?? 0.1))
}

function sourceSymbolsFromPage(pageInput, instrumentId, totalDivisions) {
  const symbols = []
  const gridByNumber = measureGridByNumber(pageInput)
  const tabOnly = Boolean(pageInput.tabDiagnostics?.tabOnly)
  for (const measure of pageInput.measureRhythms ?? []) {
    const grid = gridByNumber.get(measure.measureNumber)
    const system = pageInput.systems?.[measure.systemIndex]
    for (let eventIndex = 0; eventIndex < (measure.events ?? []).length; eventIndex += 1) {
      const event = measure.events[eventIndex]
      const x = eventX(event, grid, totalDivisions)
      const durationDivisions = event.durationDivisions
      const sourceEventGroupId = `legacy-event-${pageInput.page}-${measure.measureNumber}-${eventIndex}`
      const notationStaffSourceId = legacyStaffSourceId(
        pageInput,
        measure.systemIndex,
        legacyStaffIndex(system, event.clef),
      )
      if (event.type === 'rest') {
        symbols.push({
          id: `legacy-rest-${pageInput.page}-${measure.measureNumber}-${eventIndex}`,
          sourceEventGroupId,
          sourceStaffId: notationStaffSourceId,
          preferSourceStaffOwnership: instrumentId === 'guitar',
          kind: 'rest',
          geometry: {
            x,
            y: staffCenter(system, event.clef),
            width: 0.006,
            height: 0.008,
            space: 'normalized',
          },
          onsetDivisions: event.startDivision,
          duration: {
            divisions: durationDivisions,
            type: event.durationType ?? null,
            dots: event.dotted ? 1 : 0,
            exact: !measure.rhythmApproximate,
          },
          voiceHint: event.clef === 'bass' ? 1 : event.voice ?? 1,
          confidence: measure.confidence ?? 0.65,
        })
        continue
      }
      for (let noteIndex = 0; noteIndex < (event.notes ?? []).length; noteIndex += 1) {
        const note = event.notes[noteIndex]
        const sourceId = `legacy-note-${pageInput.page}-${measure.measureNumber}-${eventIndex}-${noteIndex}`
        const noteY = normalizedCenter(note.cy, pageInput.height, staffCenter(system, note.clef))
        const serializedMidi = Number.isFinite(note.midi)
          ? note.midi + (instrumentId === 'guitar' && !note.soundingPitch ? -12 : 0)
          : null
        const common = {
          id: sourceId,
          sourceEventGroupId,
          sourceStaffId: legacyStaffSourceId(
            pageInput,
            measure.systemIndex,
            legacyStaffIndex(system, note.clef),
          ),
          preferSourceStaffOwnership: instrumentId === 'guitar',
          geometry: { x, y: noteY, width: 0.006, height: 0.006, space: 'normalized' },
          onsetDivisions: event.startDivision,
          duration: {
            divisions: durationDivisions,
            type: event.durationType ?? null,
            dots: event.dotted ? 1 : 0,
            exact: !measure.rhythmApproximate,
          },
          midi: serializedMidi,
          pitch: Number.isFinite(serializedMidi)
            ? {
                midi: serializedMidi,
                writtenMidi: serializedMidi,
                soundingMidi: serializedMidi,
                transpositionSemitones: 0,
                source: note.soundingPitch
                  ? 'legacy-sounding-pitch'
                  : 'legacy-written-octave-output',
              }
            : null,
          string: note.string,
          fret: note.fret,
          voiceHint: note.voice ?? event.voice ?? 1,
          stemDirection: note.stemDirection ?? note.beamOwnership?.stemDirection ?? null,
          stemGroupId: note.attachedStemId ?? note.beamOwnership?.attachedStemId ?? null,
          beamGroupId: note.beamGroupId ?? note.beamOwnership?.beamGroupId ?? null,
          tieStart: Boolean(event.tieStart),
          tieStop: Boolean(event.tieStop),
          technical: {
            ...(note.technical ?? {}),
            articulation: note.articulation ?? null,
            adapterSource: 'legacy-runtime-event',
          },
          confidence: measure.confidence ?? 0.7,
        }
        if (tabOnly) {
          symbols.push({
            ...common,
            kind: 'tab-digit',
            text: String(note.fret ?? ''),
            geometry: {
              ...common.geometry,
              y: tabY(pageInput, measure.systemIndex, note.string),
            },
          })
          continue
        }
        symbols.push({ ...common, kind: 'notehead' })
        if (instrumentId === 'guitar' && Number.isInteger(note.string) && Number.isInteger(note.fret)) {
          symbols.push({
            id: `${sourceId}-tab-position`,
            kind: 'tab-digit',
            text: String(note.fret),
            string: note.string,
            fret: note.fret,
            sourceEventGroupId: common.sourceEventGroupId,
            sourceStaffId: tabStaffSourceId(pageInput, measure.systemIndex),
            preferSourceStaffOwnership: true,
            midi: common.midi,
            pitch: common.pitch,
            onsetDivisions: common.onsetDivisions,
            duration: common.duration,
            voiceHint: common.voiceHint,
            geometry: {
              x,
              y: tabY(pageInput, measure.systemIndex, note.string),
              width: 0.006,
              height: 0.008,
              space: 'normalized',
            },
            confidence: Math.min(0.82, measure.confidence ?? 0.7),
            technical: { adapterSource: 'legacy-attached-tab-position' },
          })
        }
      }
    }
  }
  return symbols
}

function rawDetectorSymbolsFromPage(pageInput, instrumentId) {
  return (pageInput.rawDetectorSymbols ?? []).map((source, index) => {
    const systemIndex = Number.isInteger(source.systemIndex) ? source.systemIndex : 0
    const system = pageInput.systems?.[systemIndex]
    const isTab = source.kind === 'tab-digit'
    const sourceStaffId = isTab
      ? tabStaffSourceId(pageInput, systemIndex)
      : legacyStaffSourceId(
          pageInput,
          systemIndex,
          legacyStaffIndex(system, source.clef),
        )
    const sourceMidi = Number.isFinite(source.midi) ? source.midi : null
    const serializedMidi = Number.isFinite(sourceMidi)
      ? sourceMidi +
        (instrumentId === 'guitar' && !source.soundingPitch && !isTab ? -12 : 0)
      : null
    const geometry = source.geometry ?? {
      x: Number(source.cx ?? source.x) - 3,
      y: Number(source.cy ?? source.y) - 3,
      width: 6,
      height: 6,
      space: 'pixels',
    }
    const tabGeometry = isTab
      ? {
          x: Number.isFinite(source.xNorm)
            ? source.xNorm - 0.003
            : Number(source.x ?? 0) / Math.max(1, pageInput.width) - 0.003,
          y: tabY(pageInput, systemIndex, source.string) - 0.004,
          width: Math.max(0.006, Number(source.width ?? 0) / Math.max(1, pageInput.width)),
          height: 0.008,
          space: 'normalized',
        }
      : geometry
    return {
      id: source.id ?? `detector-${pageInput.page}-${systemIndex}-${index}`,
      kind: source.kind,
      text: source.text,
      sourceStaffId,
      preferSourceStaffOwnership: instrumentId === 'guitar',
      geometry: tabGeometry,
      // Notation detector positions use the playable (post-clef) span. TAB
      // positions use raw barline spans, so averaging both coordinate systems
      // would shift paired onsets. TAB-only timing can safely use geometry.
      measureRelativePositionHint: isTab ? null : source.measureRelativePosition,
      duration:
        Number.isFinite(source.durationDivisions) && source.durationDivisions > 0
          ? {
              divisions: source.durationDivisions,
              type: source.durationType ?? null,
              dots: source.dotted ? 1 : 0,
              exact: false,
            }
          : null,
      midi: serializedMidi,
      pitch: Number.isFinite(serializedMidi)
        ? {
            midi: serializedMidi,
            writtenMidi: serializedMidi,
            soundingMidi: serializedMidi,
            transpositionSemitones: 0,
            source: source.soundingPitch
              ? 'detector-sounding-pitch'
              : 'detector-staff-pitch',
          }
        : null,
      string: source.string,
      fret: source.fret,
      stemDirection: source.stemDirection ?? null,
      stemGroupId: source.stemGroupId ?? null,
      beamGroupId: source.beamGroupId ?? null,
      tieStart: Boolean(source.tieStart),
      confidence: source.confidence ?? 0.6,
      technical: {
        ...(source.technical ?? {}),
        articulation: source.articulation ?? null,
        adapterSource: source.evidenceSource ?? 'detector-observation',
      },
    }
  })
}

function isIndependentDetectorSource(source) {
  return String(source?.technical?.adapterSource ?? '').startsWith('detector-')
}

function primaryEvents(document) {
  return (document.pages ?? [])
    .flatMap((page) => page.systems ?? [])
    .flatMap((system) => system.measureColumns ?? [])
    .flatMap((measure) => measure.voices ?? [])
    .filter((voice) => voice.candidateRank === 0)
    .flatMap((voice) => voice.events ?? [])
}

function shadowEngine(symbolEvidenceMode) {
  return symbolEvidenceMode === OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS
    ? 'omr-v3-independent-shadow'
    : 'omr-v3-shadow'
}

/** Build the existing V3 IR stages once for confidence reasoning or shadow serialization. */
export function buildOmrV3AnalysisDocument({
  documentId,
  title,
  instrumentId = 'piano',
  pageInputs = [],
  musical = {},
  measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS,
  symbolEvidenceMode = OMR_V3_SYMBOL_EVIDENCE_MODE.LEGACY_RUNTIME_EVENTS,
  captureEvidence = true,
} = {}) {
  const independentSymbols =
    symbolEvidenceMode === OMR_V3_SYMBOL_EVIDENCE_MODE.RAW_DETECTOR_SYMBOLS
  const structurePages = pageInputs.map((pageInput) =>
    analyzeOmrV3PageStructure({
      documentId,
      pageIndex: Math.max(0, Number(pageInput.page ?? 1) - 1),
      pageWidth: pageInput.width,
      pageHeight: pageInput.height,
      contentBounds: {
        x: pageInput.contentBounds?.x0 ?? 0,
        y: 0,
        width: (pageInput.contentBounds?.x1 ?? 1) - (pageInput.contentBounds?.x0 ?? 0),
        height: 1,
        space: 'normalized',
      },
      staffBands: staffBandsFromPage(pageInput, instrumentId),
      instrumentId,
    }),
  )
  let document = createOmrDocumentIR({
    documentId,
    metadata: {
      title,
      instrumentId,
      musical,
      engine: independentSymbols ? 'omr-v3-independent-shadow' : 'omr-v3-shadow',
      symbolEvidenceMode,
      promotedToRuntime: false,
    },
    pages: structurePages.map((result) => result.page),
  })
  const structuralRecovery = recoverOmrV3DocumentStructure(document)
  document = structuralRecovery.document
  const measured = buildOmrV3DocumentMeasureColumns(document)
  document = measured.document
  const symbolsByPage = new Map(
    pageInputs.map((pageInput) => [
      Math.max(0, Number(pageInput.page ?? 1) - 1),
      independentSymbols
        ? rawDetectorSymbolsFromPage(pageInput, instrumentId)
        : sourceSymbolsFromPage(pageInput, instrumentId, measureDurationDivisions),
    ]),
  )
  const sourceSymbols = captureEvidence ? [...symbolsByPage.values()].flat() : []
  const owned = assignOmrV3DocumentSymbolOwnership(document, { symbolsByPage })
  document = owned.document
  const musicalResult =
    instrumentId === 'guitar'
      ? buildOmrV3GuitarFusion(document, { measureDurationDivisions })
      : buildOmrV3PianoVoiceCandidates(document, { measureDurationDivisions })
  document = musicalResult.document
  const events = captureEvidence ? primaryEvents(document) : []
  const independentPrimaryEventCount = events.filter((event) =>
    isIndependentDetectorSource(event),
  ).length
  const independentSourceSymbolCount = sourceSymbols.filter((symbol) =>
    isIndependentDetectorSource(symbol),
  ).length
  const evidence = captureEvidence
    ? {
        mode: symbolEvidenceMode,
        sourceSymbolCount: sourceSymbols.length,
        independentSourceSymbolCount,
        independentSourceSymbolRate: sourceSymbols.length
          ? independentSourceSymbolCount / sourceSymbols.length
          : 0,
        primaryEventCount: events.length,
        independentPrimaryEventCount,
        independentPrimaryEventRate: events.length
          ? independentPrimaryEventCount / events.length
          : 0,
      }
    : null
  return {
    document,
    evidence,
    stages: {
      pages: structurePages.map((result) => ({
        pageIndex: result.page.pageIndex,
        systemCount: result.page.systems.length,
        rejectedPairingCount: result.rejectedPairings.length,
      })),
      structuralRecovery: {
        recoveredPairingCount: structuralRecovery.recoveredPairings.length,
        recoveredPairings: structuralRecovery.recoveredPairings,
      },
      measures: measured.systems,
      ownership: owned.totals,
      musical: musicalResult.totals,
      ...(evidence ? { evidence } : {}),
    },
  }
}

/**
 * Preserve V3 structural/evidence diagnostics when production safely rejects
 * an import. This observes the V2-owned decision; it deliberately does not
 * claim that V3 independently owns or agrees with the rejection.
 */
export function observeOmrV3RejectedImport({
  documentId,
  title,
  instrumentId = 'piano',
  pageInputs = [],
  musical = {},
  measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS,
  rollout = null,
  analysis = null,
  symbolEvidenceMode = OMR_V3_SYMBOL_EVIDENCE_MODE.LEGACY_RUNTIME_EVENTS,
  failureReason = null,
  productionConfidence = null,
} = {}) {
  const prepared =
    analysis ??
    buildOmrV3AnalysisDocument({
      documentId,
      title,
      instrumentId,
      pageInputs,
      musical,
      measureDurationDivisions,
      symbolEvidenceMode,
    })
  return {
    status: 'structure-ready',
    engine: shadowEngine(symbolEvidenceMode),
    promotedToRuntime: false,
    rollout,
    document: prepared.document,
    debugJson: exportOmrV3DebugJson(prepared.document),
    stages: prepared.stages,
    evidence: prepared.evidence,
    decision: {
      status: 'observe-production-rejection',
      ownedBy: 'v2-policy',
      independent: false,
      failureReason,
      productionConfidence,
    },
  }
}

/** Run every implemented V3 stage without changing the production result. */
export function runOmrV3Shadow({
  documentId,
  title,
  instrumentId = 'piano',
  pageInputs = [],
  musical = {},
  runtimeMusicXml = null,
  measureDurationDivisions = DEFAULT_MEASURE_DIVISIONS,
  rollout = null,
  analysis = null,
  symbolEvidenceMode = OMR_V3_SYMBOL_EVIDENCE_MODE.LEGACY_RUNTIME_EVENTS,
} = {}) {
  const prepared =
    analysis ??
    buildOmrV3AnalysisDocument({
      documentId,
      title,
      instrumentId,
      pageInputs,
      musical,
      measureDurationDivisions,
      symbolEvidenceMode,
    })
  const document = prepared.document
  const serializer = serializeOmrV3MusicXml(document, { title, measureDurationDivisions })
  const expectedStructure = {
    systemCount: pageInputs.reduce((sum, page) => sum + (page.systems?.length ?? 0), 0),
    measureCount: pageInputs.reduce(
      (sum, page) => sum + (page.measureRhythms?.length ?? 0),
      0,
    ),
  }
  const evaluation = evaluateOmrV3Shadow({
    document,
    runtimeMusicXml,
    expectedStructure,
    serializerResult: serializer,
  })
  return {
    status: 'ready',
    engine: shadowEngine(symbolEvidenceMode),
    promotedToRuntime: false,
    rollout,
    document,
    debugJson: exportOmrV3DebugJson(document),
    musicXml: serializer.musicXml,
    serializer: serializer.summary,
    evaluation: { ...evaluation, musicXml: undefined },
    stages: prepared.stages,
    evidence: prepared.evidence,
  }
}
