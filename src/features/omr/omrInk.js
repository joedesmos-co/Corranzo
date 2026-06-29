/** Shared ink helpers for local PDF OMR (browser-only, no server). */

export function compositeLuminance(data, index) {
  const alpha = data[index + 3] / 255
  const lum = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  return lum * alpha + 255 * (1 - alpha)
}

export function isInk(data, index, threshold) {
  return compositeLuminance(data, index) < threshold
}

export function contentPixelBounds(imageData, contentBounds) {
  const { width, height } = imageData
  const left = Math.max(0, Math.floor((contentBounds.left ?? contentBounds.x0 * width)))
  const right = Math.min(width - 1, Math.ceil((contentBounds.right ?? contentBounds.x1 * width)))
  const top = Math.max(0, Math.floor((contentBounds.top ?? contentBounds.y0 * height) || 0))
  const bottom = Math.min(height - 1, Math.ceil((contentBounds.bottom ?? contentBounds.y1 * height) || height - 1))
  return { left, right, top, bottom, width, height }
}
