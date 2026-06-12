function clamp01(value) {
  return Math.min(0.98, Math.max(0.02, value))
}

/** @deprecated Playhead band removed — cursor uses fixed-size line at x/y only. */
export function buildPlayheadFromAnchor(anchorBefore, anchorAfter, linearProgress = 0) {
  const x =
    anchorBefore.x +
    ((anchorAfter?.x ?? anchorBefore.x) - anchorBefore.x) * linearProgress
  const y = anchorBefore.y

  return {
    x: clamp01(x),
    y: clamp01(y),
  }
}
