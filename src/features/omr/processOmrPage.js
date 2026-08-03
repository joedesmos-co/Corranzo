import { detectContentBounds } from '../score-follow/detectStaffSystems.js'
import { detectStaffLineSystems } from '../score-follow/detectStaffLines.js'
import {
  buildMeasureBoxesForSystemWithDiagnostics,
  shouldUseVectorNoteColumnHints,
} from './buildOmrMeasureGrid.js'
import { detectNoteheadsInMeasure } from './detectOmrNoteheads.js'
import { assembleMeasureRhythm } from './assembleOmrMeasureRhythm.js'
import { finalizeRasterPageTies } from './finalizeRasterPageTies.js'
import { refineMeasurePitches } from './detectOmrAccidentals.js'
import { detectKeySignature } from './detectOmrKeySignature.js'
import {
  detectMeasureStructureMarkings,
  finalizeEndingStops,
} from './detectOmrRepeatBarline.js'
import {
  detectPedalFromText,
  detectStaccatoOnNote,
} from './detectOmrExpression.js'
import { attachDynamicsToMeasureRecords } from './detectOmrDynamics.js'
import { attachTemposToMeasureRecords } from './parseOmrTempoMarking.js'
import {
  measureConfidenceBreakdown,
  measureConfidenceFromRhythm,
  systemConfidenceFromMeasures,
} from './buildOmrDiagnostics.js'
import { estimatePageScanQuality } from './preprocessOmrPageImage.js'
import { OMR_PIANO_STAVES_PER_SYSTEM } from './omrConstants.js'
import {
  OMR_DIVISIONS_PER_QUARTER,
  OMR_DURATION_DIVISIONS,
} from './omrRhythmConstants.js'
import { assertPixelViewReadable } from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'
import {
  hasVectorOmrNoteheads,
  processVectorPageSystems,
  systemConfidenceFromMeasures as vectorSystemConfidenceFromMeasures,
  textGlyphsToImage,
} from './processVectorOmrPage.js'
import {
  buildBeamStemGraph,
  summarizeBeamStemGraph,
} from './beamStemReconstructionDiagnostics.js'
import { detectStaffClefsFromGlyphs } from './pitchFromStaffPosition.js'
import { serializeOmrMeasureBox } from './omrMeasureGridMeta.js'
import { computeOmrMeasureVisualExtents } from './omrMeasureVisualExtents.js'
import { normalizePageStaffLineGaps } from './normalizeStaffLineGaps.js'
import { normalizeLegacyMusicFontGlyphs } from './normalizeLegacyMusicFontGlyphs.js'
import { normalizeNoncanonicalArticulationGlyphs } from './normalizeNoncanonicalArticulationGlyphs.js'
import {
  attachTabPositionsToEvents,
  buildTabMeasureEvents,
  detectTabTextAnnotations,
  extractTabDigitNotes,
  groupTabNotesByMeasure,
  NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE,
  resolveGuitarSystemRoles,
  hasTabClefNearStaff,
  TAB_APPROXIMATE_RHYTHM_WARNING,
  TAB_COMPRESSED_TIMING_WARNING,
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

function tabMeasureBoxesForOutput(measureBoxes, byMeasure) {
  if (!measureBoxes?.length) {
    return []
  }
  let lastNotedIndex = -1
  measureBoxes.forEach((box, index) => {
    if (byMeasure.get(box.measureNumber)?.length) {
      lastNotedIndex = index
    }
  })
  if (lastNotedIndex < 0) {
    return []
  }
  // Interior no-fret bars are real rests and must preserve numbering. Trailing
  // no-fret spans are ambiguous in TAB-only PDFs because the right content edge
  // is often used as a synthetic boundary; emitting them invents silent bars.
  return measureBoxes.slice(0, lastNotedIndex + 1)
}

function detectorSymbolsFromObservations(
  observations,
  { page, systemIndex, source, beamStemGraph = null },
) {
  const graphNoteheads = beamStemGraph?.noteheads ?? []
  const noteheads = (observations?.noteheads ?? []).map((note, index) => {
    const rawOwnership = graphNoteheads[index]?.beamOwnership ?? null
    // Split stem vs beam gates. Stem continuity may be owned without accepting
    // weak beam duration handoff (ungated raster beam ownership regressed scan
    // duration while still missing the acceptance floor).
    const stemConfidence = Number(rawOwnership?.stemConfidence ?? rawOwnership?.confidence ?? 0)
    const beamConfidence = Number(rawOwnership?.beamConfidence ?? 0)
    const stemOwned =
      Boolean(rawOwnership?.attachedStemId) && stemConfidence >= 0.7 ? rawOwnership : null
    const beamOwned =
      stemOwned &&
      Number(rawOwnership?.beamCandidateCount ?? 0) > 0 &&
      beamConfidence >= 0.7
        ? rawOwnership
        : null
    return {
      id: `detector-${source}-note-${page}-${systemIndex}-${note.measureNumber ?? 'x'}-${index}`,
      kind: 'notehead',
      systemIndex,
      measureNumber: note.measureNumber ?? null,
      measureRelativePosition: note.positionInMeasure,
      geometry: {
        x: note.cx - 3,
        y: note.cy - 3,
        width: 6,
        height: 6,
        space: 'pixels',
      },
      midi: note.midi,
      clef: note.clef,
      durationType: note.durationType,
      durationDivisions: note.durationDivisions,
      dotted: Boolean(note.dotted),
      onsetDivisions: Number.isFinite(note.onsetDivisions) ? note.onsetDivisions : null,
      rhythmPacking: note.rhythmPacking ?? null,
      stemDirection:
        stemOwned?.stemDirection ?? note.stem?.direction ?? note.stemDirection ?? null,
      stemGroupId: stemOwned?.attachedStemId ?? null,
      beamGroupId: beamOwned?.beamGroupId ?? null,
      beamExpectedDivisions: beamOwned?.expectedDivisions ?? null,
      beamOwnershipConfidence: beamOwned?.confidence ?? stemOwned?.stemConfidence ?? rawOwnership?.confidence ?? null,
      tieStart: Boolean(note.tieStart),
      confidence: note.confidence ?? note.pitchConfidence ?? 0.6,
      articulation: note.articulation ?? null,
      evidenceSource: `detector-${source}-notehead`,
    }
  })
  const rests = (observations?.rests ?? []).map((rest, index) => ({
    id: `detector-${source}-rest-${page}-${systemIndex}-${rest.measureNumber ?? 'x'}-${index}`,
    kind: 'rest',
    systemIndex,
    measureNumber: rest.measureNumber ?? null,
    measureRelativePosition: rest.positionInMeasure,
    geometry: {
      x: rest.cx - 3,
      y: rest.cy - 4,
      width: 6,
      height: 8,
      space: 'pixels',
    },
    clef: rest.clef,
    durationType: rest.durationType ?? 'quarter',
    durationDivisions:
      rest.durationDivisions ?? OMR_DURATION_DIVISIONS[rest.durationType] ?? OMR_DIVISIONS_PER_QUARTER,
    confidence: rest.confidence ?? 0.6,
    evidenceSource: `detector-${source}-rest`,
  }))
  return [...noteheads, ...rests]
}

function detectorSymbolsFromTabNotes(tabNotes, { page, systemIndex }) {
  return (tabNotes ?? []).map((note, index) => ({
    id: `detector-tab-digit-${page}-${systemIndex}-${note.measureNumber ?? 'x'}-${index}`,
    kind: 'tab-digit',
    text: String(note.fret),
    systemIndex,
    measureNumber: note.measureNumber ?? null,
    measureRelativePosition: note.positionInMeasure,
    x: note.x,
    xNorm: note.xNorm,
    string: note.string,
    fret: note.fret,
    midi: note.midi,
    soundingPitch: true,
    confidence: 0.82,
    evidenceSource: 'detector-tab-digit',
  }))
}

/**
 * Analyze one preprocessed page image (systems, measures, notes).
 */
export function processOmrPageAnalysis(imageData, options = {}) {
  const {
    page = 1,
    measureNumberStart = 1,
    pageText: rawPageText = [],
    vectorCurves = [],
    vectorAccidentalPaths = [],
    vectorAugmentationDotPaths = [],
    stavesPerSystem = OMR_PIANO_STAVES_PER_SYSTEM,
    dense = false,
    keySignature: inheritedKeySignature = null,
    timeSignature: inheritedTimeSignature = null,
    documentStaffGapReference = null,
    /** Instrument definition (features/instruments). Null = legacy piano path. */
    instrument = null,
    /** Developer/benchmark-only capture for the disabled-by-default V3 shadow. */
    captureOmrV3Shadow = false,
    /** Capture detector observations for an independent V3 qualification shadow. */
    captureOmrV3RawSymbols = false,
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
  const articulationGlyphNormalization =
    normalizeNoncanonicalArticulationGlyphs(legacyFontNormalization.items)
  const pageText = articulationGlyphNormalization.items

  omrDebugStep('processOmrPage:start', imageData, {
    page,
    legacyFontGlyphsApplied: legacyFontNormalization.applied || undefined,
    articulationGlyphsNormalized:
      articulationGlyphNormalization.applied || undefined,
  })
  assertPixelViewReadable(imageData.data, `processOmrPage:page-${page}-input`)

  const scanQuality = estimatePageScanQuality(imageData)
  const contentBounds = detectContentBounds(imageData)
  // Resolve glyphs before staff grouping so Guitar + glyph-less piano scans can
  // use grand-staff-capable pairing instead of guitar's single-staff default.
  const positionedGlyphs = tabCapable ? textGlyphsToImage(pageText, imageData) : null
  const vectorGlyphs = hasVectorOmrNoteheads(pageText)
    ? positionedGlyphs ?? textGlyphsToImage(pageText, imageData)
    : []
  const effectiveStavesPerSystem =
    tabCapable && Array.isArray(positionedGlyphs) && positionedGlyphs.length === 0
      ? Math.max(Number(stavesPerSystem) || 1, OMR_PIANO_STAVES_PER_SYSTEM)
      : stavesPerSystem
  const detectedSystems = detectStaffLineSystems(imageData, contentBounds, {
    stavesPerSystem: effectiveStavesPerSystem,
    countBarlines: true,
  })
  const inkThreshold = detectedSystems.inkThreshold
  const systems = detectedSystems.systems

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

  const noteheadOptions = { dense: dense || scanQuality.isLikelyScanned }
  const systemMeasureBoxes = []
  const measureGrid = []
  const measureGridDiagnostics = []
  const rawDetectorSymbols = []

  const buildOmrV3ShadowInput = ({ resultMeasureRhythms, resultMeasureGrid, tabDiagnostics }) =>
    captureOmrV3Shadow
      ? {
          page,
          width: imageData.width,
          height: imageData.height,
          contentBounds,
          detectedStaves: detectedSystems.staves,
          systems,
          systemRoles,
          systemMeasureBoxes,
          measureRhythms: resultMeasureRhythms,
          measureGrid: resultMeasureGrid,
          ...(captureOmrV3RawSymbols ? { rawDetectorSymbols } : {}),
          tabDiagnostics: tabDiagnostics ?? null,
          source: hasVectorOmrNoteheads(pageText) ? 'vector' : 'raster',
        }
      : null

  // Fretted-instrument pages: classify bands up front so a notation-over-TAB
  // pair shares ONE set of measure numbers (the TAB band re-reads its
  // partner's measures instead of counting new ones). Null for piano.
  const systemRoles = tabCapable
    ? resolveGuitarSystemRoles(systems, {
        stringCount: tabStringCount,
        glyphs: positionedGlyphs,
        imageData,
      })
    : null
  // Guitar analysis flags (no hairpins, ASCII dynamics reject, skip vector
  // notehead x-hints) only when a TAB staff is actually confirmed. Otherwise a
  // Guitar-selected piano PDF must follow the notation path.
  const tabAnalysisActive = Boolean(systemRoles?.some((role) => role?.tabStave))

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
    const systemVectorNoteheads = vectorGlyphs
      .filter((glyph) => {
        const yNorm = glyph.y / imageData.height
        return (
          /^[\uE0A2-\uE0A4]$/.test(glyph.text ?? '') &&
          yNorm >= system.y0 - 0.035 &&
          yNorm <= system.y1 + 0.035
        )
      })
      .map((glyph) => ({
        x: glyph.x / imageData.width,
        width: glyph.width / imageData.width,
      }))
    const useVectorNoteColumnHints =
      !tabAnalysisActive || shouldUseVectorNoteColumnHints(systemVectorNoteheads)
    const { measureBoxes, diagnostics: gridDiagnostics } = buildMeasureBoxesForSystemWithDiagnostics({
      page,
      systemIndex,
      system,
      contentBounds,
      imageData,
      measureNumberStart: measureCounter,
      darkThreshold: Math.min(inkThreshold, Math.max(145, inkThreshold - 22)),
      vectorNoteheadXNorms: useVectorNoteColumnHints ? systemVectorNoteheads : [],
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

  // TAB-only pages (no SMuFL noteheads, confirmed tablature staves): assemble
  // note events from fret digits — the raster notehead detector would only
  // misread digit ink. Never reached for piano (tabCapable is false).
  // Require affirmative TAB signal (digits, TAB clef, or TAB markers like capo).
  // Geometry-only 6-line bands — even with stray title/lyric glyphs — must fall
  // through to notation/raster so Guitar + piano scans are not hard-failed.
  const tabOnlyCandidateRoles = Boolean(systemRoles?.some((role) => role?.tabStave))
  let commitTabOnly = false
  if (tabCapable && !hasVectorOmrNoteheads(pageText) && tabOnlyCandidateRoles) {
    const tabAnnotations = detectTabTextAnnotations(pageText)
    let tabDigitCount = 0
    let hasTabClef = false
    for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
      const role = systemRoles[systemIndex]
      if (!role?.tabStave) continue
      if (
        role.source === 'tab-clef-text' ||
        hasTabClefNearStaff(positionedGlyphs, role.tabStave, imageData)
      ) {
        hasTabClef = true
      }
      const targetIndex =
        role.kind === 'tab' && role.pairedWithIndex != null
          ? role.pairedWithIndex
          : systemIndex
      const measureBoxes = systemMeasureBoxes[targetIndex] ?? []
      tabDigitCount += extractTabDigitNotes(
        positionedGlyphs,
        role.tabStave,
        measureBoxes,
        imageData,
        { tuning: tabTuning ?? undefined, fretCount: tabFretCount },
      ).length
    }
    commitTabOnly =
      tabDigitCount > 0 ||
      hasTabClef ||
      Boolean(tabAnnotations.capoText) ||
      (tabAnnotations.unsupportedMarkers?.length ?? 0) > 0
  }

  if (commitTabOnly) {
    const beats = inheritedTimeSignature?.beats ?? 4
    const tabAnnotations = detectTabTextAnnotations(pageText)
    const tabDiagnostics = {
      tabStaves: 0,
      tabNotes: 0,
      tabPositionalMeasures: 0,
      tabApproximateRhythmMeasures: 0,
      tabCompressedTimingMeasures: 0,
      tabEmptyMeasures: 0,
      attachedPositions: 0,
      tabOnly: true,
      rhythmApproximate: true,
      unsupportedMarkers: tabAnnotations.unsupportedMarkers,
      capoText: tabAnnotations.capoText,
      warnings: [TAB_APPROXIMATE_RHYTHM_WARNING, ...tabAnnotations.warnings],
    }
    let tabMeasureCounter = measureNumberStart

    for (let systemIndex = 0; systemIndex < systems.length; systemIndex += 1) {
      const role = systemRoles?.[systemIndex]
      const targetIndex =
        role?.tabStave && role.kind === 'tab' && role.pairedWithIndex != null
          ? role.pairedWithIndex
          : systemIndex
      const measureBoxes = systemMeasureBoxes[targetIndex] ?? []
      const emittedMeasureBoxes = []
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
        if (captureOmrV3RawSymbols) {
          rawDetectorSymbols.push(
            ...detectorSymbolsFromTabNotes(tabNotes, { page, systemIndex: targetIndex }),
          )
        }
        tabDiagnostics.tabNotes += tabNotes.length
        const byMeasure = groupTabNotesByMeasure(tabNotes)
        const outputMeasureBoxes = tabMeasureBoxesForOutput(measureBoxes, byMeasure)

        if (!outputMeasureBoxes.length) {
          continue
        }

        // TAB-only output follows the detected measure boxes in written order.
        // Empty bars are meaningful in TAB books, including tail bars before a
        // system break, so they are emitted as full-measure rests instead of
        // being compressed away.
        for (const measureBox of outputMeasureBoxes) {
          const measureNotes = byMeasure.get(measureBox.measureNumber)
          const outputMeasureNumber = tabMeasureCounter
          tabMeasureCounter += 1
          const emittedMeasureBox = {
            ...measureBox,
            measureNumber: outputMeasureNumber,
          }
          const tabTiming = measureNotes?.length
            ? buildTabMeasureEvents(measureNotes, { beats })
            : {
                events: [
                  {
                    // A printed TAB bar with no fret digits is a silent bar.
                    type: 'rest',
                    startDivision: 0,
                    durationDivisions: beats * OMR_DIVISIONS_PER_QUARTER,
                    durationType: beats === 3 ? 'half' : 'whole',
                    dotted: beats === 3,
                    rhythmApproximate: true,
                  },
                ],
                rhythmApproximate: true,
                timingModel: {
                  kind: 'tab-approximate-even',
                  approximate: true,
                  groupCount: 0,
                  eventCount: 0,
                  maxOnsets: 0,
                  coalesced: false,
                  compressed: false,
                },
                confidence: 0.52,
              }
          const { events } = tabTiming
          const noteCount = events.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0)
          const measureRecord = {
            measureNumber: outputMeasureNumber,
            page,
            systemIndex: targetIndex,
            events,
            // Positional rhythm is expected-approximate for tablature (the
            // page carries no duration info) — distinct from a failed rhythm
            // detection, so it does not count into `uncertainMeasures`.
            uncertain: false,
            rhythmApproximate: true,
            timingModel: tabTiming.timingModel,
            confidence: tabTiming.confidence ?? 0.5,
            pitchConfidence: noteCount > 0 ? 0.65 : 0.5,
            rhythmConfidence: tabTiming.confidence ?? 0.5,
            vectorNoteCount: noteCount,
          }
          emittedMeasureBoxes.push(emittedMeasureBox)
          systemMeasures.push(measureRecord)
          measureRhythms.push(measureRecord)
          notes += noteCount
          tabDiagnostics.tabPositionalMeasures += 1
          tabDiagnostics.tabApproximateRhythmMeasures += 1
          if (tabTiming.timingModel?.compressed) {
            tabDiagnostics.tabCompressedTimingMeasures += 1
            if (!tabDiagnostics.warnings.includes(TAB_COMPRESSED_TIMING_WARNING)) {
              tabDiagnostics.warnings.push(TAB_COMPRESSED_TIMING_WARNING)
            }
          }
          if (!noteCount) {
            tabDiagnostics.tabEmptyMeasures += 1
          }
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
      if ((role?.tabStave || !partnerHasPairedTab) && emittedMeasureBoxes.length > 0) {
        measureGrid.push(
          ...measureGridEntriesForSystem(
            emittedMeasureBoxes,
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
      nextMeasureNumber: tabMeasureCounter,
      stats: {
        systems: systems.length,
        measures: tabMeasureCounter - measureNumberStart,
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
      articulationGlyphNormalization: articulationGlyphNormalization.applied
        ? articulationGlyphNormalization.diagnostics
        : null,
    }
    if (captureOmrV3Shadow) {
      result.omrV3ShadowInput = buildOmrV3ShadowInput({
        resultMeasureRhythms: measureRhythms,
        resultMeasureGrid: measureGrid,
        tabDiagnostics,
      })
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
      vectorCurves,
      vectorAccidentalPaths,
      vectorAugmentationDotPaths,
      systems,
      systemMeasureBoxes,
      inheritedKeySignature,
      inheritedTimeSignature,
      inkThreshold,
      captureDetectorObservations: captureOmrV3RawSymbols,
    })

    // Mixed notation+TAB (fretted instruments): pull string/fret positions
    // off the TAB staff and attach them to the notation-staff events by
    // x-proximity. Pitch and rhythm keep coming from the notation staff.
    let tabDiagnostics = null
    if (tabCapable && systemRoles) {
      tabDiagnostics = {
        tabStaves: 0,
        tabNotes: 0,
        tabPositionalMeasures: 0,
        attachedPositions: 0,
        pairedNotes: 0,
        unpairedNotationNotes: 0,
        unusedTabDigits: 0,
        lowConfidenceMeasures: 0,
        pairingConfidence: 1,
        warnings: [],
      }
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
        if (captureOmrV3RawSymbols) {
          rawDetectorSymbols.push(
            ...detectorSymbolsFromTabNotes(tabNotes, { page, systemIndex: targetIndex }),
          )
        }
        tabDiagnostics.tabNotes += tabNotes.length
        const byMeasure = groupTabNotesByMeasure(tabNotes)
        for (const measureRecord of vector.measureRecordsBySystem[targetIndex] ?? []) {
          const measureNotes = byMeasure.get(measureRecord.measureNumber)
          if (!measureNotes?.length) {
            continue
          }
          const attached = attachTabPositionsToEvents(measureRecord.events, measureNotes, {
            beats: inheritedTimeSignature?.beats ?? 4,
            beatType: inheritedTimeSignature?.beatType ?? 4,
            writtenOctaveOffset: instrument?.notation?.writtenOctaveOffset ?? -1,
          })
          measureRecord.events = attached.events
          tabDiagnostics.attachedPositions += attached.attachedCount
          tabDiagnostics.pairedNotes += attached.pairingDiagnostics?.pairedNotes ?? attached.attachedCount
          tabDiagnostics.unpairedNotationNotes +=
            attached.pairingDiagnostics?.unpairedNotationNotes ?? 0
          tabDiagnostics.unusedTabDigits += attached.pairingDiagnostics?.unusedTabDigits ?? 0
          if (attached.lowConfidence) {
            tabDiagnostics.lowConfidenceMeasures += 1
          }
          tabDiagnostics.pairingConfidence = Math.min(
            tabDiagnostics.pairingConfidence,
            attached.pairingDiagnostics?.measureConfidence ?? 1,
          )
        }
      }
      if (tabDiagnostics.lowConfidenceMeasures > 0) {
        tabDiagnostics.warnings.push(NOTATION_TAB_PAIRING_LOW_CONFIDENCE_MESSAGE)
      }
    }

    for (let systemIndex = 0; systemIndex < systemMeasureBoxes.length; systemIndex += 1) {
      const boxes = systemMeasureBoxes[systemIndex] ?? []
      const systemMeasures = vector.measureRecordsBySystem[systemIndex] ?? []
      for (let boxIndex = 0; boxIndex < systemMeasures.length; boxIndex += 1) {
        const measureRecord = systemMeasures[boxIndex]
        const measureBox =
          boxes.find((box) => box.measureNumber === measureRecord.measureNumber) ??
          boxes[boxIndex]
        if (measureBox) {
          const structure = detectMeasureStructureMarkings(
            imageData,
            measureBox,
            inkThreshold,
            {
              isFirstInSystem: boxIndex === 0,
              pageText,
            },
          )
          measureRecord.repeatMarking = structure.repeatMarking
          measureRecord.endingMarking = structure.endingMarking
        }
        if (captureOmrV3RawSymbols) {
          rawDetectorSymbols.push(
            ...detectorSymbolsFromObservations(measureRecord.detectorObservations, {
              page,
              systemIndex,
              source: 'vector',
              beamStemGraph: measureRecord.beamStemGraph,
            }),
          )
          // Detector observations have been copied into the page-level V3
          // input; do not retain a second heavy copy in runtime diagnostics.
          delete measureRecord.detectorObservations
        }
        measureRhythms.push(measureRecord)
        notes += measureRecord.vectorNoteCount ?? 0
        if (measureRecord.uncertain) {
          uncertainMeasures += 1
        }
      }
      finalizeEndingStops(systemMeasures)
      pageEntry.systems.push({
        systemIndex,
        confidence: vectorSystemConfidenceFromMeasures(systemMeasures),
        measures: systemMeasures,
      })
      measureGrid.push(
        ...measureGridEntriesForSystem(
          boxes,
          systemMeasures,
          vector.source,
          imageData.width,
        ),
      )
    }

    attachDynamicsToMeasureRecords({
      measureRecords: measureRhythms,
      systemMeasureBoxes,
      pageText,
      imageData,
      inkThreshold,
      // Ink hairpins FP on guitar TAB beams/slurs; keep geometry for notation pages.
      detectHairpins: !tabAnalysisActive,
      rejectAsciiLetterDynamics: tabAnalysisActive,
    })
    attachTemposToMeasureRecords({
      measureRecords: measureRhythms,
      systemMeasureBoxes,
      pageText,
      pageNumber: page,
    })

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
      notationArticulationDiagnostics:
        vector.notationArticulationDiagnostics,
      noteheadFallbackCalibrationDiagnostics:
        vector.noteheadFallbackCalibrationDiagnostics,
      orphanDiagnostics: vector.orphanDiagnostics,
      staffGapNormalization: staffGapNormalizationResult.staffGapNormalization,
      legacyFontNormalization: legacyFontNormalization.applied
        ? legacyFontNormalization.diagnostics
        : null,
      articulationGlyphNormalization: articulationGlyphNormalization.applied
        ? articulationGlyphNormalization.diagnostics
        : null,
    }
    if (captureOmrV3Shadow) {
      result.omrV3ShadowInput = buildOmrV3ShadowInput({
        resultMeasureRhythms: measureRhythms,
        resultMeasureGrid: measureGrid,
        tabDiagnostics,
      })
    }
    omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
      notes,
      systems: systems.length,
      source: vector.source,
      legacyFontGlyphsApplied: legacyFontNormalization.applied || undefined,
      articulationGlyphsNormalized:
        articulationGlyphNormalization.applied || undefined,
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

      const rhythm = assembleMeasureRhythm(imageData, measureBox, noteheads, inkThreshold, {
        // Always capture enriched heads so the raster beam/stem graph can use the
        // same notehead→stem interface as the vector path. Raw V3 symbols still
        // only emit when captureOmrV3RawSymbols is enabled.
        captureDetectorObservations: true,
      })
      const beamStemGraph = buildBeamStemGraph({
        notes: rhythm.detectorObservations?.noteheads ?? noteheads,
        events: rhythm.events,
        measureBox,
        imageData,
        inkThreshold,
      })
      const beamStemDiagnostics = summarizeBeamStemGraph(beamStemGraph)
      if (captureOmrV3RawSymbols) {
        // Pass the raster beam/stem graph with split stem/beam gates in
        // detectorSymbolsFromObservations. Stem-only ownership may reshape lanes;
        // beam duration handoff still requires attached beams at confidence >= 0.7.
        rawDetectorSymbols.push(
          ...detectorSymbolsFromObservations(rhythm.detectorObservations, {
            page,
            systemIndex,
            source: 'raster',
            beamStemGraph,
          }),
        )
      }
      notes += noteheads.length
      if (rhythm.uncertain) {
        uncertainMeasures += 1
      }

      const { repeatMarking, endingMarking } = detectMeasureStructureMarkings(
        imageData,
        measureBox,
        inkThreshold,
        {
          isFirstInSystem: boxIndex === 0,
          pageText,
        },
      )
      const dynamic = null
      const pedal = detectPedalFromText(pageText)

      const confidenceBreakdown = measureConfidenceBreakdown(rhythm, noteheads)
      const confidence = measureConfidenceFromRhythm(rhythm, noteheads)
      const measureRecord = {
        measureNumber: measureBox.measureNumber,
        page,
        systemIndex,
        events: rhythm.events,
        uncertain: rhythm.uncertain,
        confidence,
        pitchConfidence: confidenceBreakdown.pitchConfidence,
        rhythmConfidence: confidenceBreakdown.rhythmConfidence,
        repeatMarking,
        endingMarking,
        dynamic,
        pedal: boxIndex === 0 ? pedal : null,
        beamStemGraph,
        beamStemDiagnostics,
      }
      systemMeasures.push(measureRecord)
      measureRhythms.push(measureRecord)
    }

    finalizeEndingStops(systemMeasures)

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

  attachDynamicsToMeasureRecords({
    measureRecords: measureRhythms,
    systemMeasureBoxes,
    pageText,
    imageData,
    inkThreshold,
    detectHairpins: !tabAnalysisActive,
    rejectAsciiLetterDynamics: tabAnalysisActive,
  })
  attachTemposToMeasureRecords({
    measureRecords: measureRhythms,
    systemMeasureBoxes,
    pageText,
    pageNumber: page,
  })

  const rasterTieResult = finalizeRasterPageTies(measureRhythms)

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
    rasterTieDiagnostics: rasterTieResult.diagnostics,
  }
  if (captureOmrV3Shadow) {
    result.omrV3ShadowInput = buildOmrV3ShadowInput({
      resultMeasureRhythms: measureRhythms,
      resultMeasureGrid: measureGrid,
      tabDiagnostics: null,
    })
  }
  omrDebugStep(`processOmrPage:done:page-${page}`, imageData, {
    notes,
    systems: systems.length,
  })
  return result
}
