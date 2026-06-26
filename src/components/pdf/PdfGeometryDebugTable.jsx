/**
 * Dev-only per-page geometry table. Enable with ?debugGeometry=1 in the URL.
 * Shows the authoritative page-display-model values for Library/Practice/Fullscreen
 * so rotation + shared scale can be verified by eye and exported.
 */
function fmt(value) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }
  return Math.round(value)
}

function orientationLabel(width, height) {
  if (!width || !height) {
    return '—'
  }
  return height >= width ? 'P' : 'L'
}

export default function PdfGeometryDebugTable({ report, onCopy }) {
  if (!report?.rows?.length) {
    return null
  }
  const reference = report.referenceDisplaySize

  return (
    <div className="pdf-geometry-debug" role="region" aria-label="Page geometry debug">
      <div className="pdf-geometry-debug__head">
        <strong>Page geometry</strong>
        <span>
          ref {fmt(reference?.correctedWidth)}×{fmt(reference?.correctedHeight)} ·{' '}
          {report.fitMode} · container {fmt(report.containerSize?.width)}×
          {fmt(report.containerSize?.height)}
        </span>
        <button type="button" onClick={() => onCopy?.(report)} className="pdf-geometry-debug__copy">
          Copy JSON
        </button>
      </div>
      <table className="pdf-geometry-debug__table">
        <thead>
          <tr>
            <th>pg</th>
            <th>source</th>
            <th>auto</th>
            <th>man</th>
            <th>view</th>
            <th>corrected</th>
            <th>render</th>
            <th>display</th>
            <th>scale</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.page}>
              <td>{row.page}</td>
              <td>
                {fmt(row.sourceWidth)}×{fmt(row.sourceHeight)} {orientationLabel(row.sourceWidth, row.sourceHeight)}
              </td>
              <td>{row.autoRotation}°</td>
              <td>{row.manualRotation == null ? '—' : `${row.manualRotation}°`}</td>
              <td>{row.viewerRotation}°</td>
              <td>
                {fmt(row.correctedWidth)}×{fmt(row.correctedHeight)}{' '}
                {orientationLabel(row.correctedWidth, row.correctedHeight)}
              </td>
              <td>
                {fmt(row.renderWidth)}×{fmt(row.renderHeight)}
              </td>
              <td>
                {fmt(row.displayWidth)}×{fmt(row.displayHeight)}{' '}
                {orientationLabel(row.displayWidth, row.displayHeight)}
              </td>
              <td>{row.scale == null ? '—' : row.scale.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
