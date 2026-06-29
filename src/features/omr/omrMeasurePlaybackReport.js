import { parseMusicXml } from '../musicxml/parseMusicXml.js'
import { OMR_DIVISIONS_PER_QUARTER } from './omrRhythmConstants.js'
import { OMR_DEFAULT_TEMPO } from './omrConstants.js'

function measureTotalDivisions(timeSignature = {}) {
  const beats = timeSignature?.beats ?? 4
  const beatType = timeSignature?.beatType ?? 4
  return Math.round(beats * OMR_DIVISIONS_PER_QUARTER * (4 / beatType))
}

function countXmlTags(measureXml, tag) {
  const re = new RegExp(`<${tag}\\b`, 'g')
  return (measureXml.match(re) ?? []).length
}

function chordGroupsByOnset(noteEvents) {
  const groups = new Map()
  for (const event of noteEvents) {
    const start = event.startDivision ?? 0
    if (!groups.has(start)) {
      groups.set(start, [])
    }
    groups.get(start).push(event)
  }
  return [...groups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([startDivision, events]) => ({
      startDivision,
      eventCount: events.length,
      noteCount: events.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0),
      maxDurationDivisions: Math.max(...events.map((event) => event.durationDivisions ?? 0), 0),
    }))
}

function analyzeRhythmMeasure(measure, timeSignature, baselineTempoBpm) {
  const totalDivisions = measureTotalDivisions(timeSignature)
  const noteEvents = (measure.events ?? []).filter((event) => event.type === 'note')
  const spanEnd = (measure.events ?? []).reduce(
    (max, event) => Math.max(max, (event.startDivision ?? 0) + (event.durationDivisions ?? 0)),
    0,
  )
  const maxDuration = Math.max(...(measure.events ?? []).map((event) => event.durationDivisions ?? 0), 0)
  const groups = chordGroupsByOnset(noteEvents)
  const suspicious = []

  if (spanEnd > totalDivisions + 1) {
    suspicious.push('measure-duration-too-long')
  }
  if (maxDuration > totalDivisions) {
    suspicious.push('single-event-duration-too-long')
  }

  const sequentialSameX = noteEvents.filter((event, index, entries) => {
    if ((event.notes?.length ?? 0) !== 1) {
      return false
    }
    const cx = event.notes[0]?.cx
    if (!Number.isFinite(cx)) {
      return false
    }
    return entries.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.startDivision !== event.startDivision &&
        (other.notes?.length ?? 0) === 1 &&
        Math.abs((other.notes[0]?.cx ?? 0) - cx) <= 12,
    )
  })
  if (sequentialSameX.length >= 2) {
    suspicious.push('sequential-same-x-notes')
  }

  const denseOnsets = groups.filter((group) => group.eventCount > 2 && group.noteCount > group.eventCount)
  if (denseOnsets.length) {
    suspicious.push('fragmented-chord-onset')
  }

  let overlapCount = 0
  for (let left = 0; left < noteEvents.length; left += 1) {
    for (let right = left + 1; right < noteEvents.length; right += 1) {
      const a = noteEvents[left]
      const b = noteEvents[right]
      const aStart = a.startDivision ?? 0
      const bStart = b.startDivision ?? 0
      const aEnd = aStart + (a.durationDivisions ?? 0)
      const bEnd = bStart + (b.durationDivisions ?? 0)
      const overlaps = aStart < bEnd && bStart < aEnd
      const sameClef =
        (a.notes?.[0]?.clef ?? 'treble') === (b.notes?.[0]?.clef ?? 'treble')
      if (overlaps && sameClef && aStart !== bStart) {
        overlapCount += 1
      }
    }
  }
  if (overlapCount > 0) {
    suspicious.push('impossible-same-clef-overlap')
  }

  return {
    measureNumber: measure.measureNumber,
    tempoBpm: baselineTempoBpm,
    totalDurationQuarters: spanEnd / OMR_DIVISIONS_PER_QUARTER,
    expectedDurationQuarters: totalDivisions / OMR_DIVISIONS_PER_QUARTER,
    noteCount: noteEvents.reduce((sum, event) => sum + (event.notes?.length ?? 0), 0),
    eventCount: noteEvents.length,
    chordGroupsByOnset: groups,
    forwardCount: 0,
    backupCount: 0,
    suspicious,
  }
}

function analyzeParsedMeasure(measureNodeXml, timing, measureNumber, baselineTempoBpm) {
  const boundary = timing.measures.find((entry) => entry.number === measureNumber)
  const tempoAtMeasure = (timing.tempoEvents ?? []).filter(
    (event) => event.measureNumber === measureNumber,
  )
  const suspicious = []
  if (
    tempoAtMeasure.some(
      (event) => Math.abs(event.bpm - baselineTempoBpm) >= 24 && baselineTempoBpm > 0,
    )
  ) {
    suspicious.push('tempo-changed-unexpectedly')
  }
  if (boundary && boundary.notatedLengthQuarters > boundary.lengthQuarters * 1.05) {
    suspicious.push('notated-span-exceeds-time-signature')
  }

  return {
    forwardCount: countXmlTags(measureNodeXml, 'forward'),
    backupCount: countXmlTags(measureNodeXml, 'backup'),
    tempoEvents: tempoAtMeasure.map((event) => event.bpm),
    notatedLengthQuarters: boundary?.notatedLengthQuarters ?? null,
    lengthQuarters: boundary?.lengthQuarters ?? null,
    suspicious,
  }
}

function splitMeasuresFromMusicXml(musicXml) {
  const parts = musicXml.match(/<measure\b[\s\S]*?<\/measure>/g) ?? []
  return parts.map((chunk) => {
    const number = Number(chunk.match(/number="(\d+)"/)?.[1])
    return { measureNumber: number, xml: chunk }
  })
}

/**
 * Developer report for experimental OMR playback sanity (pre/post MusicXML).
 */
export function buildOmrMeasurePlaybackReport({
  measures = [],
  musical = {},
  musicXml = null,
} = {}) {
  const baselineTempoBpm = musical?.tempo?.bpm ?? OMR_DEFAULT_TEMPO
  const timeSignature = musical?.timeSignature ?? { beats: 4, beatType: 4 }
  const rhythmReports = measures.map((measure) =>
    analyzeRhythmMeasure(measure, timeSignature, baselineTempoBpm),
  )

  let parsedTiming = null
  if (musicXml) {
    parsedTiming = parseMusicXml(musicXml, 'omr-report.musicxml')
    const xmlMeasures = splitMeasuresFromMusicXml(musicXml)
    for (const report of rhythmReports) {
      const xmlMeasure = xmlMeasures.find((entry) => entry.measureNumber === report.measureNumber)
      if (!xmlMeasure) {
        continue
      }
      const parsed = analyzeParsedMeasure(
        xmlMeasure.xml,
        parsedTiming,
        report.measureNumber,
        baselineTempoBpm,
      )
      report.forwardCount = parsed.forwardCount
      report.backupCount = parsed.backupCount
      report.tempoEvents = parsed.tempoEvents
      report.notatedLengthQuarters = parsed.notatedLengthQuarters
      report.lengthQuarters = parsed.lengthQuarters
      report.suspicious = [...new Set([...report.suspicious, ...parsed.suspicious])]
    }
  }

  const flagged = rhythmReports.filter((report) => report.suspicious.length > 0)
  return {
    baselineTempoBpm,
    timeSignature,
    measures: rhythmReports,
    flaggedMeasures: flagged.map((report) => report.measureNumber),
    firstBadMeasure: flagged[0]?.measureNumber ?? null,
  }
}

export function formatOmrMeasurePlaybackReport(report) {
  const lines = [
    `OMR measure playback report — tempo ${report.baselineTempoBpm} BPM, time ${report.timeSignature?.beats}/${report.timeSignature?.beatType}`,
    `Flagged measures: ${report.flaggedMeasures.length ? report.flaggedMeasures.join(', ') : 'none'}`,
    `First bad measure: ${report.firstBadMeasure ?? 'none'}`,
    '',
  ]

  for (const measure of report.measures) {
    if (!measure.suspicious.length) {
      continue
    }
    lines.push(
      `M${measure.measureNumber}: notes=${measure.noteCount} events=${measure.eventCount} span=${measure.totalDurationQuarters}/${measure.expectedDurationQuarters}q backup=${measure.backupCount} forward=${measure.forwardCount}`,
    )
    lines.push(`  flags: ${measure.suspicious.join(', ')}`)
    if (measure.chordGroupsByOnset?.length) {
      lines.push(
        `  onsets: ${measure.chordGroupsByOnset
          .map(
            (group) =>
              `@${group.startDivision}(${group.noteCount}n/${group.eventCount}ev/${group.maxDurationDivisions}d)`,
          )
          .join(' ')}`,
      )
    }
  }

  return lines.join('\n')
}
