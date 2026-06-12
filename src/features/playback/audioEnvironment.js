/** True for desktop Safari and iOS Safari (not Chrome/Firefox on iOS). */
export function isSafariBrowser() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const ua = navigator.userAgent
  return /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg/i.test(ua)
}
