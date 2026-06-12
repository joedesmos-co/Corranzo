/**
 * Stable local key for aggregating stats per score.
 */
export function buildPieceIdentity({
  pdfMeta,
  musicXmlSource,
  timingMap,
  isDemoPiece = false,
}) {
  const pdfName = pdfMeta?.fileName ?? ''
  const timingName = musicXmlSource?.fileName ?? timingMap?.fileName ?? ''
  const id =
    pdfName && timingName ? `${pdfName}::${timingName}` : pdfName || timingName || 'unknown-piece'

  let title = timingMap?.title?.trim()
  if (!title && pdfName) {
    title = pdfName.replace(/\.pdf$/i, '').replace(/^Demo — /i, '')
  }
  if (!title) {
    title = isDemoPiece ? 'Minuet in G (sample)' : 'Untitled piece'
  }

  return {
    id,
    title: title.slice(0, 120),
    isDemoPiece: Boolean(isDemoPiece),
  }
}
