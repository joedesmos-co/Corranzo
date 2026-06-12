import { ANCHOR_SOURCE, isAutomaticAnchorSource, isManualAnchorSource } from './anchorUtils.js'
import { filterTrustedAnchors } from './trustedAnchors.js'
import { assessMusicXmlLayoutConfidence } from './musicxmlLayoutAnchors.js'

export const FOLLOW_TRUST_LEVEL = {
  CALIBRATED: 'calibrated',
  MANUAL: 'manual',
  LAYOUT: 'layout',
  NONE: 'none',
}

/**
 * Whether score-follow should render a playback cursor (vs. setup prompt only).
 */
export function assessScoreFollowTrust({ anchors, timingMap, isDemoSession = false }) {
  if (!anchors?.length || !timingMap?.measures?.length) {
    return {
      level: FOLLOW_TRUST_LEVEL.NONE,
      showCursor: false,
      needsSetup: true,
      approximate: false,
      label: null,
    }
  }

  const trusted = filterTrustedAnchors(anchors)
  const demoCount = trusted.filter((anchor) => anchor.source === ANCHOR_SOURCE.DEMO).length
  const manualCount = trusted.filter((anchor) => isManualAnchorSource(anchor.source)).length
  const layoutCount = trusted.filter(
    (anchor) => anchor.source === ANCHOR_SOURCE.MUSICXML_LAYOUT,
  ).length
  const autoCount = anchors.filter((anchor) => isAutomaticAnchorSource(anchor.source)).length

  if (autoCount > 0 && demoCount === 0 && manualCount === 0 && layoutCount === 0) {
    return {
      level: FOLLOW_TRUST_LEVEL.NONE,
      showCursor: false,
      needsSetup: true,
      approximate: false,
      label: null,
    }
  }

  if (isDemoSession && demoCount >= 1) {
    return {
      level: FOLLOW_TRUST_LEVEL.CALIBRATED,
      showCursor: true,
      needsSetup: false,
      approximate: false,
      label: null,
    }
  }

  if (manualCount >= 1) {
    return {
      level: FOLLOW_TRUST_LEVEL.MANUAL,
      showCursor: true,
      needsSetup: false,
      approximate: true,
      label: 'Approximate — manual markers',
    }
  }

  const layoutAssessment = assessMusicXmlLayoutConfidence(timingMap)
  if (layoutCount >= 2 && layoutAssessment.ok) {
    return {
      level: FOLLOW_TRUST_LEVEL.LAYOUT,
      showCursor: true,
      needsSetup: false,
      approximate: true,
      label: 'Approximate — MusicXML layout',
    }
  }

  return {
    level: FOLLOW_TRUST_LEVEL.NONE,
    showCursor: false,
    needsSetup: true,
    approximate: false,
    label: null,
  }
}
