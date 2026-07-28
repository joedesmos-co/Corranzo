/**
 * Diagnostic: disable PDF page-follow + score cursor RAF during playback to A/B
 * audio smoothness vs visual main-thread pressure.
 *
 * Enable: localStorage['corranzo-playback-visuals-off'] = '1'
 */

const STORAGE_KEY = 'corranzo-playback-visuals-off'

export function isPlaybackVisualsOffEnabled() {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
