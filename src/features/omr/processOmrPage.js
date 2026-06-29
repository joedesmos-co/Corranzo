import { detectContentBounds } from '../score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../score-follow/detectStaffLines.js'
import { buildMeasureBoxesForSystemWithDiagnostics } from './buildOmrMeasureGrid.js'
import { detectNoteheadsInMeasure } from './detectOmrNoteheads.js'
import { assembleMeasureRhythm } from './assembleOmrMeasureRhythm.js'
import { refineMeasurePitches } from './detectOmrAccidentals.js'
import { detectKeySignature } from './detectOmrKeySignature.js'
import {
  detectRepeatBarline,
  detectVoltaEnding,
} from './detectOmrRepeatBarline.js'
import {
  detectDynamicNearMeasure,
  detectDynamicsFromTextItems,
  detectPedalFromText,
  detectStaccatoOnNote,
} from './detectOmrExpression.js'
import {
  measureConfidenceFromRhythm,
  systemConfidenceFromMeasures,
} from './buildOmrDiagnostics.js'
import { estimatePageScanQuality } from './preprocessOmrPageImage.js'
import { OMR_PIANO_STAVES_PER_SYSTEM } from './omrConstants.js'
import { assertPixelViewReadable } from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'
import {
  hasVectorOmrNoteheads,
  processVectorPageSystems,
  systemConfidenceFromMeasures as vectorSystemConfidenceFromMeasures,
  textGlyphsToImage,
} from './processVectorOmrPage.js'
import { detectStaffClefsFromGlyphs } from './pitchFromStaffPosition.js'
import { serializeOmrMeasureBox } from './omrMeasureGridMeta.js'
import { computeOmrMeasureVisualExtents } from './omrMeasureVisualExtents.js'

function measureGridEntriesForSystem(
  measureBoxes,
  measureRecords = [],
  source = 'omr',
  imageWidth = null,
) {
  const confidenceByMeasure = new Map(
    measureRecords.map((record) => [record.measureNumber, record.confidence]),
  )
  const eventsByMeasure = new Map(
    measureRecords.map((record) => [record.measureNumber, record.events ?? []]),
  )
  return measureBoxes
    .map((measureBox) => {
      const serialized = serializeOmrMeasureBox(measureBox, {
        confidence: confidenceByMeasure.get(measureBox.measureNumber),
        source,
      })
      if (!serialized) {
        return null
      }
      const visual = computeOmrMeasureVisualExtents({
        measureBox,
        events: eventsByMeasure.get(measureBox.measureNumber) ?? [],
        imageWidth,
      })
      return {
        ...serialized,
        ...visual,
        playableStartX: visual.visualMeasureStartX,
        playableEndX: visual.visualMeasureEndX,
      }
    })
    .filter(Boolean)
}

/**
 * Analyze one preprocessed page image (systems, measures, notes).
 */
export function processOmrPageAnalysis(imageData, options = {}) {
  const {
    page = 1,
    measureNumberStart = 1,
    pageText = [],
    stavesPerSystem = OMR_PIANO_STAVES_PER_SYSTEM,
    dense = false,
    keySignature: inheritedKeySignature = null,
    timeSignature: inheritedTimeSignature = null,
  } = options

  omrDebugStep('processOmrPage:start', imageData, { page })
  assertPixelViewReadable(imageData.data, `processOmrPage:page-${page}-input`)

  const scanQuality = estimatePageScanQuality(imageData)
  const contentBounds = detectContentBounds(imageData)
  const { systems, inkThreshold } = detectStaffLineSystems(imageData, contentBounds, {
    stavesPerSystem,
    countBarlines: true,
  })

  const pageEntry = {
    page,
    systems: [],
    scanQuality,
    systemCount: systems.length,
  }

  const measureRhythms = []
  let measureCounter = measureNumberStart
  let notes = 0
  let uncertainMeasures = 0
  let keySignature = { fifths: 0, mode: 'major', confidence: 0 }

  const systemTextDynamic = detectDynamicsFromTextItems(pageText)
  const noteheadOptions = { dense: dense || scanQuality.isLikelyScanned }
  const systemMeasureBoxes = []
  const measureGrid = []
  const measureGridDiagnostics = []

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const system = systems[systemIndex]
    const { measureBoxes, diagnostics: gridDiagnostics } = buildMeasureBoxesForSystemWithDiagnostics({
      page,
      systemIndex,
      system,
      contentBounds,
      imageData,
      measureNumberStart: measureCounter,
      darkThreshold: Math.min(inkThreshold, Math.max(145, inkThreshold - 22)),
    })

    measureCounter += measureBoxes.length
    systemMeasureBoxes.push(measureBoxes)
    measureGridDiagnostics.push(gridDiagnostics)
  }

  if (hasVectorOmrNoteheads(pageText)) {
    const vector = processVectorPageSystems({
      imageData,
      pageText,
      systems,
      systemMeasureBoxes,
      inheritedKeySignature,
      inheritedTimeSignature,
      inkThreshold,
    })
    for (let systemIndex = 0; systemIndex < systemMeasureBoxes.length; systemIndex += 1) {
      const systemMeasures = vector.measureRecordsBySystem[systemIndex] ?? []
      for (const measureRecord of systemMeasures) {
        measureRhythms.push(measureRecord)
        notes += measureRecord.vectorNoteCount ?? 0
        if (measureRecord.uncertain) {
          uncertainMeasures += 1
        }
      }
      pageEntry.systems.push({
        systemIndex,
        confidence: vectorSystemConfidenceFromMeasures(systemMeasures),
        measures: systemMeasures,
      })
      measureGrid.push(
        ...measureGridEntriesForSystem(
          systemMeasureBoxes[systemIndex] ?? [],
          systemMeasures,
          vector.source,
          imageData.width,
        ),
      )
    }

    const result = {
      pageEntry,
      measureRhythms,
      measureGrid,
      measureGridDiagnostics,
      nextMeasureNumber: measureCounter,
      stats: {
        systems: systems.length,
        measures: measureCounter - measureNumberStart,
        notes,
        uncertainMeasures,
      },
      keySignature: vector.keySignature,
      timeSignature: vector.timeSignature,
      inkThreshold,
      dense: false,
      source: vector.source,
      tieDiagnostics: vector.tieDiagnostics,
      restDiagnostics: vector.restDiagnostics,
      staccatoDiagnostics: vector.staccatoDiagnostics,
      accentDiagnostics: vector.accentDiagnostics,
    }
    omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
      notes,
      systems: systems.length,
      source: vector.source,
    })
    return result
  }

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const measureBoxes = systemMeasureBoxes[systemIndex] ?? []
    const staffClefs = detectStaffClefsFromGlyphs(
      textGlyphsToImage(pageText, imageData),
      imageData,
      measureBoxes[0]?.staffLines,
    )
    for (const measureBox of measureBoxes) {
      measureBox.staffClefs = staffClefs
    }

    const systemKey =
      measureBoxes.length > 0
        ? detectKeySignature(
            imageData,
            measureBoxes[0],
            measureBoxes[0].staffLines,
            inkThreshold,
          )
        : { fifths: 0, mode: 'major', confidence: 0 }
    if ((systemKey.confidence ?? 0) > (keySignature.confidence ?? 0)) {
      keySignature = systemKey
    }

    const systemMeasures = []

    for (let boxIndex = 0; boxIndex < measureBoxes.length; boxIndex += 1) {
      const measureBox = measureBoxes[boxIndex]
      let noteheads = detectNoteheadsInMeasure(imageData, measureBox, inkThreshold, noteheadOptions)
      if (!noteheads.length) {
        continue
      }

      noteheads = refineMeasurePitches(noteheads, {
        keySignature: systemKey,
        imageData,
        inkThreshold,
      })

      for (const notehead of noteheads) {
        const articulation = detectStaccatoOnNote(imageData, notehead, inkThreshold)
        if (articulation) {
          notehead.articulation = articulation
        }
      }

      const rhythm = assembleMeasureRhythm(imageData, measureBox, noteheads, inkThreshold)
      notes += noteheads.length
      if (rhythm.uncertain) {
        uncertainMeasures += 1
      }

      const repeatRight = detectRepeatBarline(imageData, measureBox, inkThreshold, 'right')
      const repeatLeft =
        boxIndex === 0
          ? detectRepeatBarline(imageData, measureBox, inkThreshold, 'left')
          : null
      const repeatMarking =
        repeatRight || repeatLeft
          ? {
              ...(repeatLeft ?? {}),
              ...(repeatRight ?? {}),
              confidence: Math.max(repeatLeft?.confidence ?? 0, repeatRight?.confidence ?? 0),
            }
          : null

      const endingMarking = detectVoltaEnding(imageData, measureBox, inkThreshold)
      const dynamic =
        systemTextDynamic ?? detectDynamicNearMeasure(imageData, measureBox, inkThreshold)
      const pedal = detectPedalFromText(pageText)

      const confidence = measureConfidenceFromRhythm(rhythm, noteheads)
      const measureRecord = {
        measureNumber: measureBox.measureNumber,
        page,
        systemIndex,
        events: rhythm.events,
        uncertain: rhythm.uncertain,
        confidence,
        repeatMarking,
        endingMarking,
        dynamic,
        pedal: boxIndex === 0 ? pedal : null,
      }
      systemMeasures.push(measureRecord)
      measureRhythms.push(measureRecord)
    }

    pageEntry.systems.push({
      systemIndex,
      confidence: systemConfidenceFromMeasures(systemMeasures),
        measures: systemMeasures,
      })
    measureGrid.push(
      ...measureGridEntriesForSystem(
        measureBoxes,
        systemMeasures,
        'raster',
        imageData.width,
      ),
    )
  }

  const result = {
    pageEntry,
    measureRhythms,
    measureGrid,
    measureGridDiagnostics,
    nextMeasureNumber: measureCounter,
    stats: {
      systems: systems.length,
      measures: measureCounter - measureNumberStart,
      notes,
      uncertainMeasures,
    },
    keySignature,
    inkThreshold,
    dense: noteheadOptions.dense,
  }
  omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
    notes,
    systems: systems.length,
  })
  return result
}
