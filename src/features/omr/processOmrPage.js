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
import { normalizePageStaffLineGaps } from './normalizeStaffLineGaps.js'
import { normalizeLegacyMusicFontGlyphs } from './normalizeLegacyMusicFontGlyphs.js'
import {
  attachTabPositionsToEvents,
  buildTabMeasureEvents,
  classifySystemStaves,
  extractTabDigitNotes,
  groupTabNotesByMeasure,
  resolveGuitarSystemRoles,
  systemsContainTablature,
} from './detectTabNotation.js'

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
    pageText: rawPageText = [],
    stavesPerSystem = OMR_PIANO_STAVES_PER_SYSTEM,
    dense = false,
    keySignature: inheritedKeySignature = null,
    timeSignature: inheritedTimeSignature = null,
    documentStaffGapReference = null,
    /** Instrument definition (features/instruments). Null = legacy piano path. */
    instrument = null,
  } = options

  const tabCapable = Boolean(instrument?.omr?.supportsTablature && instrument?.strings)
  const tabStringCount = instrument?.strings?.count ?? 6
  const tabTuning = instrument?.strings?.tuning ?? null
  const tabFretCount = instrument?.strings?.fretCount ?? 24

  // Legacy music fonts (e.g. MScore in musescore.com/TCPDF exports) draw
  // noteheads/clefs at pre-SMuFL codepoints. Normalize them to SMuFL so such
  // pages take the vector path instead of the weak raster fallback. Identity
  // for pages that already contain SMuFL noteheads.
  const legacyFontNormalization = normalizeLegacyMusicFontGlyphs(rawPageText)
  const pageText = legacyFontNormalization.items

  omrDebugStep('processOmrPage:start', imageData, {
    page,
    legacyFontGlyphsApplied: legacyFontNormalization.applied || undefined,
  })
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

  // Fretted-instrument pages: classify bands up front so a notation-over-TAB
  // pair shares ONE set of measure numbers (the TAB band re-reads its
  // partner's measures instead of counting new ones). Null for piano.
  const systemRoles = tabCapable
    ? resolveGuitarSystemRoles(systems, { stringCount: tabStringCount })
    : null

  for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
    const system = systems[systemIndex]
    const role = systemRoles?.[systemIndex]
    if (role?.kind === 'tab' && role.pairedWithIndex != null) {
      // Paired TAB staff — engraves the same measures as the notation band
      // directly above; contributes positions, never new measures.
      systemMeasureBoxes.push([])
      measureGridDiagnostics.push({
        page,
        systemIndex,
        tabStaffPairedWith: role.pairedWithIndex,
      })
      continue
    }
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

  const staffGapNormalizationResult = normalizePageStaffLineGaps({
    systemMeasureBoxes,
    systems,
    page,
    documentGapReference: documentStaffGapReference,
  })
  for (const systemDiag of staffGapNormalizationResult.staffGapNormalization.systemsAffected) {
    const gridDiag = measureGridDiagnostics[systemDiag.systemIndex]
    if (gridDiag) {
      gridDiag.staffGapNormalization = systemDiag
    }
  }

  // TAB-only pages (no SMuFL noteheads, tablature staves present): assemble
  // note events from fret digits — the raster notehead detector would only
  // misread digit ink. Never reached for piano (tabCapable is false).
  if (
    tabCapable &&
    !hasVectorOmrNoteheads(pageText) &&
    systemsContainTablature(systems, { stringCount: tabStringCount })
  ) {
    const positionedGlyphs = textGlyphsToImage(pageText, imageData)
    const beats = inheritedTimeSignature?.beats ?? 4
    const tabDiagnostics = { tabStaves: 0, tabNotes: 0, tabPositionalMeasures: 0, attachedPositions: 0 }

    for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
      const role = systemRoles?.[systemIndex]
      const targetIndex =
        role?.tabStave && role.kind === 'tab' && role.pairedWithIndex != null
          ? role.pairedWithIndex
          : systemIndex
      const measureBoxes = systemMeasureBoxes[targetIndex] ?? []
      const systemMeasures = []

      if (role?.tabStave && measureBoxes.length > 0) {
        tabDiagnostics.tabStaves += 1
        const tabNotes = extractTabDigitNotes(
          positionedGlyphs,
          role.tabStave,
          measureBoxes,
          imageData,
          { tuning: tabTuning ?? undefined, fretCount: tabFretCount },
        )
        tabDiagnostics.tabNotes += tabNotes.length
        const byMeasure = groupTabNotesByMeasure(tabNotes)

        for (const measureBox of measureBoxes) {
          const measureNotes = byMeasure.get(measureBox.measureNumber)
          if (!measureNotes?.length) {
            continue
          }
          const { events } = buildTabMeasureEvents(measureNotes, { beats })
          const noteCount = events.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0)
          const measureRecord = {
            measureNumber: measureBox.measureNumber,
            page,
            systemIndex: targetIndex,
            events,
            // Positional rhythm is expected-approximate for tablature (the
            // page carries no duration info) — distinct from a failed rhythm
            // detection, so it does not count into `uncertainMeasures`.
            uncertain: false,
            rhythmApproximate: true,
            confidence: 0.6,
            vectorNoteCount: noteCount,
          }
          systemMeasures.push(measureRecord)
          measureRhythms.push(measureRecord)
          notes += noteCount
          tabDiagnostics.tabPositionalMeasures += 1
        }
      }

      pageEntry.systems.push({
        systemIndex,
        confidence: systemConfidenceFromMeasures(systemMeasures),
        measures: systemMeasures,
      })
      const pairedTabUsesPartnerBoxes =
        role?.tabStave && role.kind === 'tab' && role.pairedWithIndex != null
      const partnerHasPairedTab =
        !role?.tabStave &&
        systemRoles?.some(
          (candidate) => candidate.kind === 'tab' && candidate.pairedWithIndex === systemIndex,
        )
      if (role?.tabStave || !partnerHasPairedTab) {
        measureGrid.push(
          ...measureGridEntriesForSystem(
            measureBoxes,
            systemMeasures,
            'tab-vector',
            imageData.width,
          ),
        )
      }
      if (pairedTabUsesPartnerBoxes) {
        measureGridDiagnostics.push({
          page,
          systemIndex,
          tabStaffUsesMeasureBoxesFrom: targetIndex,
        })
      }
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
      keySignature: inheritedKeySignature ?? keySignature,
      timeSignature: inheritedTimeSignature ?? { beats: 4, beatType: 4, confidence: 0 },
      inkThreshold,
      dense: false,
      source: 'tab-vector',
      tabDiagnostics,
      staffGapNormalization: staffGapNormalizationResult.staffGapNormalization,
      legacyFontNormalization: legacyFontNormalization.applied
        ? legacyFontNormalization.diagnostics
        : null,
    }
    omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
      notes,
      systems: systems.length,
      source: 'tab-vector',
    })
    return result
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

    // Mixed notation+TAB (fretted instruments): pull string/fret positions
    // off the TAB staff and attach them to the notation-staff events by
    // x-proximity. Pitch and rhythm keep coming from the notation staff.
    let tabDiagnostics = null
    if (tabCapable && systemRoles) {
      tabDiagnostics = { tabStaves: 0, tabNotes: 0, tabPositionalMeasures: 0, attachedPositions: 0 }
      const positionedGlyphs = textGlyphsToImage(pageText, imageData)
      for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
        const role = systemRoles[systemIndex]
        if (!role?.tabStave) {
          continue
        }
        const targetIndex = role.kind === 'mixed' ? systemIndex : role.pairedWithIndex
        if (targetIndex == null) {
          continue
        }
        tabDiagnostics.tabStaves += 1
        const targetBoxes = systemMeasureBoxes[targetIndex] ?? []
        const tabNotes = extractTabDigitNotes(
          positionedGlyphs,
          role.tabStave,
          targetBoxes,
          imageData,
          { tuning: tabTuning ?? undefined, fretCount: tabFretCount },
        )
        tabDiagnostics.tabNotes += tabNotes.length
        const byMeasure = groupTabNotesByMeasure(tabNotes)
        for (const measureRecord of vector.measureRecordsBySystem[targetIndex] ?? []) {
          const measureNotes = byMeasure.get(measureRecord.measureNumber)
          if (!measureNotes?.length) {
            continue
          }
          const attached = attachTabPositionsToEvents(measureRecord.events, measureNotes)
          measureRecord.events = attached.events
          tabDiagnostics.attachedPositions += attached.attachedCount
        }
      }
    }

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
      tabDiagnostics,
      tieDiagnostics: vector.tieDiagnostics,
      restDiagnostics: vector.restDiagnostics,
      staccatoDiagnostics: vector.staccatoDiagnostics,
      accentDiagnostics: vector.accentDiagnostics,
      orphanDiagnostics: vector.orphanDiagnostics,
      staffGapNormalization: staffGapNormalizationResult.staffGapNormalization,
      legacyFontNormalization: legacyFontNormalization.applied
        ? legacyFontNormalization.diagnostics
        : null,
    }
    omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
      notes,
      systems: systems.length,
      source: vector.source,
      legacyFontGlyphsApplied: legacyFontNormalization.applied || undefined,
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
    staffGapNormalization: staffGapNormalizationResult.staffGapNormalization,
  }
  omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
    notes,
    systems: systems.length,
  })
  return result
}
