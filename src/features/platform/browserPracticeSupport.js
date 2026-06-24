import { isSafariBrowser } from '../playback/audioEnvironment.js'

let audioCapabilityCache = null

/** Probe Web Audio support without starting the context (no user gesture here). */
export async function probeAudioPlaybackCapability() {
  if (audioCapabilityCache != null) {
    return audioCapabilityCache
  }
  if (typeof window === 'undefined') {
    audioCapabilityCache = false
    return false
  }
  try {
    const tone = await import('tone')
    const state = tone.getContext().state
    // running or suspended both mean playback can unlock on the next tap.
    audioCapabilityCache = state === 'running' || state === 'suspended'
  } catch {
    audioCapabilityCache = false
  }
  return audioCapabilityCache
}

/**
 * Legacy name — no longer blocks transport. Safari/iPad playback is gated on
 * {@link probeAudioPlaybackCapability} and user-gesture unlock instead of UA sniffing.
 */
export function isSafariPlaybackLimited() {
  return false
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

/** True when the browser identifies as Safari (for informational UI only). */
export function isSafariFamilyBrowser() {
  return isSafariBrowser()
}

export const BROWSER_SUPPORT_SUMMARY =
  'Playback and practice features work in Chrome, Edge, and Safari (including iPad) after audio unlock from a tap. Web MIDI is unavailable on Safari; use mic input or Manual continue for Wait For You.'
