/**
 * Single overlay layer inside PdfPageOverlayStack.
 * Set pointerEvents="auto" to capture input (e.g. alignment clicks).
 */
export default function PdfOverlayLayer({
  id,
  zIndex = 1,
  pointerEvents = 'none',
  className = '',
  children,
}) {
  return (
    <div
      id={id}
      className={`pdf-overlay-layer ${className}`.trim()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        pointerEvents,
      }}
    >
      {children}
    </div>
  )
}
