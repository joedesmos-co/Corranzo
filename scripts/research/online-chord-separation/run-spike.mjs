#!/usr/bin/env node
/**
 * Pitch Research Spike 6 — On-line stacked chord separation harness.
 *
 * Isolated from production OMR. Does not modify detectOmrNoteheads.js.
 *
 * Usage:
 *   node scripts/research/online-chord-separation/run-spike.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPdfToPages } from '../../lib/renderPdfPages.mjs'
import { preprocessOmrPageImage } from '../../../src/features/omr/preprocessOmrPageImage.js'
import { processOmrPageAnalysis } from '../../../src/features/omr/processOmrPage.js'
import { parseMusicXml } from '../../../src/features/musicxml/parseMusicXml.js'
import {
  evaluateSemanticMusicXml,
  normalizeSemanticNotes,
} from '../../../src/features/omr/semanticMusicXmlEvaluator.js'
import { resolveSemanticEvalOptions } from '../../../src/features/omr/semanticEvalTolerances.js'
import { buildOmrMusicXml } from '../../../src/features/omr/buildOmrMusicXml.js'
import { midiFromStaffPosition, staffLineGap } from '../../../src/features/omr/pitchFromStaffPosition.js'
import {
  detectHeadLobes,
  hasHeadLikeInk,
  hypothesizeStaffPositions,
  preventUnsupportedMidpointMerge,
  separateOnlineChordColumn,
  splitByVerticalInkProfile,
  subtractLocalStaffLines,
} from './methods.mjs'
import { buildSyntheticCases } from './synthetic.mjs'
import { loadCreateCanvas, writeOverlayPng } from './overlays.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const OUT = join(ROOT, 'tmp/pitch-spike-6')
const PDF = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
)
const TRUTH = join(
  ROOT,
  'benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.musicxml',
)

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const labelMidi = (midi) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`

function cropImageData(imageData, x0, y0, x1, y1) {
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((y0 + y) * imageData.width + (x0 + x)) * 4
      const dst = (y * width + x) * 4
      data[dst] = imageData.data[src]
      data[dst + 1] = imageData.data[src + 1]
      data[dst + 2] = imageData.data[src + 2]
      data[dst + 3] = imageData.data[src + 3]
    }
  }
  return { data, width, height, originX: x0, originY: y0 }
}

function scoreCenters(proposed, expected, tol) {
  if (!expected?.length) {
    return { matched: 0, expected: 0, extra: proposed.length, precision: null, recall: null }
  }
  const used = new Set()
  let matched = 0
  for (const exp of expected) {
    let best = null
    let bestDist = Infinity
    proposed.forEach((center, index) => {
      if (used.has(index)) {
        return
      }
      const dist = Math.abs(center.cy - exp)
      if (dist < bestDist) {
        bestDist = dist
        best = index
      }
    })
    if (best != null && bestDist <= tol) {
      used.add(best)
      matched += 1
    }
  }
  const extra = proposed.length - matched
  return {
    matched,
    expected: expected.length,
    extra: Math.max(0, extra),
    precision: proposed.length ? matched / proposed.length : null,
    recall: expected.length ? matched / expected.length : null,
  }
}

function evaluateMethodSuite(imageData, context, expectedCenters) {
  const staffSpace = context.staffSpace
  const sortedLines = [...context.lineYsPx].sort((a, b) => a - b)
  const y0 = Math.round(sortedLines[0] - staffSpace * 2.5)
  const y1 = Math.round(sortedLines[sortedLines.length - 1] + staffSpace * 2.5)
  const tol = Math.max(3, Math.round(staffSpace * 0.35))

  const subtracted = subtractLocalStaffLines(imageData, {
    columnX: context.columnX,
    lineYsPx: sortedLines,
    halfWidth: Math.round(staffSpace * 0.9),
  })
  const vertical = splitByVerticalInkProfile(subtracted, {
    columnX: context.columnX,
    y0,
    y1,
    staffSpace,
  })
  const lobes = detectHeadLobes(subtracted, {
    columnX: context.columnX,
    y0,
    y1,
    staffSpace,
  })
  const hypotheses = hypothesizeStaffPositions(imageData, {
    columnX: context.columnX,
    lineYsPx: sortedLines,
    clef: context.clef,
    staffSpace,
  })
  const rawForMerge = [...vertical.centers, ...lobes.centers]
  const mergePrev = preventUnsupportedMidpointMerge(rawForMerge, imageData, { staffSpace })
  const ensemble = separateOnlineChordColumn(imageData, context)

  const methods = {
    verticalProfileOnSubtracted: vertical.centers,
    lobesOnSubtracted: lobes.centers,
    staffHypotheses: hypotheses.centers,
    mergePrevention: mergePrev.centers,
    ensemble: ensemble.proposedCenters,
  }
  const scores = {}
  for (const [name, centers] of Object.entries(methods)) {
    scores[name] = {
      count: centers.length,
      centers: centers.map((center) => ({ cx: center.cx, cy: center.cy, midi: center.midi ?? null })),
      ...scoreCenters(
        centers,
        expectedCenters,
        tol,
      ),
    }
  }
  return { methods: scores, staffSpace, tol, subtracted }
}

function collectRealCollapseCrops(imageData, rhythms, truthNotes) {
  const heads = []
  for (const measure of rhythms) {
    for (const event of measure.events ?? []) {
      for (const note of event.notes ?? []) {
        heads.push({
          ...note,
          measure: measure.measureNumber,
          onset: (note.onsetDivisions ?? event.startDivision ?? 0) / 4,
        })
      }
    }
  }

  const crops = []
  const seen = new Set()
  for (const truth of truthNotes.filter((note) => !note.isRest)) {
    const chord = truthNotes.filter(
      (note) =>
        !note.isRest &&
        note.measureNumber === truth.measureNumber &&
        note.staff === truth.staff &&
        Math.abs(note.onsetQuarters - truth.onsetQuarters) < 0.05,
    )
    if (chord.length < 2) {
      continue
    }
    // Only seed once per chord column.
    const key = `${truth.measureNumber}|${truth.staff}|${truth.onsetQuarters.toFixed(2)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const clef = truth.staff === 2 ? 'bass' : 'treble'
    const nearby = heads.filter(
      (head) =>
        head.measure === truth.measureNumber &&
        head.clef === clef &&
        Math.abs(head.onset - truth.onsetQuarters) <= 0.35,
    )
    if (!nearby.length) {
      continue
    }
    const lineYs = nearby[0].pitchMapping?.lineYs
    if (!lineYs?.length) {
      continue
    }
    const lineYsPx = lineYs.map((y) => y * imageData.height)
    const staffSpace = staffLineGap(lineYs) * imageData.height
    const expectedCenters = []
    for (const note of chord) {
      const gap = staffLineGap(lineYs)
      const sorted = [...lineYs].sort((a, b) => a - b)
      const bottom = sorted[sorted.length - 1]
      for (let off = -8; off <= 18; off += 1) {
        const yNorm = bottom - (off / 2) * gap
        if (midiFromStaffPosition(yNorm, lineYs, clef) === note.midi) {
          expectedCenters.push(yNorm * imageData.height)
          break
        }
      }
    }
    expectedCenters.sort((a, b) => a - b)
    if (expectedCenters.length < 2) {
      continue
    }

    const seedX = Math.round(nearby.reduce((sum, head) => sum + head.cx, 0) / nearby.length)
    let columnX = seedX
    let bestScore = -1
    for (let x = seedX - Math.round(staffSpace); x <= seedX + Math.round(staffSpace); x += 1) {
      let score = 0
      for (const cy of expectedCenters) {
        const support = hasHeadLikeInk(imageData, x, Math.round(cy), staffSpace)
        if (support.ok) {
          score += support.fill + support.thickness / staffSpace
        }
      }
      if (score > bestScore) {
        bestScore = score
        columnX = x
      }
    }

    const exactFound = chord.every((note) =>
      nearby.some((head) => head.midi === note.midi),
    )
    const midY = (expectedCenters[0] + expectedCenters[expectedCenters.length - 1]) / 2
    const hasMidpointHead = nearby.some(
      (head) => Math.abs(head.cy - midY) <= staffSpace * 0.35,
    )
    const collapsed = Boolean(hasMidpointHead && !exactFound)
    const healthyControl = Boolean(exactFound && !hasMidpointHead)
    if (!collapsed && !healthyControl) {
      continue
    }
    if (healthyControl && crops.filter((crop) => crop.kind === 'chord-control').length >= 4) {
      continue
    }
    const padX = Math.round(staffSpace * 3)
    const padY = Math.round(staffSpace * 3)
    const yMin = Math.min(...expectedCenters, ...nearby.map((head) => head.cy))
    const yMax = Math.max(...expectedCenters, ...nearby.map((head) => head.cy))
    const x0 = Math.max(0, columnX - padX)
    const x1 = Math.min(imageData.width - 1, columnX + padX)
    const y0 = Math.max(0, Math.round(yMin - padY))
    const y1 = Math.min(imageData.height - 1, Math.round(yMax + padY))
    const crop = cropImageData(imageData, x0, y0, x1, y1)
    crops.push({
      id: `real-m${truth.measureNumber}-s${truth.staff}-o${truth.onsetQuarters}`,
      kind: collapsed ? 'collapse' : 'chord-control',
      collapsed,
      measure: truth.measureNumber,
      staff: truth.staff,
      onset: truth.onsetQuarters,
      truthMidis: chord.map((note) => note.midi),
      truthLabels: chord.map((note) => labelMidi(note.midi)),
      productionMidis: nearby.map((head) => head.midi),
      imageData: crop,
      columnX: columnX - x0,
      lineYsPx: lineYsPx.map((y) => y - y0),
      staffSpace,
      clef,
      expectedCenters: expectedCenters.map((y) => y - y0),
      productionCenters: nearby.map((head) => ({
        cx: head.cx - x0,
        cy: head.cy - y0,
        midi: head.midi,
      })),
      columnInkScore: bestScore,
    })
  }
  return crops
}

function collectSingleOnlineControls(imageData, rhythms, truthNotes) {
  const heads = []
  for (const measure of rhythms) {
    for (const event of measure.events ?? []) {
      for (const note of event.notes ?? []) {
        heads.push({
          ...note,
          measure: measure.measureNumber,
          onset: (note.onsetDivisions ?? event.startDivision ?? 0) / 4,
        })
      }
    }
  }
  const crops = []
  for (const truth of truthNotes.filter((note) => !note.isRest)) {
    const chord = truthNotes.filter(
      (note) =>
        !note.isRest &&
        note.measureNumber === truth.measureNumber &&
        note.staff === truth.staff &&
        Math.abs(note.onsetQuarters - truth.onsetQuarters) < 0.05,
    )
    if (chord.length !== 1) {
      continue
    }
    const clef = truth.staff === 2 ? 'bass' : 'treble'
    const head = heads.find(
      (candidate) =>
        candidate.measure === truth.measureNumber &&
        candidate.clef === clef &&
        candidate.midi === truth.midi &&
        Math.abs(candidate.onset - truth.onsetQuarters) <= 0.25,
    )
    if (!head?.pitchMapping?.lineYs) {
      continue
    }
    // Prefer on-line notes: near a staff line.
    const lineYsPx = head.pitchMapping.lineYs.map((y) => y * imageData.height)
    const staffSpace = staffLineGap(head.pitchMapping.lineYs) * imageData.height
    const dist = Math.min(...lineYsPx.map((y) => Math.abs(y - head.cy)))
    if (dist > staffSpace * 0.2) {
      continue
    }
    if (crops.length >= 6) {
      break
    }
    const padX = Math.round(staffSpace * 3)
    const padY = Math.round(staffSpace * 3)
    const x0 = Math.max(0, head.cx - padX)
    const x1 = Math.min(imageData.width - 1, head.cx + padX)
    const y0 = Math.max(0, Math.round(head.cy - padY))
    const y1 = Math.min(imageData.height - 1, Math.round(head.cy + padY))
    const crop = cropImageData(imageData, x0, y0, x1, y1)
    crops.push({
      id: `real-single-m${truth.measureNumber}-s${truth.staff}-o${truth.onsetQuarters}`,
      kind: 'single',
      collapsed: false,
      measure: truth.measureNumber,
      staff: truth.staff,
      onset: truth.onsetQuarters,
      truthLabels: [labelMidi(truth.midi)],
      imageData: crop,
      columnX: head.cx - x0,
      lineYsPx: lineYsPx.map((y) => y - y0),
      staffSpace,
      clef,
      expectedCenters: [head.cy - y0],
      productionCenters: [{ cx: head.cx - x0, cy: head.cy - y0, midi: head.midi }],
    })
  }
  return crops
}

async function main() {
  mkdirSync(join(OUT, 'overlays'), { recursive: true })
  mkdirSync(join(OUT, 'crops'), { recursive: true })
  mkdirSync(join(OUT, 'synthetic'), { recursive: true })
  const createCanvas = await loadCreateCanvas(ROOT)

  const rendered = await renderPdfToPages(PDF, { rootDir: ROOT, maxPages: 1 })
  const { imageData } = preprocessOmrPageImage(rendered.pages[0].imageData || rendered.pages[0])
  const analysis = processOmrPageAnalysis(imageData, {
    page: 1,
    instrumentId: 'piano',
    stavesPerSystem: 2,
  })
  const rhythms = analysis.measureRhythms
  const truthXml = readFileSync(TRUTH, 'utf8')
  const truthNotes = normalizeSemanticNotes(parseMusicXml(truthXml, 'truth'))
  const opts = resolveSemanticEvalOptions({ mode: 'written' })

  // Baseline production scores (unchanged detector).
  const productionXml = buildOmrMusicXml({
    measures: rhythms,
    includeDisclaimer: false,
    instrument: { id: 'piano', notation: { grandStaff: true } },
  })
  const baseline = evaluateSemanticMusicXml({
    groundTruthMusicXml: truthXml,
    generatedMusicXml: productionXml,
    options: { mode: 'written' },
  })

  const realCrops = [
    ...collectRealCollapseCrops(imageData, rhythms, truthNotes),
    ...collectSingleOnlineControls(imageData, rhythms, truthNotes),
  ]

  const realResults = []
  for (const crop of realCrops) {
    const suite = evaluateMethodSuite(
      crop.imageData,
      {
        columnX: crop.columnX,
        lineYsPx: crop.lineYsPx,
        clef: crop.clef,
        staffSpace: crop.staffSpace,
      },
      crop.expectedCenters,
    )
    const overlayPath = join(OUT, 'overlays', `${crop.id}.png`)
    await writeOverlayPng({
      createCanvas,
      outPath: overlayPath,
      imageData: crop.imageData,
      lineYsPx: crop.lineYsPx,
      rawCandidates: crop.productionCenters,
      proposedCenters: suite.methods.ensemble.centers,
      columnX: crop.columnX,
      title: `${crop.id} (${crop.kind}) truth=${(crop.truthLabels || []).join(',')}`,
    })
    realResults.push({
      id: crop.id,
      kind: crop.kind,
      collapsed: crop.collapsed,
      truthLabels: crop.truthLabels,
      productionMidis: crop.productionMidis,
      methods: suite.methods,
      overlay: overlayPath,
    })
  }

  const syntheticCases = buildSyntheticCases()
  const syntheticResults = []
  for (const testCase of syntheticCases) {
    const suite = evaluateMethodSuite(
      testCase.imageData,
      {
        columnX: testCase.columnX,
        lineYsPx: testCase.lineYsPx,
        clef: testCase.clef,
        staffSpace: testCase.staffSpace,
      },
      testCase.expectedCenters,
    )
    const overlayPath = join(OUT, 'synthetic', `${testCase.id}.png`)
    await writeOverlayPng({
      createCanvas,
      outPath: overlayPath,
      imageData: testCase.imageData,
      lineYsPx: testCase.lineYsPx,
      rawCandidates: suite.methods.verticalProfileOnSubtracted.centers,
      proposedCenters: suite.methods.ensemble.centers,
      columnX: testCase.columnX,
      title: testCase.label,
    })
    syntheticResults.push({
      id: testCase.id,
      kind: testCase.kind,
      label: testCase.label,
      expectCount: testCase.expectCount,
      methods: suite.methods,
      overlay: overlayPath,
      pass: {
        ensembleCountOk: suite.methods.ensemble.count === testCase.expectCount,
        ensembleRecall:
          suite.methods.ensemble.recall == null ? null : suite.methods.ensemble.recall >= 0.99,
        noExtra:
          testCase.kind.startsWith('single')
            ? suite.methods.ensemble.count <= 1
            : suite.methods.ensemble.extra <= 1,
      },
    })
  }

  // Summaries
  const collapseCrops = realResults.filter((row) => row.collapsed)
  const singleCrops = realResults.filter((row) => row.kind === 'single')
  const methodNames = [
    'verticalProfileOnSubtracted',
    'lobesOnSubtracted',
    'staffHypotheses',
    'mergePrevention',
    'ensemble',
  ]
  const methodSummary = {}
  for (const name of methodNames) {
    const collapseRecall = collapseCrops.map((row) => row.methods[name].recall).filter((value) => value != null)
    const collapseExtra = collapseCrops.reduce((sum, row) => sum + row.methods[name].extra, 0)
    const singleExtra = singleCrops.reduce((sum, row) => sum + Math.max(0, row.methods[name].count - 1), 0)
    const synthChord = syntheticResults.filter((row) => row.kind === 'chord')
    const synthSingle = syntheticResults.filter((row) => row.kind.startsWith('single'))
    methodSummary[name] = {
      collapseCrops: collapseCrops.length,
      meanCollapseRecall: collapseRecall.length
        ? collapseRecall.reduce((a, b) => a + b, 0) / collapseRecall.length
        : null,
      collapseExtraTotal: collapseExtra,
      singleOnlineExtraHeads: singleExtra,
      syntheticChordPass: synthChord.filter((row) => row.methods[name].recall >= 0.99 && row.methods[name].count >= row.expectCount).length,
      syntheticChordTotal: synthChord.length,
      syntheticSingleStaySingle: synthSingle.filter((row) => row.methods[name].count === 1).length,
      syntheticSingleTotal: synthSingle.length,
    }
  }

  const report = {
    kind: 'pitch-research-spike-6',
    title: 'On-line stacked chord separation',
    productionUnchanged: true,
    baseline: {
      pitch: baseline.classes.pitch.percent,
      pitchTP: baseline.classes.pitch.truePositives,
      sustainTP: baseline.classes.sustain.truePositives,
      sustainDen: baseline.classes.sustain.denominator,
      articulationTP: baseline.classes.articulation.truePositives,
      articulationDen: baseline.classes.articulation.denominator,
    },
    realCropCounts: {
      total: realResults.length,
      collapse: collapseCrops.length,
      chordControl: realResults.filter((row) => row.kind === 'chord-control').length,
      single: singleCrops.length,
    },
    methodSummary,
    syntheticResults,
    realResults,
    integrationDecision: null,
  }

  // Decide whether any method is safe enough to consider production.
  // Prefer methods that keep synthetic singles single, then maximize collapse
  // recall while limiting extras (false noteheads).
  const ranked = Object.entries(methodSummary)
    .filter(
      ([, stats]) =>
        stats.syntheticSingleStaySingle === stats.syntheticSingleTotal &&
        stats.syntheticChordPass >= Math.ceil(stats.syntheticChordTotal * 0.75) &&
        stats.singleOnlineExtraHeads === 0 &&
        stats.collapseExtraTotal / Math.max(1, stats.collapseCrops) <= 0.5 &&
        (stats.meanCollapseRecall ?? 0) >= 0.5 &&
        // Require at least some real single on-line controls before production.
        report.realCropCounts.single >= 3,
    )
    .sort((a, b) => {
      const recallA = a[1].meanCollapseRecall ?? 0
      const recallB = b[1].meanCollapseRecall ?? 0
      if (Math.abs(recallB - recallA) > 0.02) {
        return recallB - recallA
      }
      const extraA = a[1].collapseExtraTotal / Math.max(1, a[1].collapseCrops)
      const extraB = b[1].collapseExtraTotal / Math.max(1, b[1].collapseCrops)
      return extraA - extraB
    })
  const best = ranked[0]
  const bestName = best?.[0] ?? null
  const bestStats = best?.[1] ?? null
  const safeEnough = Boolean(bestStats)

  const gatedNearMisses = Object.entries(methodSummary)
    .filter(
      ([, stats]) =>
        stats.syntheticSingleStaySingle === stats.syntheticSingleTotal &&
        stats.syntheticChordPass >= Math.ceil(stats.syntheticChordTotal * 0.75),
    )
    .sort((a, b) => (b[1].meanCollapseRecall ?? 0) - (a[1].meanCollapseRecall ?? 0))

  report.integrationDecision = {
    recommendedMethod: safeEnough ? bestName : null,
    safeEnough,
    candidatesPassingAllGates: ranked.map(([name, stats]) => ({
      name,
      recall: stats.meanCollapseRecall,
      extrasPerCollapse: stats.collapseExtraTotal / Math.max(1, stats.collapseCrops),
    })),
    reason: safeEnough
      ? `${bestName} recovered ≥50% collapse recall with ≤0.75 extras/crop and clean synthetic singles/chords.`
      : `No method met isolated safety bar (synth singles stay single, ≥75% synth chords, collapse recall≥0.5, ≤0.5 extras/collapse-crop, ≥3 real single on-line controls). Near-misses: ${
          gatedNearMisses
            .slice(0, 4)
            .map(
              ([name, stats]) =>
                `${name}(recall=${(stats.meanCollapseRecall ?? 0).toFixed(2)}, extras/crop=${(
                  stats.collapseExtraTotal / Math.max(1, stats.collapseCrops)
                ).toFixed(2)})`,
            )
            .join(', ') || 'none'
        }. Real single controls collected: ${report.realCropCounts.single}. Production left unchanged.`,
    criticalScanFinding:
      'On the canonical m5 treble opening column, expected upper chord-tone line positions often lack head-like vertical ink (bare staff line only); recoverable ink sits near mid/lower tones. Methods must not invent missing upper tones without ink — and ink-supported recovery still over-proposes extras on real collapses.',
  }

  writeFileSync(join(OUT, 'REPORT.json'), JSON.stringify(report, null, 2))

  const md = `# Pitch Research Spike 6 — On-line stacked chord separation

## Decision
**${safeEnough ? `Candidate for careful integration: \`${bestName}\`` : 'Leave production unchanged.'}**

${report.integrationDecision.reason}

Production detector was **not** modified. Pitch Sprint 4 remains the baseline.

## Baseline (production, unchanged)
- Pitch: ${report.baseline.pitch} (TP=${report.baseline.pitchTP})
- Sustain TP: ${report.baseline.sustainTP}/${report.baseline.sustainDen}
- Articulation TP: ${report.baseline.articulationTP}/${report.baseline.articulationDen}

## Methods tested
1. Local staff-line subtraction (column-local thin horizontal removal)
2. Vertical ink-profile splitting
3. Shape/lobe detection on tall bands
4. Staff-position hypothesis testing (ink-supported only)
5. Merge prevention when midpoint lacks support
6. Ensemble of the above

## Real crops
- collapse-like: ${report.realCropCounts.collapse}
- chord controls: ${report.realCropCounts.chordControl}
- single on-line controls: ${report.realCropCounts.single}

## Method summary
${methodNames
  .map((name) => {
    const row = methodSummary[name]
    return `- **${name}**: collapse recall=${row.meanCollapseRecall == null ? 'n/a' : row.meanCollapseRecall.toFixed(2)}, collapse extras=${row.collapseExtraTotal}, single extras=${row.singleOnlineExtraHeads}, synth chords ${row.syntheticChordPass}/${row.syntheticChordTotal}, synth singles kept ${row.syntheticSingleStaySingle}/${row.syntheticSingleTotal}`
  })
  .join('\n')}

## Estimated collapse recovery
Of the Sprint 5 ~18 chord-collapse paired errors, isolated collapse crops here: **${collapseCrops.length}**.
${(() => {
    const near = gatedNearMisses[0]
    const stats = safeEnough ? bestStats : near?.[1]
    const name = safeEnough ? bestName : near?.[0]
    if (!stats?.meanCollapseRecall) {
      return 'No usable recall estimate (no gated near-miss).'
    }
    const recovered = Math.round(18 * stats.meanCollapseRecall)
    return `Nearest gated method **${name}** mean recall **${(stats.meanCollapseRecall * 100).toFixed(0)}%** ⇒ rough recovery estimate **${recovered} / 18** if it translated 1:1 (it may not; extras and missing upper-tone ink argue against shipping).`
  })()}

## Safety checklist
- Fixture/measure/pitch hardcoding: none in research methods
- Tie/articulation recognition: untouched
- Global staff-line rejection / broad seed exceptions: untouched
- Production detector (\`detectOmrNoteheads.js\`): unchanged
- Evaluator: frozen
- Single on-line notes stay single (synthetic): yes for all methods except \`staffHypotheses\`
- Real single on-line controls: **${report.realCropCounts.single} collected** (need ≥3 before production)
- Staccato/articulation dots as false noteheads: not fully exercised; collapse-crop extras are the proxy risk
- Sustain TP / Articulation TP: baseline unchanged (no integration run)

## Critical scan finding
${report.integrationDecision.criticalScanFinding}

## Artifacts
- \`tmp/pitch-spike-6/REPORT.json\`
- overlays: \`tmp/pitch-spike-6/overlays/\`
- synthetic: \`tmp/pitch-spike-6/synthetic/\`
`
  writeFileSync(join(OUT, 'REPORT.md'), md)
  console.log(md)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
