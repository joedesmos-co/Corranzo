/**
 * Reset scroll on the PDF canvas container.
 * Fit-width uses overflow:auto; switching to fit-page leaves a non-zero scrollTop
 * while overflow becomes hidden, which clips the page and looks blank.
 */
export function resetPdfCanvasScroll(element) {
  if (!element) {
    return
  }
  element.scrollTop = 0
  element.scrollLeft = 0
}
