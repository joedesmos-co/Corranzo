import { contentPixelBounds, isInk } from './omrInk.js'
import {
  estimateLedgerLineCount,
  resolvePitchFromGrandStaff,
} from './pitchFromStaffPosition.js'

function staffSpacePx(measureBox, height) {
  const candidates = [
    measureBox?.staffLines?.treble,
    measureBox?.staffLines?.bass,
  ]
  for (const lines of candidates) {
    const ys = [...(lines ?? [])].filter(Number.isFinite).sort((a, b) => a - b)
    if (ys.length < 2) continue
    const gap = ((ys.at(-1) - ys[0]) * height) / (ys.length - 1)
    if (gap >= 3 && gap <= 48) return gap
  }
  return 8
}

function buildInkRuns(imageData, bounds, threshold) {
  const width = bounds.right - bounds.left + 1
  const height = bounds.bottom - bounds.top + 1
  const size = width * height
  const ink = new Uint8Array(size)
  const horizontal = new Uint16Array(size)
  const vertical = new Uint16Array(size)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex =
        ((bounds.top + y) * imageData.width + bounds.left + x) * 4
      ink[y * width + x] = isInk(imageData.data, sourceIndex, threshold) ? 1 : 0
    }
  }
  for (let y = 0; y < height; y += 1) {
    let x = 0
    while (x < width) {
      if (!ink[y * width + x]) {
        x += 1
        continue
      }
      const start = x
      while (x < width && ink[y * width + x]) x += 1
      const length = x - start
      for (let cursor = start; cursor < x; cursor += 1) {
        horizontal[y * width + cursor] = length
      }
    }
  }
  for (let x = 0; x < width; x += 1) {
    let y = 0
    while (y < height) {
      if (!ink[y * width + x]) {
        y += 1
        continue
      }
      const start = y
      while (y < height && ink[y * width + x]) y += 1
      const length = y - start
      for (let cursor = start; cursor < y; cursor += 1) {
        vertical[cursor * width + x] = length
      }
    }
  }
  return { width, height, ink, horizontal, vertical }
}

function coreComponents(runs, bounds, staffSpace) {
  const { width, height, ink, horizontal, vertical } = runs
  const minHorizontal = Math.max(4, Math.round(staffSpace * 0.34))
  const maxHorizontal = Math.max(18, Math.round(staffSpace * 2.6))
  const minVertical = Math.max(2, Math.round(staffSpace * 0.16))
  const core = new Uint8Array(ink.length)
  for (let index = 0; index < ink.length; index += 1) {
    if (
      ink[index] &&
      horizontal[index] >= minHorizontal &&
      horizontal[index] <= maxHorizontal &&
      vertical[index] >= minVertical
    ) {
      core[index] = 1
    }
  }

  const seen = new Uint8Array(core.length)
  const components = []
  for (let seed = 0; seed < core.length; seed += 1) {
    if (!core[seed] || seen[seed]) continue
    const queue = [seed]
    seen[seed] = 1
    let cursor = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    let sumX = 0
    let sumY = 0
    let count = 0
    while (cursor < queue.length) {
      const index = queue[cursor]
      cursor += 1
      const y = Math.floor(index / width)
      const x = index - y * width
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      sumX += x
      sumY += y
      count += 1
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nextX = x + dx
          const nextY = y + dy
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
          const next = nextY * width + nextX
          if (core[next] && !seen[next]) {
            seen[next] = 1
            queue.push(next)
          }
        }
      }
    }
    if (count < Math.max(5, Math.round(staffSpace * 0.3))) continue
    components.push({
      cx: bounds.left + sumX / count,
      cy: bounds.top + sumY / count,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      count,
    })
  }
  return components
}

function componentsToInstances(components, staffSpace) {
  const maxWidth = staffSpace * 1.38
  const full = components
    .filter(
      (component) =>
        component.width >= staffSpace * 0.42 &&
        component.width <= maxWidth &&
        component.height >= staffSpace * 0.42 &&
        component.height <= staffSpace * 0.9,
    )
    .map((component) => ({
      cx: component.cx,
      cy: component.cy,
      componentCount: 1,
      morphologyKind: 'compact-core',
      corePixelCount: component.count,
    }))

  const lobes = components
    .filter(
      (component) =>
        component.width >= staffSpace * 0.42 &&
        component.width <= maxWidth &&
        component.height >= 2 &&
        component.height < staffSpace * 0.42,
    )
    .sort((left, right) => left.cy - right.cy || left.cx - right.cx)
  const used = new Set()
  const paired = []
  for (let index = 0; index < lobes.length; index += 1) {
    if (used.has(index)) continue
    const upper = lobes[index]
    let best = null
    for (let next = index + 1; next < lobes.length; next += 1) {
      if (used.has(next)) continue
      const lower = lobes[next]
      const dy = lower.cy - upper.cy
      if (dy > staffSpace * 0.5) break
      if (
        dy >= staffSpace * 0.18 &&
        Math.abs(lower.cx - upper.cx) <= staffSpace * 0.3
      ) {
        const score = dy + Math.abs(lower.cx - upper.cx) * 0.5
        if (!best || score < best.score) best = { next, lower, score }
      }
    }
    if (!best) continue
    used.add(index)
    used.add(best.next)
    const total = upper.count + best.lower.count
    paired.push({
      cx: (upper.cx * upper.count + best.lower.cx * best.lower.count) / total,
      cy: (upper.cy * upper.count + best.lower.cy * best.lower.count) / total,
      componentCount: 2,
      morphologyKind: 'staff-line-split-core',
      corePixelCount: total,
    })
  }

  const ranked = [...full, ...paired].sort(
    (left, right) =>
      right.componentCount - left.componentCount ||
      right.corePixelCount - left.corePixelCount,
  )
  const kept = []
  for (const instance of ranked) {
    const duplicate = kept.some(
      (entry) =>
        Math.abs(entry.cx - instance.cx) <= staffSpace * 0.28 &&
        Math.abs(entry.cy - instance.cy) <= staffSpace * 0.28,
    )
    if (!duplicate) kept.push(instance)
  }
  return kept.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
}

/**
 * Recover compact notehead bodies by morphology before stem/beam ownership.
 * Thin staff lines and stems fail the two-dimensional core requirement; a
 * staff line crossing a head creates two lobes which are explicitly reunited.
 */
export function detectRasterNoteheadInstances(
  imageData,
  measureBox,
  inkThreshold = 170,
) {
  const staffSpace = staffSpacePx(measureBox, imageData.height)
  const ledgerMargin = (staffSpace * 2.75) / imageData.height
  const bounds = contentPixelBounds(imageData, {
    x0: measureBox.playableX0 ?? measureBox.x0,
    x1: measureBox.x1,
    y0: Math.max(0, measureBox.y0 - ledgerMargin),
    y1: Math.min(1, measureBox.y1 + ledgerMargin),
  })
  const runs = buildInkRuns(imageData, bounds, inkThreshold)
  const components = coreComponents(runs, bounds, staffSpace)
  const instances = componentsToInstances(components, staffSpace)
  const measureWidth = bounds.right - bounds.left + 1
  const rightSafetyMargin = Math.max(3, staffSpace * 0.62)

  return instances.filter(
    (instance) =>
      instance.cx <= bounds.right - rightSafetyMargin &&
      (instance.morphologyKind !== 'compact-core' ||
        instance.corePixelCount >= staffSpace * 3),
  ).map((instance) => {
    const cx = Math.round(instance.cx)
    const cy = Math.round(instance.cy)
    const yNorm = instance.cy / imageData.height
    const pitchMapping = resolvePitchFromGrandStaff(
      yNorm,
      measureBox.staffLines,
      measureBox.staffClefs,
    )
    return {
      midi: pitchMapping.midi,
      clef: pitchMapping.clef,
      cx,
      cy,
      xNorm: instance.cx / imageData.width,
      yNorm,
      ledger: estimateLedgerLineCount(yNorm, pitchMapping.lineYs),
      pitchMapping,
      positionInMeasure: (instance.cx - bounds.left) / Math.max(1, measureWidth),
      measureNumber: measureBox.measureNumber,
      page: measureBox.page,
      confidence: instance.morphologyKind === 'staff-line-split-core' ? 0.78 : 0.82,
      detectionEvidence: {
        source: 'raster-morphology-core',
        morphologyKind: instance.morphologyKind,
        componentCount: instance.componentCount,
        corePixelCount: instance.corePixelCount,
        staffSpace,
      },
    }
  }).filter((note) => note.midi != null)
}

function noteStaffSpacePx(notes, imageHeight) {
  const samples = (notes ?? [])
    .map((note) => {
      const lines = [...(note?.pitchMapping?.lineYs ?? [])].sort((a, b) => a - b)
      return lines.length >= 2
        ? ((lines.at(-1) - lines[0]) * imageHeight) / (lines.length - 1)
        : null
    })
    .filter((value) => Number.isFinite(value) && value >= 3)
  return samples.length
    ? samples.reduce((sum, value) => sum + value, 0) / samples.length
    : 8
}

/**
 * Keep the ordinary detector as the precision pass and label only candidates
 * introduced by the denser sampling pass. Later fusion can then require
 * independent chord-column evidence for those lower-precision observations.
 */
export function mergeRasterDetectionPasses(normalNotes, denseNotes, imageHeight) {
  const normal = normalNotes ?? []
  const staffSpace = noteStaffSpacePx([...normal, ...(denseNotes ?? [])], imageHeight)
  const output = [...normal]
  for (const dense of denseNotes ?? []) {
    const represented = normal.some(
      (note) =>
        note.clef === dense.clef &&
        Math.abs(note.cx - dense.cx) <= staffSpace * 0.45 &&
        Math.abs(note.cy - dense.cy) <= staffSpace * 0.45,
    )
    if (represented) continue
    output.push({
      ...dense,
      detectionEvidence: {
        ...(dense.detectionEvidence ?? {}),
        densePassOnly: true,
      },
    })
  }
  return output.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
}

export function fuseRasterNoteheadInstances(legacyNotes, morphologyNotes, imageHeight) {
  if (!(morphologyNotes?.length > 0)) return legacyNotes ?? []
  const staffSpace = noteStaffSpacePx(morphologyNotes, imageHeight)
  const ordinaryLegacy = (legacyNotes ?? []).filter(
    (note) => !note?.detectionEvidence?.densePassOnly,
  )
  const ordinaryOwnedCount = ordinaryLegacy.filter((legacy) =>
    morphologyNotes.some(
      (instance) =>
        instance.clef === legacy.clef &&
        Math.abs(instance.cx - legacy.cx) <= staffSpace * 0.72 &&
        Math.abs(instance.cy - legacy.cy) <= staffSpace * 0.68,
    ),
  ).length
  // Morphology is corroboration, not permission to erase a coherent precision
  // pass. On clean small-scale engraving a staff line can connect several heads
  // into one component. In that case admit only individually plausible ordinary
  // candidates, rather than returning the entire pass (which could reintroduce
  // stems or accidental fragments). Dense-only observations remain excluded.
  const allowCoherentPrecisionFallback =
    ordinaryLegacy.length >= 3 &&
    ordinaryOwnedCount / ordinaryLegacy.length < 0.5
  const output = [...morphologyNotes]
  for (const legacy of legacyNotes ?? []) {
    const owned = morphologyNotes.some(
      (instance) =>
        instance.clef === legacy.clef &&
        Math.abs(instance.cx - legacy.cx) <= staffSpace * 0.72 &&
        Math.abs(instance.cy - legacy.cy) <= staffSpace * 0.68,
    )
    const evidence = legacy.detectionEvidence ?? {}
    const nearMorphologyChordColumn = morphologyNotes.some(
      (instance) =>
        instance.clef === legacy.clef &&
        Math.abs(instance.cx - legacy.cx) <= staffSpace * 0.48 &&
        Math.abs(instance.cy - legacy.cy) >= staffSpace * 0.55 &&
        Math.abs(instance.cy - legacy.cy) <= staffSpace * 3.2,
    )
    const nearLegacyChordColumn = (legacyNotes ?? []).some((instance) => {
      if (instance === legacy || instance.clef !== legacy.clef) return false
      const instanceEvidence = instance.detectionEvidence ?? {}
      const minimumSeparation =
        evidence.densePassOnly || instanceEvidence.densePassOnly ? 1.5 : 0.55
      return (
        Math.abs(instance.cx - legacy.cx) <= staffSpace * 0.48 &&
        Math.abs(instance.cy - legacy.cy) >= staffSpace * minimumSeparation &&
        Math.abs(instance.cy - legacy.cy) <= staffSpace * 3.2 &&
        Number(instanceEvidence.wideRows ?? 0) >=
          Math.max(7, Math.round(staffSpace * 0.55)) &&
        Number(instanceEvidence.midFill ?? 0) >= 0.27 &&
        Number(instanceEvidence.staffStepResidual ?? Infinity) <= 0.32 &&
        Number(instanceEvidence.verticalRun ?? Infinity) <= staffSpace * 1.25
      )
    })
    const nearCompactLegacyChordBody = (legacyNotes ?? []).some((instance) => {
      if (instance === legacy || instance.clef !== legacy.clef) return false
      const instanceEvidence = instance.detectionEvidence ?? {}
      return (
        Math.abs(instance.cx - legacy.cx) <= staffSpace * 0.48 &&
        // This relaxed mutual-shape path exists for widely stacked ledger
        // chords clipped by the staff box. Closely spaced pairs are commonly
        // two crossbars/posts of one accidental and need morphology evidence.
        Math.abs(instance.cy - legacy.cy) >= staffSpace * 1.5 &&
        Math.abs(instance.cy - legacy.cy) <= staffSpace * 3.2 &&
        Number(instanceEvidence.wideRows ?? 0) >=
          Math.max(4, Math.round(staffSpace * 0.3)) &&
        Number(instanceEvidence.midFill ?? 0) >= 0.3 &&
        Number(instanceEvidence.staffStepResidual ?? Infinity) <= 0.5 &&
        Number(instanceEvidence.verticalRun ?? Infinity) <= staffSpace * 1.25
      )
    })
    const strongRecovery =
      !evidence.densePassOnly &&
      Number(evidence.wideRows ?? 0) >= Math.max(7, Math.round(staffSpace * 0.55)) &&
      Number(evidence.midFill ?? 0) >= 0.3 &&
      Number(evidence.staffStepResidual ?? Infinity) <= 0.22 &&
      Number(evidence.verticalRun ?? Infinity) <= staffSpace * 1.25
    const coherentPrecisionRecovery =
      allowCoherentPrecisionFallback &&
      !evidence.densePassOnly &&
      Number(evidence.wideRows ?? 0) >= Math.max(4, Math.round(staffSpace * 0.3)) &&
      Number(evidence.midFill ?? 0) >= 0.3 &&
      Number(evidence.staffStepResidual ?? Infinity) <= 0.5 &&
      Number(evidence.verticalRun ?? Infinity) <= Math.max(7, staffSpace * 1.35)
    const standardChordToneRecovery =
      (nearMorphologyChordColumn || nearLegacyChordColumn) &&
      Number(evidence.wideRows ?? 0) >= Math.max(7, Math.round(staffSpace * 0.55)) &&
      Number(evidence.midFill ?? 0) >= 0.27 &&
      Number(evidence.staffStepResidual ?? Infinity) <= 0.32 &&
      Number(evidence.verticalRun ?? Infinity) <= staffSpace * 1.25
    const compactChordToneRecovery =
      nearCompactLegacyChordBody &&
      Number(evidence.wideRows ?? 0) >=
        Math.max(4, Math.round(staffSpace * 0.3)) &&
      Number(evidence.midFill ?? 0) >= 0.3 &&
      Number(evidence.staffStepResidual ?? Infinity) <= 0.5 &&
      Number(evidence.verticalRun ?? Infinity) <= staffSpace * 1.25
    const chordToneRecovery = standardChordToneRecovery || compactChordToneRecovery
    if (!owned && (strongRecovery || chordToneRecovery || coherentPrecisionRecovery)) {
      output.push({
        ...legacy,
        detectionEvidence: {
          ...evidence,
          recoveredBy: chordToneRecovery
            ? 'morphology-chord-column-raster-shape'
            : strongRecovery
              ? 'morphology-gap-strong-raster-shape'
              : 'morphology-gap-coherent-precision-pass',
        },
      })
    }
  }
  return output.sort((left, right) => left.cx - right.cx || left.cy - right.cy)
}
