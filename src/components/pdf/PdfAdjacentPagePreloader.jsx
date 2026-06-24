import { Page } from 'react-pdf'

/**
 * Warm the react-pdf cache for adjacent pages without showing them.
 * Renders off-screen inside the same Document as the visible page.
 */
export default function PdfAdjacentPagePreloader({ pageNumber, numPages, width, height }) {
  if ((!width && !height) || !numPages) {
    return null
  }

  const sizeProps = width ? { width } : { height }
  const adjacent = []
  if (pageNumber > 1) {
    adjacent.push(pageNumber - 1)
  }
  if (pageNumber < numPages) {
    adjacent.push(pageNumber + 1)
  }

  if (adjacent.length === 0) {
    return null
  }

  return adjacent.map((adjacentPage) => (
    <div key={adjacentPage} className="pdf-page-preload" aria-hidden="true">
      <Page
        pageNumber={adjacentPage}
        {...sizeProps}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        loading={null}
      />
    </div>
  ))
}
