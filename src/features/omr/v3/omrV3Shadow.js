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

function staffBandsFromPage(pageInput, instrumentId) {
  const bands = []
  for (let systemIndex = 0; systemIndex < (pageInput.systems ?? []).length; systemIndex += 1) {
    const system = pageInput.systems[systemIndex]
    const role = pageInput.systemRoles?.[systemIndex]
    const staves = legacyStaves(system)
    const boxes = measuresForLegacySystem(pageInput, systemIndex)
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
        space: 'normalized',
        lineRows,
        rawLineRows,
        xStart: boxes[0]?.x0 ?? pageInput.contentBounds?.x0 ?? 0,
        xEnd: boxes.at(-1)?.x1 ?? pageInput.contentBounds?.x1 ?? 1,
        clefs,
        noteheadCount: isNotation ? noteCount : 0,
        explicitTab: isTab,
        tabDigitCount: isTab ? Math.max(2, pageInput.tabDiagnostics?.tabNotes ?? 0) : 0,
        barlines: boundaries.map((x, index) => ({
          evidenceId: `legacy-boundary-${pageInput.page}-${systemIndex}-${index}`,
          x,
          kind: 'barline',
          confidence: system.barlineConfident ? 0.86 : 0.62,
          verticalSpanRatio: 1,
          source: 'legacy-system-measure-grid-shadow-adapter',
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
      if (event.type === 'rest') {
        symbols.push({
          id: `legacy-rest-${pageInput.page}-${measure.measureNumber}-${eventIndex}`,
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
        const common = {
          id: sourceId,
          geometry: { x, y: noteY, width: 0.006, height: 0.006, space: 'normalized' },
          onsetDivisions: event.startDivision,
          duration: {
            divisions: durationDivisions,
            type: event.durationType ?? null,
            dots: event.dotted ? 1 : 0,
            exact: !measure.rhythmApproximate,
          },
          midi: note.midi,
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
} = {}) {
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
      engine: 'omr-v3-shadow',
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
      sourceSymbolsFromPage(pageInput, instrumentId, measureDurationDivisions),
    ]),
  )
  const owned = assignOmrV3DocumentSymbolOwnership(document, { symbolsByPage })
  document = owned.document
  const musicalResult =
    instrumentId === 'guitar'
      ? buildOmrV3GuitarFusion(document, { measureDurationDivisions })
      : buildOmrV3PianoVoiceCandidates(document, { measureDurationDivisions })
  document = musicalResult.document
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
    engine: 'omr-v3-shadow',
    promotedToRuntime: false,
    rollout,
    document,
    debugJson: exportOmrV3DebugJson(document),
    musicXml: serializer.musicXml,
    serializer: serializer.summary,
    evaluation: { ...evaluation, musicXml: undefined },
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
    },
  }
}
