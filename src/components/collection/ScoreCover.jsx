import { memo, useEffect, useState } from 'react'
import { Document, Page } from 'react-pdf'
import '../../pdf/setupPdfWorker.js'

/** A decorative excerpt with its own cancellable source, never practice state. */
export default memo(function ScoreCover({ file }) {
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!file) return undefined
    const controller = new AbortController()
    // Finish the small preview fetch before PDF.js mounts. Navigating away can
    // abort the fetch without tearing down a PDF worker's active network reader.
    async function load() {
      try {
        const response = await fetch(file, { signal: controller.signal })
        if (!response.ok) throw new Error('Preview unavailable')
        const data = await response.arrayBuffer()
        if (!controller.signal.aborted) setPreview({ file, data })
      } catch {
        if (!controller.signal.aborted) setPreview({ file, data: null })
      }
    }
    load()
    return () => controller.abort()
  }, [file])

  const placeholder = <span className="cz-score-cover__placeholder">Corranzo<br /><em>Score edition</em></span>
  return (
    <div className="cz-score-cover" aria-hidden="true">
      {preview?.file === file && preview.data ? (
        <Document file={preview.data} loading={placeholder} error={placeholder}>
          <Page pageNumber={1} width={420} renderTextLayer={false} renderAnnotationLayer={false} loading={placeholder} />
        </Document>
      ) : placeholder}
    </div>
  )
})
