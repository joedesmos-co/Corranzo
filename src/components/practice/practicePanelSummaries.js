export function buildSetupSummary(session, scoreFollow) {
  const parts = []

  if (session.hasMusicXml) {
    parts.push(session.loop.hasLoop ? session.loop.region?.label ?? 'Loop set' : 'No loop')
  }

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

  return parts.length > 0 ? parts.join(' · ') : 'Loop, score cursor, tracks'
}

export function buildDiagnosticsSummary(session) {
  if (session.timing.isLoading) {
    return 'Loading timing data…'
  }
  if (session.timing.error) {
    return 'Timing error'
  }
  if (session.hasMusicXml && session.hasMidi) {
    return 'Timing data & file comparison'
  }
  if (session.hasMusicXml) {
    return 'Timing data details'
  }
  return 'Optional technical info'
}
