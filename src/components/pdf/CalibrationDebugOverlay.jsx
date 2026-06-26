function pct(value) {
  return value * 100
}

/** Colors mirror the CSS so the legend matches what's drawn on the page. */
const CALIBRATION_LEGEND = [
  { key: 'system', label: 'System bounds', className: 'calibration-debug-overlay__legend-swatch--system' },
  { key: 'low', label: 'Low-confidence system', className: 'calibration-debug-overlay__legend-swatch--low' },
  { key: 'ink', label: 'Ink extent', className: 'calibration-debug-overlay__legend-swatch--ink' },
  { key: 'center', label: 'System center', className: 'calibration-debug-overlay__legend-swatch--center' },
  { key: 'anchor', label: 'Measure anchor', className: 'calibration-debug-overlay__legend-swatch--anchor' },
]

export default function CalibrationDebugOverlay({ layout, visible = false }) {
  if (!visible || !layout) {
    return null
  }

  return (
    <div className="calibration-debug-overlay-root" aria-hidden="true">
      <svg
        className="calibration-debug-overlay"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
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
            <circle className="calibration-debug-overlay__anchor-dot" r="0.45" />
            <text className="calibration-debug-overlay__anchor-label" x="0.9" y="0.3">
              m{anchor.measureNumber}
            </text>
          </g>
        ))}
      </svg>

      <ul className="calibration-debug-overlay__legend">
        {CALIBRATION_LEGEND.map((entry) => (
          <li key={entry.key} className="calibration-debug-overlay__legend-item">
            <span className={`calibration-debug-overlay__legend-swatch ${entry.className}`} />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
