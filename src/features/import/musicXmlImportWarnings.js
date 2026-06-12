/**
 * Non-fatal warnings after MusicXML parses successfully.
 * Each item: { id, message }
 */
export function analyzeMusicXmlImport(timingMap) {
  if (!timingMap) {
    return []
  }

  const warnings = []

  if (!timingMap.measures?.length) {
    warnings.push({
      id: 'xml-no-measures',
      message:
        'No measures were found. Loops, position, and Wait For You need measure data — try re-exporting from your notation app.',
    })
    return warnings
  }

  if (!timingMap.noteCount) {
    warnings.push({
      id: 'xml-no-notes',
      message:
        'This file has measures but no playable notes. Beat checkpoints may still work; note matching in Wait For You will not.',
    })
  }

  const partCount = timingMap.parts?.length ?? 0
  if (partCount > 1) {
    warnings.push({
      id: 'xml-multi-part',
      message: `Multiple parts (${partCount}) detected. Timing follows the first part; other staves may not match your PDF.`,
    })
  }

  const tempos = timingMap.tempoChanges ?? []
  const onlyDefaultTempo =
    tempos.length === 1 &&
    Math.abs(tempos[0].bpm - 120) < 0.01 &&
    (tempos[0].quarterTime ?? 0) === 0

  if (onlyDefaultTempo) {
    warnings.push({
      id: 'xml-default-tempo',
      message:
        'No tempo markings were found — timing assumes 120 BPM. Add tempos in your score or export again with tempo directions.',
    })
  }

  const repeatDiagnostics = timingMap.performedMeasureTimeline?.diagnostics
  if (repeatDiagnostics?.hasRepeatMarks && !repeatDiagnostics.usesPerformedTimeline) {
    warnings.push({
      id: 'xml-repeats-not-expanded',
      strength: 'mild',
      message:
        repeatDiagnostics.warning ??
        'Repeat marks were found but could not be expanded. Measure display follows written score order.',
    })
  } else if (repeatDiagnostics?.warning) {
    warnings.push({
      id: 'xml-repeats-partial',
      strength: 'mild',
      message: repeatDiagnostics.warning,
    })
  }

  return warnings
}
