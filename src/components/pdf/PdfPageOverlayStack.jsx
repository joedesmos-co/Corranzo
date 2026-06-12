/**
 * Positions overlay layers on top of the rendered PDF page.
 * Each child should be a PdfOverlayLayer (or any element using layout coords).
 */
export default function PdfPageOverlayStack({ layout, children }) {
  if (!layout?.width) {
    return null
  }

  return (
    <div
      className="pdf-overlay-stack"
      style={{
        position: 'absolute',
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  )
}
