/** True when getUserMedia for audio is available. */
export function isMicrophoneSupported() {
  if (typeof navigator === 'undefined') {
    return false
  }
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') {
    return false
  }
  return (
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isMicSafariOrIos() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS/i.test(ua)
  return isSafari || isIosDevice()
}
