function pct(value) {
  return value * 100
}

function formatConfidence(value) {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return `${Math.round(value * 100)}%`
}

export default function CalibrationDebugOverlay({ layout, visible = false }) {
  if (!visible || !layout) {
    return null
  }

  return (
    <svg
      className="calibration-debug-overlay"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      pointerEvents="none"
    >
      {layout.systems.map((system) => (
        <g key={`system-${system.index}`} className="calibration-debug-overlay__system">
          {system.bounds && (
            <rect
              className={`calibration-debug-overlay__system-bounds${
                system.lowConfidence ? ' calibration-debug-overlay__system-bounds--low' : ''
              }`}
              x={pct(system.bounds.left)}
              y={pct(system.bounds.top)}
              width={pct(system.bounds.right - system.bounds.left)}
              height={pct(system.bounds.bottom - system.bounds.top)}
            />
          )}
          {system.inkBounds && (
            <rect
              className="calibration-debug-overlay__ink-bounds"
              x={pct(system.inkBounds.left)}
              y={pct(system.inkBounds.top)}
              width={pct(system.inkBounds.right - system.inkBounds.left)}
              height={pct(system.inkBounds.bottom - system.inkBounds.top)}
            />
          )}
          {Number.isFinite(system.centerY) && (
            <line
              className="calibration-debug-overlay__center-line"
              x1="0"
              x2="100"
              y1={pct(system.centerY)}
              y2={pct(system.centerY)}
            />
          )}
        </g>
      ))}

      {layout.anchors.map((anchor, index) => (
        <g
          key={`anchor-${anchor.measureNumber}-${index}`}
          className="calibration-debug-overlay__anchor"
          transform={`translate(${anchor.x * 100} ${anchor.y * 100})`}
        >
          <circle className="calibration-debug-overlay__anchor-dot" r="0.9" />
          <text className="calibration-debug-overlay__anchor-label" x="1.4" y="0.45">
            m{anchor.measureNumber}
          </text>
        </g>
      ))}
    </svg>
  )
}
