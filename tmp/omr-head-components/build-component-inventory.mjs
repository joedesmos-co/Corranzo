#!/usr/bin/env node
/**
 * Phase 1 — no-head-sized-component inventory for fragmented notehead recovery.
 * Diagnostic only under tmp/omr-head-components/. Does not edit production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { runPdfOmrPipeline } from '../../src/features/omr/runPdfOmrPipeline.js'
import { processOmrPageAnalysis } from '../../src/features/omr/processOmrPage.js'
import {
  estimateLedgerLineCount,
  resolveNoteheadAnchor,
} from '../../src/features/omr/pitchFromStaffPosition.js'
import { partitionHorizontalRowsForInkRecovery } from '../../src/features/omr/localLedgerStaffClassifier.js'
import {
  SEMANTIC_EVAL_SCHEMA_VERSION,
  SEMANTIC_EVALUATOR_VERSION,
} from '../../src/features/omr/semanticEvalTolerances.js'
import {
  makePdfTextExtractor,
  makeRenderPageCallback,
  renderPdfToPages,
  CALIBRATION_ANALYSIS_WIDTH,
} from '../../scripts/lib/renderPdfPages.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'tmp/omr-head-components')
const INK_THRESHOLD = 170
const ACCIDENTAL_CODES = new Set([0xe260, 0xe261, 0xe262, 0xe263, 0xe264])

mkdirSync(OUT, { recursive: true })
mkdirSync(join(OUT, 'diagnostics'), { recursive: true })

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim()
  } catch {
    return null
  }
}

function expandHome(pathValue) {
  if (!pathValue) return pathValue
  if (pathValue.startsWith('~/')) return join(homedir(), pathValue.slice(2))
  return pathValue
}

function resolveFixturePath(relativePath, searchPaths) {
  for (const root of searchPaths) {
    const candidate = resolve(expandHome(root), relativePath)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function loadFixtures() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'benchmarks/omr-benchmark.manifest.json'), 'utf8'))
  const roots = (manifest.fixtureSearchPaths ?? ['benchmarks/omr-fixtures']).map((path) =>
    path.startsWith('~/') || path.startsWith('/') ? expandHome(path) : join(ROOT, path),
  )
  if (!roots.includes(join(ROOT, 'benchmarks/omr-fixtures'))) {
    roots.unshift(join(ROOT, 'benchmarks/omr-fixtures'))
  }
  const fixtures = (manifest.fixtures ?? []).filter((fixture) => {
    if (!fixture.truth || !fixture.pdf) return false
    if (fixture.expectedRejectionCodes) return false
    if (!fixture.thresholds) return false
    if (String(fixture.tier ?? '').startsWith('real-')) return false
    if (String(fixture.tier ?? '').startsWith('legacy')) return false
    return true
  })
  return { fixtures, roots }
}

function midiToLabel(midi) {
  if (!Number.isFinite(midi)) return null
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const rounded = Math.round(midi)
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

function registerBinForTone(midi, { clef = null, ledger = null } = {}) {
  if (ledger?.direction === 'above' && (ledger.count ?? 0) >= 1 && clef === 'treble') {
    return 'high-extreme'
  }
  if (ledger?.direction === 'below' && (ledger.count ?? 0) >= 1 && clef === 'bass') {
    return 'low-extreme'
  }
  if (!Number.isFinite(midi)) return 'middle'
  if (midi < 41) return 'low-extreme'
  if (midi <= 59) return 'low-normal'
  if (midi < 64) return 'middle'
  if (midi <= 79) return 'high-normal'
  return 'high-extreme'
}

function pixelIsInk(imageData, x, y, threshold = INK_THRESHOLD) {
  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) return false
  const index = (y * imageData.width + x) * 4
  const alpha = imageData.data[index + 3] / 255
  const luminance =
    (0.299 * imageData.data[index] +
      0.587 * imageData.data[index + 1] +
      0.114 * imageData.data[index + 2]) *
      alpha +
    255 * (1 - alpha)
  return luminance < threshold
}

function lineYsInPixels(lineYs, imageHeight) {
  if (!Array.isArray(lineYs) || !lineYs.length) return []
  const scale = lineYs.every((value) => Math.abs(value) <= 1.5) ? imageHeight : 1
  return lineYs.map((value) => value * scale)
}

function staffGapPx(lineYs, imageHeight) {
  const pixels = lineYsInPixels(lineYs, imageHeight)
  if (pixels.length < 2) return 0
  const sorted = [...pixels].sort((a, b) => a - b)
  return (sorted[sorted.length - 1] - sorted[0]) / 4
}

function verticalInkExtent(imageData, x, y, radius = 3) {
  if (!pixelIsInk(imageData, x, y)) return 0
  let top = y
  let bottom = y
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y - dy)) top = y - dy
    else break
  }
  for (let dy = 1; dy <= radius; dy += 1) {
    if (pixelIsInk(imageData, x, y + dy)) bottom = y + dy
    else break
  }
  return bottom - top + 1
}

function longestHorizontalInkRun(imageData, y, left, right) {
  let run = 0
  let longest = 0
  let longestStart = left
  let longestEnd = left
  let currentStart = left
  for (let x = left; x <= right; x += 1) {
    if (pixelIsInk(imageData, x, y)) {
      if (run === 0) currentStart = x
      run += 1
      if (run > longest) {
        longest = run
        longestStart = currentStart
        longestEnd = x
      }
    } else {
      run = 0
    }
  }
  return { longest, runStart: longestStart, runEnd: longestEnd }
}

function collectComponents({
  imageData,
  left,
  right,
  top,
  bottom,
  suppressedRows = new Set(),
  maskedLedgerRows = new Set(),
  suppressedColumns = new Set(),
  applyLedgerMask = false,
}) {
  const pixels = new Map()
  for (let y = top; y <= bottom; y += 1) {
    if (suppressedRows.has(y)) continue
    for (let x = left; x <= right; x += 1) {
      if (suppressedColumns.has(x) || !pixelIsInk(imageData, x, y)) continue
      if (applyLedgerMask && maskedLedgerRows.has(y) && verticalInkExtent(imageData, x, y) <= 2) {
        continue
      }
      pixels.set(`${x}:${y}`, { x, y })
    }
  }
  const components = []
  let id = 0
  while (pixels.size) {
    const first = pixels.values().next().value
    const queue = [first]
    pixels.delete(`${first.x}:${first.y}`)
    const component = {
      id: `c${id}`,
      top: first.y,
      bottom: first.y,
      left: first.x,
      right: first.x,
      pixels: 0,
    }
    id += 1
    for (let index = 0; index < queue.length; index += 1) {
      const point = queue[index]
      component.top = Math.min(component.top, point.y)
      component.bottom = Math.max(component.bottom, point.y)
      component.left = Math.min(component.left, point.x)
      component.right = Math.max(component.right, point.x)
      component.pixels += 1
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const key = `${point.x + dx}:${point.y + dy}`
          const neighbor = pixels.get(key)
          if (neighbor) {
            pixels.delete(key)
            queue.push(neighbor)
          }
        }
      }
    }
    const width = component.right - component.left + 1
    const height = component.bottom - component.top + 1
    components.push({
      ...component,
      width,
      height,
      area: component.pixels,
      fillRatio: component.pixels / Math.max(1, width * height),
      aspectRatio: height > 0 ? width / height : null,
      centerX: (component.left + component.right) / 2,
      centerY: (component.top + component.bottom) / 2,
    })
  }
  return components
}

function annotateComponents(components, gapPx, glyphX, glyphY) {
  return components.map((c) => {
    const widthRatio = c.width / gapPx
    const heightRatio = c.height / gapPx
    const xOriginOffset = (c.centerX - glyphX) / gapPx
    const yOriginOffset = (glyphY - c.centerY) / gapPx
    const headSized =
      widthRatio >= 0.42 &&
      widthRatio <= 1.05 &&
      heightRatio >= 0.22 &&
      heightRatio <= 0.7
    const rejectReasons = []
    if (widthRatio < 0.42) rejectReasons.push('width-too-narrow')
    if (widthRatio > 1.05) rejectReasons.push('width-too-wide')
    if (heightRatio < 0.22) rejectReasons.push('height-too-short')
    if (heightRatio > 0.7) rejectReasons.push('height-too-tall')
    if (xOriginOffset < -0.32 || xOriginOffset > 0.95) rejectReasons.push('x-origin-out-of-band')
    if (yOriginOffset < 0.45 || yOriginOffset > 1) rejectReasons.push('y-origin-out-of-band')
    const looksStem =
      widthRatio <= 0.28 && heightRatio >= 0.9 && c.aspectRatio != null && c.aspectRatio < 0.35
    const looksLedger =
      heightRatio <= 0.18 && widthRatio >= 0.55 && c.aspectRatio != null && c.aspectRatio >= 2.2
    const looksBeam =
      heightRatio <= 0.35 && widthRatio >= 1.2 && c.aspectRatio != null && c.aspectRatio >= 2.5
    const nearHeadBand =
      xOriginOffset >= -0.4 &&
      xOriginOffset <= 1.1 &&
      yOriginOffset >= 0.2 &&
      yOriginOffset <= 1.3
    return {
      id: c.id,
      bounds: { x: c.left, y: c.top, w: c.width, h: c.height },
      area: c.area,
      fillRatio: Number(c.fillRatio.toFixed(3)),
      aspectRatio: Number((c.aspectRatio ?? 0).toFixed(3)),
      widthRatio: Number(widthRatio.toFixed(3)),
      heightRatio: Number(heightRatio.toFixed(3)),
      xOriginOffset: Number(xOriginOffset.toFixed(3)),
      yOriginOffset: Number(yOriginOffset.toFixed(3)),
      distanceFromOriginSpaces: Number(
        Math.hypot(xOriginOffset - 0.55, yOriginOffset - 0.51).toFixed(3),
      ),
      headSized,
      rejectReasons,
      looksStem,
      looksLedger,
      looksBeam,
      nearHeadBand,
      likelyHeadFragment:
        nearHeadBand &&
        !looksStem &&
        !looksLedger &&
        !looksBeam &&
        widthRatio >= 0.15 &&
        heightRatio >= 0.12 &&
        widthRatio <= 1.2 &&
        heightRatio <= 1.1,
    }
  })
}

function firstRejectRule(annotated) {
  if (!annotated.length) return 'no-components-in-window'
  if (annotated.some((c) => c.headSized)) return 'head-sized-exists-but-caller-rejected'
  const near = annotated.filter((c) => c.likelyHeadFragment || c.nearHeadBand)
  if (!near.length) return 'no-near-origin-body-fragments'
  const reasons = new Map()
  for (const c of near) {
    for (const reason of c.rejectReasons) {
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
    }
  }
  const ranked = [...reasons.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? 'size-band-miss'
}

function classifyMechanism({
  before,
  after,
  maskedLedgerRowCount,
  headSizedBefore,
  headSizedAfter,
  accidentalNearby,
}) {
  const beforeFragments = before.filter((c) => c.likelyHeadFragment)
  const afterFragments = after.filter((c) => c.likelyHeadFragment)
  const beforeOpenish =
    beforeFragments.length >= 2 &&
    beforeFragments.every((c) => c.fillRatio < 0.45 || c.heightRatio <= 0.45)
  const afterOpenish =
    afterFragments.length >= 2 &&
    afterFragments.every((c) => c.fillRatio < 0.45 || c.heightRatio <= 0.45)

  if (before.length === 0 && after.length === 0) return 'genuinely-absent-usable-ink'
  if (accidentalNearby?.length && afterFragments.some((c) => c.xOriginOffset < 0)) {
    return 'notehead-fragments-merged-with-accidental-ink'
  }
  if (headSizedBefore > 0 && headSizedAfter === 0 && maskedLedgerRowCount > 0) {
    return 'ledger-masking-over-subtraction'
  }
  if (
    beforeFragments.length >= 2 &&
    headSizedBefore === 0 &&
    beforeFragments.some((c) => c.fillRatio >= 0.35)
  ) {
    return 'fragmented-filled-notehead'
  }
  if (beforeOpenish || afterOpenish) return 'fragmented-open-notehead'
  if (
    after.some((c) => c.looksStem) &&
    afterFragments.length >= 1 &&
    headSizedAfter === 0
  ) {
    return 'stem-head-split-no-body-reconstruction'
  }
  if (
    afterFragments.length >= 3 &&
    new Set(afterFragments.map((c) => Math.round(c.centerY / 4))).size >= 2
  ) {
    return 'stacked-heads-competing-for-fragments'
  }
  if (
    after.some(
      (c) =>
        (c.widthRatio > 1.05 || c.heightRatio > 0.7 || c.heightRatio < 0.22) &&
        c.nearHeadBand,
    )
  ) {
    return 'transformed-components-outside-expected-size'
  }
  if (afterFragments.length >= 2 && headSizedAfter === 0) {
    return 'fragmented-filled-notehead'
  }
  if (afterFragments.length === 0) return 'genuinely-absent-usable-ink'
  return 'transformed-components-outside-expected-size'
}

function findNearbyAccidentals(pageText, note, imageData, gapPx) {
  const found = []
  for (const item of pageText ?? []) {
    const text = item.text ?? ''
    if (!text.length || !item.pageWidth || !item.pageHeight) continue
    const scaleX = imageData.width / item.pageWidth
    const scaleY = imageData.height / item.pageHeight
    const charWidth = (item.width ?? 0) / Math.max(1, text.length)
    for (let index = 0; index < text.length; index += 1) {
      const code = text.codePointAt(index)
      if (!ACCIDENTAL_CODES.has(code)) continue
      const gx = (item.x + charWidth * (index + 0.5)) * scaleX
      const gy = imageData.height - item.y * scaleY
      const dx = note.cx - gx
      const dy = note.cy - gy
      if (Math.abs(dx) <= gapPx * 3.5 && Math.abs(dy) <= gapPx * 1.8) {
        found.push({
          code: `U+${code.toString(16).toUpperCase()}`,
          x: Number(gx.toFixed(1)),
          y: Number(gy.toFixed(1)),
          dxSpaces: Number((dx / gapPx).toFixed(3)),
          dySpaces: Number((dy / gapPx).toFixed(3)),
        })
      }
    }
  }
  return found
}

function probeNoHeadSized(note, imageData, lineYs, pageText) {
  const gapPx = staffGapPx(lineYs, imageData.height)
  if (!(gapPx >= 4)) return { ok: false, reason: 'missing-gap' }
  const glyphX = note.cx
  const glyphY = note.cy
  const glyphWidth = Math.max(gapPx * 0.85, 10)
  const glyphHeight = Math.max(gapPx * 1.85, 16)
  const metricY = glyphY - gapPx * 0.32
  const supportRadius = Math.ceil(Math.max(gapPx * 1.7, glyphWidth * 1.1))
  const leftSupport = Math.max(0, Math.floor(glyphX - supportRadius))
  const rightSupport = Math.min(imageData.width - 1, Math.ceil(glyphX + supportRadius))
  const left = Math.max(0, Math.floor(glyphX - gapPx * 0.3))
  const right = Math.min(imageData.width - 1, Math.ceil(glyphX + gapPx * 1.15))
  const top = Math.max(
    0,
    Math.floor(Math.min(metricY, glyphY) - Math.max(gapPx * 1.35, glyphHeight * 0.9)),
  )
  const bottom = Math.min(imageData.height - 1, Math.ceil(glyphY + gapPx * 0.3))
  const pixelLines = lineYsInPixels(lineYs, imageData.height)
  const staffTopPx = Math.min(...pixelLines)
  const staffBottomPx = Math.max(...pixelLines)
  const localWidth = Math.max(1, right - left + 1)
  const systemWidth = imageData.width
  const horizontalSupportThreshold = Math.max(gapPx * 1.02, localWidth * 0.82)

  const candidateRows = []
  for (let y = top; y <= bottom; y += 1) {
    const local = longestHorizontalInkRun(imageData, y, leftSupport, rightSupport)
    if (local.longest < horizontalSupportThreshold * 0.5) continue
    const system = longestHorizontalInkRun(imageData, y, 0, imageData.width - 1)
    candidateRows.push({
      y,
      longestRunPx: local.longest,
      runStart: local.runStart,
      runEnd: local.runEnd,
      lengthRelativeToLocalWindow: local.longest / localWidth,
      lengthRelativeToSystem: system.longest / systemWidth,
    })
  }
  const partitioned = partitionHorizontalRowsForInkRecovery(candidateRows, {
    gapPx,
    staffTopPx,
    staffBottomPx,
    noteheadX: glyphX,
    chordColumnXs: [glyphX],
    systemEventSupport: 0,
  })
  const suppressedRows = new Set(partitioned.suppressedStaffRows)
  const maskedLedgerRows = new Set(partitioned.acceptedLedgerRows.map((r) => r.y))

  const suppressedColumns = new Set()
  const verticalSupportThreshold = Math.max(gapPx * 0.9, (bottom - top + 1) * 0.42)
  for (let x = left; x <= right; x += 1) {
    let count = 0
    for (let y = top; y <= bottom; y += 1) {
      if (suppressedRows.has(y)) continue
      if (maskedLedgerRows.has(y) && verticalInkExtent(imageData, x, y) <= 2) continue
      if (pixelIsInk(imageData, x, y)) count += 1
    }
    if (count >= verticalSupportThreshold) suppressedColumns.add(x)
  }

  const rawBefore = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows: new Set(),
    suppressedColumns: new Set(),
    applyLedgerMask: false,
  })
  const afterStaffOnly = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows,
    suppressedColumns,
    applyLedgerMask: false,
  })
  const afterMask = collectComponents({
    imageData,
    left,
    right,
    top,
    bottom,
    suppressedRows,
    maskedLedgerRows,
    suppressedColumns,
    applyLedgerMask: true,
  })

  const before = annotateComponents(rawBefore, gapPx, glyphX, glyphY)
  const afterStaff = annotateComponents(afterStaffOnly, gapPx, glyphX, glyphY)
  const after = annotateComponents(afterMask, gapPx, glyphX, glyphY)
  const accidentalNearby = findNearbyAccidentals(pageText, note, imageData, gapPx)

  const headSizedBefore = before.filter((c) => c.headSized).length
  const headSizedAfterStaff = afterStaff.filter((c) => c.headSized).length
  const headSizedAfter = after.filter((c) => c.headSized).length

  return {
    ok: true,
    window: { left, right, top, bottom },
    gapPx,
    expectedHeadWidthRange: [0.42 * gapPx, 1.05 * gapPx],
    expectedHeadHeightRange: [0.22 * gapPx, 0.7 * gapPx],
    suppressedStaffRows: [...suppressedRows],
    maskedLedgerRows: [...maskedLedgerRows],
    suppressedStemColumns: suppressedColumns.size,
    componentsBeforeMasking: before,
    componentsAfterStaffSuppress: afterStaff,
    componentsAfterLedgerMask: after,
    connectivity: {
      componentCountBefore: before.length,
      componentCountAfterStaff: afterStaff.length,
      componentCountAfterMask: after.length,
      headSizedBefore,
      headSizedAfterStaff,
      headSizedAfter,
      likelyHeadFragmentsBefore: before.filter((c) => c.likelyHeadFragment).length,
      likelyHeadFragmentsAfter: after.filter((c) => c.likelyHeadFragment).length,
      totalAreaBefore: before.reduce((s, c) => s + c.area, 0),
      totalAreaAfter: after.reduce((s, c) => s + c.area, 0),
    },
    firstRejectRule: firstRejectRule(after),
    accidentalCandidatesNearby: accidentalNearby,
    stemCandidate: after.find((c) => c.looksStem) ?? null,
    beamCandidate: after.find((c) => c.looksBeam) ?? null,
    ledgerFragmentsRemoved: partitioned.acceptedLedgerRows.length,
    mechanism: classifyMechanism({
      before,
      after,
      maskedLedgerRowCount: maskedLedgerRows.size,
      headSizedBefore,
      headSizedAfter,
      accidentalNearby,
    }),
    visualSourceHints: {
      filledHeadLikely: after.some((c) => c.likelyHeadFragment && c.fillRatio >= 0.35),
      openHeadLikely:
        after.filter((c) => c.likelyHeadFragment).length >= 2 &&
        after.filter((c) => c.likelyHeadFragment).every((c) => c.fillRatio < 0.45),
      stackedChordHeadLikely:
        after.filter((c) => c.likelyHeadFragment).length >= 2 &&
        new Set(
          after.filter((c) => c.likelyHeadFragment).map((c) => Math.round(c.centerY / (gapPx * 0.4))),
        ).size >= 2,
      compositeNoteStemLikely: Boolean(after.find((c) => c.looksStem)),
      displacedSecondLikely: false,
    },
  }
}

function bump(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount
}

async function collectFixture(fixture, roots) {
  const pdfPath = resolveFixturePath(fixture.pdf, roots)
  if (!pdfPath) return { id: fixture.id, ok: false, error: 'missing pdf', records: [] }
  const rendered = await renderPdfToPages(pdfPath, {
    rootDir: ROOT,
    maxPages: fixture.maxPages ?? 4,
    analysisWidth: CALIBRATION_ANALYSIS_WIDTH,
  })
  const extractPageText = await makePdfTextExtractor(pdfPath, { rootDir: ROOT })
  const records = []

  await runPdfOmrPipeline(pdfPath, {
    renderPage: makeRenderPageCallback(rendered.pages),
    extractPageText,
    numPages: rendered.numPages,
    maxPages: fixture.maxPages ?? 4,
    preprocessPages: true,
    instrumentId: fixture.instrumentId ?? 'piano',
    title: fixture.id,
    analyzePage: async (imageData, context) => {
      const pageResult = processOmrPageAnalysis(imageData, context)
      const pageNumber = context.pageNumber ?? pageResult.pageEntry?.page ?? 1
      const pageText = context.pageText ?? []

      for (const measure of pageResult.measureRhythms ?? []) {
        for (const event of measure.events ?? []) {
          if (event.type !== 'note') continue
          for (const note of event.notes ?? []) {
            const anchor = note.noteheadAnchor
            if (anchor?.rejectedReason !== 'no-head-sized-component') continue
            const lineYs = note.pitchMapping?.lineYs ?? []
            const ledger = Number.isFinite(note.yNorm) && lineYs.length
              ? estimateLedgerLineCount(note.yNorm, lineYs)
              : { direction: null, count: 0 }
            const register = registerBinForTone(note.midi ?? note.naturalMidi, {
              clef: note.clef,
              ledger,
            })
            // Confirm rejection with current resolver
            const confirm = resolveNoteheadAnchor(
              {
                x: note.cx,
                y: note.cy,
                width: 14,
                height: 24,
                text: note.noteheadFont?.glyph ?? '\ue0a4',
                fontName: note.noteheadFont?.fontName ?? '',
              },
              imageData,
              lineYs,
            )
            const probe = probeNoHeadSized(note, imageData, lineYs, pageText)
            records.push({
              fixture: fixture.id,
              page: pageNumber,
              system: measure.systemIndex ?? null,
              staff: note.clef === 'bass' ? 2 : 1,
              measure: measure.measureNumber,
              voice: note.voice ?? (note.clef === 'bass' ? 2 : 1),
              clef: note.clef ?? 'treble',
              onsetQuarters: (event.startDivision ?? 0) / 4,
              noteCandidateId: `${fixture.id}:p${pageNumber}:m${measure.measureNumber}:x${Math.round(note.cx)}:y${Math.round(note.cy)}`,
              chordColumnId: `${fixture.id}:m${measure.measureNumber}:col${Math.round(note.cx / 12)}`,
              register,
              midi: note.midi ?? note.naturalMidi ?? null,
              pitchLabel: midiToLabel(note.midi ?? note.naturalMidi),
              fontName: note.noteheadFont?.fontName ?? null,
              glyph: note.noteheadFont?.glyph ?? null,
              glyphId: note.noteheadFont?.glyph
                ? `U+${note.noteheadFont.glyph.codePointAt(0).toString(16).toUpperCase()}`
                : null,
              glyphOrigin: { x: note.cx, y: note.cy },
              glyphTransform: null,
              generatedFallbackYNorm: anchor.yNorm,
              rawYNorm: anchor.rawYNorm,
              confirmRejectedReason: confirm.rejectedReason,
              localStaffSpacingPx: probe.gapPx ?? null,
              expectedHeadWidthRange: probe.expectedHeadWidthRange ?? null,
              expectedHeadHeightRange: probe.expectedHeadHeightRange ?? null,
              ledgerFragmentsRemoved: probe.ledgerFragmentsRemoved ?? 0,
              maskedLedgerRows: probe.maskedLedgerRows ?? [],
              suppressedStaffRows: probe.suppressedStaffRows ?? [],
              connectivity: probe.connectivity ?? null,
              componentsBeforeMasking: probe.componentsBeforeMasking ?? [],
              componentsAfterLedgerMask: probe.componentsAfterLedgerMask ?? [],
              firstRejectRule: probe.firstRejectRule ?? null,
              mechanism: probe.mechanism ?? 'unknown',
              visualSourceHints: probe.visualSourceHints ?? null,
              stemCandidate: probe.stemCandidate
                ? { id: probe.stemCandidate.id, bounds: probe.stemCandidate.bounds }
                : null,
              beamCandidate: probe.beamCandidate
                ? { id: probe.beamCandidate.id, bounds: probe.beamCandidate.bounds }
                : null,
              accidentalCandidatesNearby: probe.accidentalCandidatesNearby ?? [],
              window: probe.window ?? null,
            })
          }
        }
      }
      return pageResult
    },
  })

  writeFileSync(
    join(OUT, 'diagnostics', `${fixture.id}.no-head-sized.json`),
    `${JSON.stringify(records, null, 2)}\n`,
  )
  return { id: fixture.id, ok: true, count: records.length, records }
}

function summarize(records) {
  const byMechanism = {}
  const byRegister = {}
  const byRejectRule = {}
  const byFixture = {}
  const highExtreme = records.filter((r) => r.register === 'high-extreme')
  let maskingDestroyedHeads = 0
  let fragmentsPresent = 0
  for (const record of records) {
    bump(byMechanism, record.mechanism ?? 'unknown')
    bump(byRegister, record.register ?? 'unknown')
    bump(byRejectRule, record.firstRejectRule ?? 'unknown')
    bump(byFixture, record.fixture)
    if (
      (record.connectivity?.headSizedBefore ?? 0) > 0 &&
      (record.connectivity?.headSizedAfter ?? 0) === 0
    ) {
      maskingDestroyedHeads += 1
    }
    if ((record.connectivity?.likelyHeadFragmentsAfter ?? 0) >= 2) fragmentsPresent += 1
  }
  return {
    totalNoHeadSizedRejections: records.length,
    highExtremeNoHeadSized: highExtreme.length,
    maskingDestroyedHeads,
    withMultipleHeadFragmentsAfterMask: fragmentsPresent,
    byMechanism,
    byRegister,
    byFirstRejectRule: byRejectRule,
    byFixture,
  }
}

function renderMarkdown(payload) {
  const lines = []
  lines.push('# Phase 1 — no-head-sized-component inventory')
  lines.push('')
  lines.push(`- Commit: \`${payload.gitCommit}\``)
  lines.push(`- Created: ${payload.createdAt}`)
  lines.push('- Evaluator: frozen 2.0.0 / schema 2')
  lines.push('- Production code: **not modified**')
  lines.push('- Optical profile: **disabled**')
  lines.push('')
  lines.push('## Scope')
  lines.push('')
  lines.push(
    'Every generated note whose `noteheadAnchor.rejectedReason === no-head-sized-component` across the frozen nine-fixture corpus, with before/after ledger-mask component probes.',
  )
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(`- Total no-head-sized rejections: **${payload.summary.totalNoHeadSizedRejections}**`)
  lines.push(`- High-extreme subset: **${payload.summary.highExtremeNoHeadSized}**`)
  lines.push(
    `- Cases where head-sized existed before mask but not after: **${payload.summary.maskingDestroyedHeads}**`,
  )
  lines.push(
    `- Cases with ≥2 likely head fragments after mask: **${payload.summary.withMultipleHeadFragmentsAfterMask}**`,
  )
  lines.push('')
  const section = (title, obj) => {
    lines.push(`## ${title}`)
    lines.push('')
    lines.push('| Key | Count |')
    lines.push('|---|---:|')
    for (const [key, count] of Object.entries(obj).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${key}\` | ${count} |`)
    }
    lines.push('')
  }
  section('By mechanism', payload.summary.byMechanism)
  section('By register', payload.summary.byRegister)
  section('By first reject rule (after mask)', payload.summary.byFirstRejectRule)
  section('By fixture', payload.summary.byFixture)
  lines.push('## Mechanism taxonomy')
  lines.push('')
  lines.push('1. `fragmented-filled-notehead`')
  lines.push('2. `fragmented-open-notehead`')
  lines.push('3. `ledger-masking-over-subtraction`')
  lines.push('4. `transformed-components-outside-expected-size`')
  lines.push('5. `stem-head-split-no-body-reconstruction`')
  lines.push('6. `stacked-heads-competing-for-fragments`')
  lines.push('7. `notehead-fragments-merged-with-accidental-ink`')
  lines.push('8. `genuinely-absent-usable-ink`')
  lines.push('')
  lines.push('## High-extreme sample')
  lines.push('')
  lines.push('| Fixture | M | Mechanism | First reject | Frags before/after | Heads before→after | Acc |')
  lines.push('|---|---:|---|---|---|---|---:|')
  payload.records
    .filter((r) => r.register === 'high-extreme')
    .slice(0, 40)
    .forEach((r) => {
      lines.push(
        `| ${r.fixture} | ${r.measure} | ${r.mechanism} | ${r.firstRejectRule} | ${r.connectivity?.likelyHeadFragmentsBefore ?? 0}/${r.connectivity?.likelyHeadFragmentsAfter ?? 0} | ${r.connectivity?.headSizedBefore ?? 0}→${r.connectivity?.headSizedAfter ?? 0} | ${r.accidentalCandidatesNearby?.length ?? 0} |`,
      )
    })
  lines.push('')
  lines.push('## Notes for Phase 2')
  lines.push('')
  lines.push(
    '- Fragment clustering should run only after ordinary + ledger-masked ink fail with `no-head-sized-component`.',
  )
  lines.push(
    '- Prefer reconstructing from ≥2 local `likelyHeadFragment` pieces near glyph origin with exclusive ownership.',
  )
  lines.push(
    '- If masking destroys head-sized components, Phase 3 must preserve body pixels under ledger intersections.',
  )
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const { fixtures, roots } = loadFixtures()
  const all = []
  const results = []
  for (const fixture of fixtures) {
    process.stderr.write(`Head-component inventory ${fixture.id}...\n`)
    try {
      const result = await collectFixture(fixture, roots)
      results.push({ id: result.id, ok: result.ok, count: result.count, error: result.error })
      all.push(...(result.records ?? []))
    } catch (error) {
      results.push({ id: fixture.id, ok: false, error: String(error?.stack ?? error) })
    }
  }
  const summary = summarize(all)
  const payload = {
    kind: 'no-head-sized-component-inventory',
    gitCommit: gitCommit(),
    evaluatorVersion: SEMANTIC_EVALUATOR_VERSION,
    schemaVersion: SEMANTIC_EVAL_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    summary,
    results,
    records: all,
  }
  writeFileSync(join(OUT, 'component_inventory.json'), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(OUT, 'PHASE_1_COMPONENT_INVENTORY.md'), `${renderMarkdown(payload)}\n`)
  process.stderr.write(
    `Wrote ${all.length} no-head-sized rejections → tmp/omr-head-components/component_inventory.json\n`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
