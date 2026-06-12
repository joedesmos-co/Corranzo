/**
 * Duration-weighted measure x positions within a staff-system band.
 * Used for bundled demo anchors and other high-confidence timing-only layouts.
 */

function measurePlaybackDuration(measure) {
  const start = measure.startTimeSeconds ?? 0
  const end = measure.endTimeSeconds ?? start
  return Math.max(0.001, end - start)
}

/**
 * @param {object[]} measuresInBand — timingMap.measures filtered to one system
 * @param {{ xStart: number, xEnd: number, page: number, y: number, yEnd?: number, source: string, meta?: object, systemIndex?: number }} band
 */
export function buildDurationWeightedMeasureAnchors(measuresInBand, band) {
  if (!measuresInBand.length) {
    return []
  }

  const totalDuration = measuresInBand.reduce(
    (sum, measure) => sum + measurePlaybackDuration(measure),
    0,
  )
  const yEnd = band.yEnd ?? band.y + 0.03
  let cumulative = 0
  const anchors = []

  for (const measure of measuresInBand) {
    const duration = measurePlaybackDuration(measure)
    const t = totalDuration > 0 ? cumulative / totalDuration : 0
    cumulative += duration
    const x = band.xStart + (band.xEnd - band.xStart) * t
    const y = band.y + (yEnd - band.y) * Math.min(1, t * 0.15)

    anchors.push({
      page: band.page,
      x,
      y,
      measureNumber: measure.number,
      source: band.source,
      meta: {
        role: 'measure',
        density: 'duration-weighted',
        systemIndex: band.systemIndex,
        ...band.meta,
      },
    })
  }

  return anchors
}

/**
 * Build measure anchors for each entry in systemBands using timingMap measure durations.
 *
 * @param {import('../musicxml/parseMusicXml.js').TimingMap} timingMap
 * @param {Array<{ page: number, y: number, yEnd?: number, measureStart: number, measureEnd: number, xStart?: number, xEnd?: number, systemIndex?: number }>} systemBands
 */
export function buildTimingMeasureAnchorsForBands(timingMap, systemBands, { source, meta = {} } = {}) {
  if (!timingMap?.measures?.length || !systemBands?.length || !source) {
    return []
  }

  const anchors = []
  const xStartDefault = 0.1
  const xEndDefault = 0.88

  for (const [index, band] of systemBands.entries()) {
    const measuresInBand = timingMap.measures.filter(
      (measure) =>
        measure.number >= band.measureStart && measure.number <= band.measureEnd,
    )
    if (!measuresInBand.length) {
      continue
    }

    anchors.push(
      ...buildDurationWeightedMeasureAnchors(measuresInBand, {
        page: band.page ?? 1,
        y: band.y,
        yEnd: band.yEnd,
        xStart: band.xStart ?? xStartDefault,
        xEnd: band.xEnd ?? xEndDefault,
        source,
        systemIndex: band.systemIndex ?? index,
        meta,
      }),
    )
  }

  return anchors.sort((left, right) => left.measureNumber - right.measureNumber)
}
