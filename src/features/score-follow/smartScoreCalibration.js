import { createAnchorId } from './scoreFollowStorage.js'
import { ANCHOR_SOURCE } from './anchorUtils.js'
import { collectMeasureDefaultXHints } from './musicxmlLayoutAnchors.js'
import { detectSystemBarlinePositions } from './detectStaffLines.js'
import {
  detectSystemInkBounds,
  systemStartAnchorPosition,
  systemEndAnchorPosition,
} from './detectStaffSystems.js'

/**
 * Smart Score Calibration 2.0 — multi-strategy measure alignment.
 *
 * The original pipeline maps every system onto ONE global page content-bound and
 * the MusicXML's proportional measure widths. That works for clean, centered,
 * single-publisher exports but mis-places music that is offset to one side, has
 * uneven per-system margins, a wide title block, cropped edges, or non-standard
 * spacing (the Carol-of-the-Bells failure mode).
 *
 * Instead of one algorithm, this runs SEVERAL strategies over the SAME detected
 * geometry, scores each against the detected barlines / per-system ink, and keeps
 * the highest-confidence result — falling back to the original (Strategy A) only
 * when nothing beats it. Each strategy is pure and works on measured geometry, so
 * it is fully unit-testable without rendering a PDF.
 *
 * Strategies:
 *   A — current: global content bounds + barlines + engraved widths (baseline).
 *   B — margin-normalized: each system anchored to ITS OWN ink extent.
 *   C — offset-compensated: detected barlines first (offset-immune), ink fallback.
 *   D — adaptive scaling: learn a detected-width/music-width scale and apply it to
 *       systems whose right edge is ambiguous (cropped / sparse).
 *   E — publisher-independent spacing: ignore engraved widths, even distribution.
 */

export const CALIBRATION_STRATEGY = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
}

export const CALIBRATION_STRATEGY_LABEL = {
  A: 'Baseline (content + barlines)',
  B: 'Margin-normalized',
  C: 'Offset-compensated',
  D: 'Adaptive scaling',
  E: 'Publisher-independent spacing',
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const sum = (arr) => arr.reduce((a, b) => a + b, 0)
function median(values) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
function nearestDistance(x, sortedXs) {
  let best = Infinity
  for (const v of sortedXs) {
    const d = Math.abs(v - x)
    if (d < best) best = d
  }
  return best
}

/**
 * Build the per-system geometry the strategies consume. Uses the real detectors
 * (barlines + per-system ink). Pure inputs (systemEntries/spans/timingMap), no
 * extra PDF rendering — reuses the imageData already captured by auto-setup.
 */
export function buildCalibrationGeometry(systemEntries, spans, timingMap) {
  const widthByMeasure = new Map((timingMap?.measures ?? []).map((m) => [m.number, m.engravedWidth]))
  const systems = []

  spans.forEach((span, index) => {
    const entry = systemEntries[index]
    const measureNumbers = span?.measureNumbers
    if (!entry || !measureNumbers?.length) return

    const startPos = systemStartAnchorPosition(entry.system, entry.contentBounds)
    const endPos = systemEndAnchorPosition(entry.system, entry.contentBounds)
    const barlineThreshold = Math.max(150, (entry.inkThreshold ?? 170) - 20)
    const barlines = entry.imageData
      ? detectSystemBarlinePositions(entry.imageData, entry.contentBounds, entry.system, {
          darkThreshold: barlineThreshold,
        })
      : []
    const ink = entry.imageData
      ? detectSystemInkBounds(entry.imageData, entry.contentBounds, entry.system)
      : { inkLeft: entry.contentBounds?.x0 ?? 0, inkRight: entry.contentBounds?.x1 ?? 1, found: false }

    const widths = measureNumbers.map((m) => {
      const w = widthByMeasure.get(m)
      return Number.isFinite(w) && w > 0 ? w : 1
    })
    const haveWidths = measureNumbers.some((m) => Number.isFinite(widthByMeasure.get(m)))

    systems.push({
      index,
      page: entry.page,
      y: startPos.y,
      y0: entry.system?.y0 ?? null,
      y1: entry.system?.y1 ?? null,
      pageWidthPx: entry.imageData?.width ?? null,
      contentLeft: startPos.x,
      contentRight: endPos.x,
      contentBoundsX0: entry.contentBounds?.x0 ?? 0,
      contentBoundsX1: entry.contentBounds?.x1 ?? 1,
      inkLeft: ink.inkLeft,
      inkRight: ink.inkRight,
      inkFound: ink.found,
      barlines: [...barlines].sort((a, b) => a - b),
      measureNumbers,
      widths,
      haveWidths,
      count: measureNumbers.length,
    })
  })

  return { systems, defaultXByMeasure: collectMeasureDefaultXHints(timingMap) }
}

function barlinesMatchCount(barlines, count) {
  return (
    barlines.length === count + 1 &&
    barlines.every((x, i) => i === 0 || x > barlines[i - 1])
  )
}

/** Measure boundary x positions (count+1) within [leftX,rightX] for one system. */
function computeBoundaries(system, leftX, rightX, { even = false } = {}) {
  const { barlines, count, widths } = system
  if (barlines.length >= 2 && barlinesMatchCount(barlines, count)) {
    return barlines
  }
  if (even || !system.haveWidths) {
    return Array.from({ length: count + 1 }, (_, i) => leftX + (i / count) * (rightX - leftX))
  }
  const total = sum(widths) || count
  let acc = 0
  const lefts = []
  for (const w of widths) {
    lefts.push(acc)
    acc += w
  }
  const tenthsToX = (t) => leftX + (t / total) * (rightX - leftX)
  return lefts.map((t) => tenthsToX(t)).concat(rightX)
}

/** Span [leftX,rightX] + boundaries for one system under a given strategy. */
function systemResultForStrategy(system, strategy, adaptiveScale) {
  const { barlines, count, inkFound, inkLeft, inkRight, contentLeft, contentRight, widths } = system
  const haveBarlineSpan = barlines.length >= 2 && barlines[barlines.length - 1] > barlines[0]
  let leftX
  let rightX
  let even = false

  if (strategy === CALIBRATION_STRATEGY.A) {
    if (haveBarlineSpan) {
      leftX = barlines[0]
      rightX = barlines[barlines.length - 1]
    } else {
      leftX = contentLeft
      rightX = contentRight
    }
  } else if (strategy === CALIBRATION_STRATEGY.B) {
    // Margin-normalized: the system's own ink (handles offset / uneven margins).
    leftX = inkFound ? inkLeft : contentLeft
    rightX = inkFound ? inkRight : contentRight
  } else if (strategy === CALIBRATION_STRATEGY.C) {
    // Offset-compensated: barlines are immune to where the system sits on the page.
    if (haveBarlineSpan) {
      leftX = barlines[0]
      rightX = barlines[barlines.length - 1]
    } else if (inkFound) {
      leftX = inkLeft
      rightX = inkRight
    } else {
      leftX = contentLeft
      rightX = contentRight
    }
  } else if (strategy === CALIBRATION_STRATEGY.D) {
    // Adaptive scaling: anchor the left edge to real geometry and size the system
    // from the learned scale when its own right edge is unreliable (cropped/sparse).
    leftX = haveBarlineSpan ? barlines[0] : inkFound ? inkLeft : contentLeft
    if (haveBarlineSpan) {
      rightX = barlines[barlines.length - 1]
    } else if (adaptiveScale > 0) {
      rightX = leftX + adaptiveScale * (sum(widths) || count)
    } else {
      rightX = inkFound ? inkRight : contentRight
    }
  } else {
    // E — publisher-independent spacing: ignore engraved widths entirely.
    if (haveBarlineSpan) {
      leftX = barlines[0]
      rightX = barlines[barlines.length - 1]
    } else if (inkFound) {
      leftX = inkLeft
      rightX = inkRight
    } else {
      leftX = contentLeft
      rightX = contentRight
    }
    even = true
  }

  if (!(rightX > leftX)) {
    rightX = leftX + 0.001
  }
  return { leftX, rightX, boundaries: computeBoundaries(system, leftX, rightX, { even }) }
}

/** detected-width / music-width scale, learned from systems with confident barlines. */
function learnAdaptiveScale(systems) {
  const ratios = []
  for (const s of systems) {
    if (s.barlines.length >= 2 && s.barlines[s.barlines.length - 1] > s.barlines[0]) {
      const musicWidth = sum(s.widths) || s.count
      if (musicWidth > 0) {
        ratios.push((s.barlines[s.barlines.length - 1] - s.barlines[0]) / musicWidth)
      }
    }
  }
  return ratios.length ? median(ratios) : 0
}

/** Build per-measure anchors for one system from its boundaries (default-x leads). */
function buildSystemAnchors(system, result, defaultXByMeasure) {
  const { measureNumbers, widths, haveWidths, count, page, y, index } = system
  const { boundaries, rightX } = result
  const kindHasBarlines = system.barlines.length >= 2 && barlinesMatchCount(system.barlines, count)
  const anchors = []

  measureNumbers.forEach((measureNumber, i) => {
    const measureStartX = boundaries[i]
    const measureEndX = boundaries[i + 1]
    const measureSpan = Math.max(0, measureEndX - measureStartX)
    const dx = defaultXByMeasure.get(measureNumber)
    let playableStartX
    let xSource
    if (haveWidths && Number.isFinite(dx)) {
      const offset = Math.min(Math.max(dx, 0), 0.85 * widths[i])
      const offsetFrac = widths[i] > 0 ? offset / widths[i] : 0
      playableStartX = measureStartX + offsetFrac * measureSpan
      xSource = kindHasBarlines ? 'default-x+barline' : 'default-x'
    } else if (i === 0 && haveWidths && count > 1) {
      const otherWidths = widths.filter((_, j) => j !== i)
      const med = median(otherWidths)
      const clefKeyLeadTenths = Math.min(Math.max(widths[i] - med, 0.12 * widths[i]), 0.6 * widths[i])
      const leadFrac = widths[i] > 0 ? clefKeyLeadTenths / widths[i] : 0.3
      playableStartX = measureStartX + leadFrac * measureSpan
      xSource = 'system-start-width'
    } else {
      const lead = i === 0 ? 0.3 : 0.05
      playableStartX = measureStartX + lead * measureSpan
      xSource = 'estimated'
    }

    anchors.push({
      id: createAnchorId(),
      page,
      x: playableStartX,
      y,
      measureNumber,
      source: ANCHOR_SOURCE.AUTO_MEASURE,
      meta: {
        role: 'measure',
        systemIndex: index,
        measuresInSpan: count,
        indexInSystem: i,
        lastInSystem: i === count - 1,
        measureStartX,
        playableStartX,
        playableEndX: measureEndX,
        systemEndX: rightX,
        xSource,
        calibrationStrategy: 'smart',
      },
    })
  })
  return anchors
}

export function buildStrategyAnchors(geometry, strategy) {
  const adaptiveScale = strategy === CALIBRATION_STRATEGY.D ? learnAdaptiveScale(geometry.systems) : 0
  const anchors = []
  for (const system of geometry.systems) {
    const result = systemResultForStrategy(system, strategy, adaptiveScale)
    anchors.push(...buildSystemAnchors(system, result, geometry.defaultXByMeasure))
  }
  return anchors.sort((a, b) => a.measureNumber - b.measureNumber)
}

/**
 * Score one system's measure boundaries against the detected geometry. Returns a
 * confidence in [0,1]: high when boundaries land on detected barlines and stay
 * within the system's ink; medium when there is no barline ground truth but the
 * span covers the ink cleanly; zero when boundaries go backward or off the page.
 */
export function scoreSystemBoundaries(boundaries, system) {
  const count = system.count
  if (count < 1 || boundaries.length < 2) return 0
  for (let i = 1; i < boundaries.length; i += 1) {
    if (boundaries[i] <= boundaries[i - 1] - 1e-6) return 0 // non-monotonic
  }
  const leftX = boundaries[0]
  const rightX = boundaries[boundaries.length - 1]
  const lo = system.contentBoundsX0 - 0.04
  const hi = system.contentBoundsX1 + 0.04
  const outOfBounds = leftX < lo || rightX > hi

  let confidence
  const { barlines } = system
  if (barlines.length >= 2 && barlines[barlines.length - 1] > barlines[0]) {
    const meanMeasure = Math.max((rightX - leftX) / count, 1e-4)
    const internal = boundaries.slice(1, -1)
    const resid = internal.length
      ? sum(internal.map((b) => nearestDistance(b, barlines))) / internal.length / meanMeasure
      : 0
    const endResid =
      (Math.abs(leftX - barlines[0]) + Math.abs(rightX - barlines[barlines.length - 1])) /
      2 /
      meanMeasure
    confidence = clamp01(1 - 0.6 * resid - 0.4 * endResid)
  } else if (system.inkFound) {
    const span = rightX - leftX
    const inkSpan = Math.max(system.inkRight - system.inkLeft, 1e-4)
    const coverage = clamp01(span / inkSpan)
    const spill = Math.max(0, system.inkLeft - leftX) + Math.max(0, rightX - system.inkRight)
    confidence = clamp01(0.45 + 0.2 * coverage - spill * 4)
  } else {
    confidence = 0.35
  }

  if (outOfBounds) confidence *= 0.4
  return confidence
}

/** Score a full anchor set by grouping anchors back into per-system boundaries. */
export function scoreAnchorSet(anchors, geometry) {
  const bySystem = new Map()
  for (const a of anchors) {
    const idx = a.meta?.systemIndex
    if (idx == null) continue
    if (!bySystem.has(idx)) bySystem.set(idx, [])
    bySystem.get(idx).push(a)
  }

  const perSystem = []
  let weightedSum = 0
  let weightTotal = 0
  const perPage = new Map()

  for (const system of geometry.systems) {
    const group = (bySystem.get(system.index) ?? []).sort(
      (a, b) => a.meta.indexInSystem - b.meta.indexInSystem,
    )
    if (!group.length) {
      perSystem.push({ index: system.index, page: system.page, confidence: 0 })
      continue
    }
    const boundaries = group
      .map((a) => a.meta.measureStartX)
      .concat(group[group.length - 1].meta.playableEndX)
    const confidence = scoreSystemBoundaries(boundaries, system)
    perSystem.push({ index: system.index, page: system.page, confidence })
    weightedSum += confidence * system.count
    weightTotal += system.count
    const arr = perPage.get(system.page) ?? []
    arr.push(confidence)
    perPage.set(system.page, arr)
  }

  const overall = weightTotal > 0 ? weightedSum / weightTotal : 0
  const pages = [...perPage.entries()]
    .map(([page, vals]) => ({ page, confidence: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.page - b.page)

  return { overall, perPage: pages, perSystem }
}

/** Geometry-only page analysis (margins/offset/scale/skew) — no OCR. */
export function analyzePageLayout(geometry) {
  const byPage = new Map()
  for (const s of geometry.systems) {
    const arr = byPage.get(s.page) ?? []
    arr.push(s)
    byPage.set(s.page, arr)
  }
  const pages = [...byPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, systems]) => {
      const left = Math.min(...systems.map((s) => (s.inkFound ? s.inkLeft : s.contentBoundsX0)))
      const right = Math.max(...systems.map((s) => (s.inkFound ? s.inkRight : s.contentBoundsX1)))
      const top = Math.min(...systems.map((s) => s.y0 ?? 0))
      const bottom = Math.max(...systems.map((s) => s.y1 ?? 1))
      const widthPx = systems.find((s) => s.pageWidthPx)?.pageWidthPx ?? null
      const offset = (left + right) / 2 - 0.5
      const contentWidth = Math.max(0, right - left)
      // Skew estimate: linear trend of per-system left ink vs vertical position.
      const ys = systems.map((s) => (s.y0 != null && s.y1 != null ? (s.y0 + s.y1) / 2 : s.y))
      const xs = systems.map((s) => (s.inkFound ? s.inkLeft : s.contentBoundsX0))
      let skewDeg = 0
      if (systems.length >= 3) {
        const my = median(ys)
        const mx = median(xs)
        let cov = 0
        let varY = 0
        for (let i = 0; i < systems.length; i += 1) {
          cov += (ys[i] - my) * (xs[i] - mx)
          varY += (ys[i] - my) ** 2
        }
        const slope = varY > 1e-9 ? cov / varY : 0
        skewDeg = (Math.atan(slope) * 180) / Math.PI
      }
      return {
        page,
        leftMargin: left,
        rightMargin: Math.max(0, 1 - right),
        topMargin: top,
        bottomMargin: Math.max(0, 1 - bottom),
        whitespaceRatio: clamp01(1 - contentWidth),
        offsetNormalized: offset,
        offsetPx: widthPx != null ? Math.round(offset * widthPx) : null,
        contentScale: clamp01(contentWidth),
        rotationDeg: Math.round(skewDeg * 100) / 100,
        cropped: left < 0.02 || right > 0.98,
        systemCount: systems.length,
      }
    })
  return pages
}

/**
 * Score every strategy and pick the best. A (the baseline) wins on a (near-)tie,
 * so clean scores never regress and we only adopt a different strategy when it is
 * meaningfully more confident. Pure — operates on geometry + baseline anchors.
 */
export function selectCalibration(geometry, baselineAnchors) {
  const candidates = [
    {
      strategy: CALIBRATION_STRATEGY.A,
      anchors: baselineAnchors ?? buildStrategyAnchors(geometry, CALIBRATION_STRATEGY.A),
    },
  ]
  for (const strategy of [
    CALIBRATION_STRATEGY.B,
    CALIBRATION_STRATEGY.C,
    CALIBRATION_STRATEGY.D,
    CALIBRATION_STRATEGY.E,
  ]) {
    candidates.push({ strategy, anchors: buildStrategyAnchors(geometry, strategy) })
  }

  const scored = candidates.map((c) => ({ ...c, score: scoreAnchorSet(c.anchors, geometry) }))
  const TIE = 0.005
  const baseline = scored.find((s) => s.strategy === CALIBRATION_STRATEGY.A)
  let best = baseline
  for (const candidate of scored) {
    if (candidate.score.overall > best.score.overall + TIE) {
      best = candidate
    }
  }
  return { best, baseline, scored }
}

/**
 * Run all strategies, score them, and return the highest-confidence anchors.
 * `baselineAnchors` is Strategy A (the existing buildPerMeasureSystemAnchors
 * output), passed in to avoid a circular import and to guarantee A is byte-exact.
 */
export function calibrateScoreAnchors({ systemEntries, spans, timingMap, baselineAnchors }) {
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const geometry = buildCalibrationGeometry(systemEntries, spans, timingMap)

  if (!geometry.systems.length) {
    return {
      anchors: baselineAnchors ?? [],
      report: { active: false, reason: 'no-systems', chosenStrategy: CALIBRATION_STRATEGY.A },
    }
  }

  const { best, baseline, scored } = selectCalibration(geometry, baselineAnchors)
  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime
  const pageLayout = analyzePageLayout(geometry)

  return {
    anchors: best.anchors,
    report: {
      active: true,
      chosenStrategy: best.strategy,
      chosenStrategyLabel: CALIBRATION_STRATEGY_LABEL[best.strategy],
      overallConfidence: best.score.overall,
      perPageConfidence: best.score.perPage,
      perSystemConfidence: best.score.perSystem,
      baselineConfidence: baseline.score.overall,
      improvedOverBaseline: best.strategy !== CALIBRATION_STRATEGY.A,
      strategyScores: scored.map((s) => ({
        strategy: s.strategy,
        label: CALIBRATION_STRATEGY_LABEL[s.strategy],
        overall: s.score.overall,
      })),
      pageLayout,
      systemCount: geometry.systems.length,
      calibrationMs: Math.round(elapsedMs * 10) / 10,
    },
  }
}
