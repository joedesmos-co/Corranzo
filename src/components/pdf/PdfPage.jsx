import { Page } from 'react-pdf'

export default function PdfPage({ pageNumber, width, height, onPageLoadSuccess }) {
  if (!width && !height) {
    return null
  }

  const sizeProps = width ? { width } : { height }

  return (
    <Page
      pageNumber={pageNumber}
      {...sizeProps}
      onLoadSuccess={onPageLoadSuccess}
      renderTextLayer={false}
      renderAnnotationLayer={false}
    />
  )
}
