import { isPdfBufferAttached } from '../omr/omrPdfSource.js'

export function describePdfPracticeSource({ pdfFile, pdfBuffer }) {
  let bufferAttached = null
  let bufferByteLength = 0
  if (pdfBuffer instanceof ArrayBuffer) {
    bufferAttached = isPdfBufferAttached(pdfBuffer)
    if (bufferAttached) {
      bufferByteLength = pdfBuffer.byteLength
    }
  }
  return {
    hasPdfFileUrl: typeof pdfFile === 'string' && pdfFile.length > 0,
    bufferAttached,
    bufferByteLength,
    type: typeof pdfFile === 'string' ? 'blob-url' : pdfFile == null ? 'null' : typeof pdfFile,
  }
}

export function isPdfPracticeSourceReady({ pdfFile, pdfBuffer = null }) {
  if (typeof pdfFile !== 'string' || pdfFile.length === 0) {
    return false
  }
  if (pdfBuffer instanceof ArrayBuffer && isPdfBufferAttached(pdfBuffer) && pdfBuffer.byteLength > 0) {
    return true
  }
  return true
}

/**
 * Re-fetch PDF bytes from a blob URL and return fresh owned buffer + URL for react-pdf.
 */
export async function refreshOwnedPdfFromBlobUrl(pdfFileUrl, { revokePrevious = true } = {}) {
  if (typeof pdfFileUrl !== 'string' || pdfFileUrl.length === 0) {
    throw new Error('PDF preview URL is missing.')
  }

  const response = await fetch(pdfFileUrl)
  if (!response.ok) {
    throw new Error(`PDF preview unavailable (${response.status}).`)
  }

  const bytes = await response.arrayBuffer()
  if (!bytes.byteLength) {
    throw new Error('PDF preview is empty.')
  }

  const pdfBuffer = bytes.slice(0)
  const pdfFile = URL.createObjectURL(new Blob([pdfBuffer], { type: 'application/pdf' }))

  if (revokePrevious && pdfFileUrl.startsWith('blob:') && pdfFileUrl !== pdfFile) {
    URL.revokeObjectURL(pdfFileUrl)
  }

  return { pdfBuffer, pdfFile, byteLength: pdfBuffer.byteLength }
}
