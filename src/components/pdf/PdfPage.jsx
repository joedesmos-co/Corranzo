import { memo, useEffect } from 'react'
import { Page } from 'react-pdf'

function PdfPage({
  pageNumber,
  width,
  height,
  onPageLoadSuccess,
  onLoadStart,
  onRenderStart,
  onRenderSuccess,
}) {
  useEffect(() => {
    onLoadStart?.()
    onRenderStart?.()
  }, [pageNumber, width, height, onLoadStart, onRenderStart])

  if (!width && !height) {
    return null
  }

  const sizeProps = width ? { width } : { height }

  return (
    <Page
      pageNumber={pageNumber}
      {...sizeProps}
      onLoadSuccess={onPageLoadSuccess}
      onRenderSuccess={onRenderSuccess}
      loading={null}
      renderTextLayer={false}
      renderAnnotationLayer={false}
    />
  )
}

export default memo(
  PdfPage,
  (prev, next) =>
    prev.pageNumber === next.pageNumber &&
    prev.width === next.width &&
    prev.height === next.height,
)
