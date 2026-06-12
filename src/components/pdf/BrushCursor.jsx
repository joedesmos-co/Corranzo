export default function BrushCursor({ visible, x, y, radiusPx, tool }) {
  if (!visible || radiusPx <= 0) {
    return null
  }

  return (
    <div
      className={`brush-cursor brush-cursor--${tool}`}
      style={{
        left: x,
        top: y,
        width: radiusPx * 2,
        height: radiusPx * 2,
      }}
      aria-hidden="true"
    />
  )
}
