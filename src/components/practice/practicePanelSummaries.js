export function buildSetupSummary(session, scoreFollow) {
  const parts = []

  if (scoreFollow?.hasTiming) {
    if (scoreFollow.semiAutoPreview) {
      parts.push('Review staff systems')
    } else if (scoreFollow.alignmentMode) {
      parts.push('Manual marker correction')
    } else if (scoreFollow.anchors?.length) {
      const marked = scoreFollow.markingProgress?.markedCount ?? scoreFollow.anchors.length
      const total = scoreFollow.markingProgress?.totalMeasures
      parts.push(
        total != null
          ? `${marked}/${total} measures marked`
          : `${marked} measure marker${marked === 1 ? '' : 's'}`,
      )
    } else {
      parts.push('Score cursor not set up')
    }
  }

  if (session.isWaitForYou) {
    parts.push('Note matching')
  }

  return parts.length > 0 ? parts.join(' · ') : 'Score following'
}

export function buildDiagnosticsSummary(session) {
  if (session.timing.isLoading) {
    return 'Loading timing data…'
  }
  if (session.timing.error) {
    return 'Timing error'
  }
  if (session.hasMusicXml && session.hasMidi) {
    return 'Timing & playback'
  }
  if (session.hasMusicXml) {
    return 'Timing details'
  }
  return 'Technical info'
}
