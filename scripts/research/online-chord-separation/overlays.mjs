/**
 * Debug overlay rendering for Spike 6.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function loadCreateCanvas(rootDir) {
  const mod = await import(join(rootDir, 'node_modules/@napi-rs/canvas/index.js'))
  return mod.createCanvas
}

function drawCross(ctx, x, y, color, size = 4) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - size, y)
  ctx.lineTo(x + size, y)
  ctx.moveTo(x, y - size)
  ctx.lineTo(x, y + size)
  ctx.stroke()
}

/**
 * Write a multi-panel PNG: original, staff lines, candidates, proposed centers.
 */
export async function writeOverlayPng({
  createCanvas,
  outPath,
  imageData,
  lineYsPx = [],
  rawCandidates = [],
  proposedCenters = [],
  columnX = null,
  title = '',
}) {
  const pad = 8
  const panelW = imageData.width
  const panelH = imageData.height
  const panels = 4
  const canvas = createCanvas(panelW * panels + pad * (panels + 1), panelH + 28 + pad * 2)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#eee'
  ctx.font = '12px sans-serif'
  ctx.fillText(title, pad, 16)

  const labels = ['pixels', 'staff lines', 'raw / profile', 'proposed']
  for (let panel = 0; panel < panels; panel += 1) {
    const ox = pad + panel * (panelW + pad)
    const oy = 24 + pad
    const panelCanvas = createCanvas(panelW, panelH)
    const panelCtx = panelCanvas.getContext('2d')
    const id = panelCtx.createImageData(panelW, panelH)
    id.data.set(imageData.data)
    panelCtx.putImageData(id, 0, 0)

    if (panel >= 1) {
      panelCtx.strokeStyle = 'rgba(0, 160, 255, 0.85)'
      panelCtx.lineWidth = 1
      for (const y of lineYsPx) {
        panelCtx.beginPath()
        panelCtx.moveTo(0, y)
        panelCtx.lineTo(panelW, y)
        panelCtx.stroke()
      }
    }
    if (columnX != null) {
      panelCtx.strokeStyle = 'rgba(255, 200, 0, 0.5)'
      panelCtx.beginPath()
      panelCtx.moveTo(columnX, 0)
      panelCtx.lineTo(columnX, panelH)
      panelCtx.stroke()
    }
    if (panel === 2) {
      for (const candidate of rawCandidates) {
        drawCross(panelCtx, candidate.cx, candidate.cy, 'rgba(255, 80, 80, 0.95)', 5)
      }
    }
    if (panel === 3) {
      for (const center of proposedCenters) {
        drawCross(panelCtx, center.cx, center.cy, 'rgba(80, 255, 120, 0.95)', 6)
        panelCtx.strokeStyle = 'rgba(80, 255, 120, 0.7)'
        panelCtx.beginPath()
        panelCtx.arc(center.cx, center.cy, 6, 0, Math.PI * 2)
        panelCtx.stroke()
      }
    }

    ctx.drawImage(panelCanvas, ox, oy)
    ctx.fillStyle = '#ccc'
    ctx.fillText(labels[panel], ox, oy + panelH + 12)
  }

  writeFileSync(outPath, canvas.toBuffer('image/png'))
}
