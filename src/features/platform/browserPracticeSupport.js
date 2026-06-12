import { isSafariBrowser } from '../playback/audioEnvironment.js'

/** Safari (incl. iOS): no built-in MIDI playback transport in this app. */
export function isSafariPlaybackLimited() {
  return isSafariBrowser()
}

export function isIosOrIpadDevice() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/i.test(ua)) {
    return true
  }
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function isTabletLikeDevice() {
  if (typeof window === 'undefined') {
    return false
  }
  if (isIosOrIpadDevice()) {
    return true
  }
  return Boolean(window.matchMedia?.('(pointer: coarse) and (max-width: 1100px)')?.matches)
}

export const BROWSER_SUPPORT_SUMMARY =
  'Chrome or Edge on desktop gives the fullest experience (MIDI playback, Web MIDI, and sound). Safari and tablets work well for reading the score, annotations, measure navigation, and Wait For You with Manual continue.'
