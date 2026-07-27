import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import * as pdfjs from '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs'

const ANALYSIS_WIDTH = 1000

function pathChunks(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((entry) =>
    ArrayBuffer.isView(entry) ? Array.from(entry) : Array.isArray(entry) ? entry : [],
  )
}

function transformedPoint(x, y, transform) {
  const point = [x, y]
  pdfjs.Util.applyTransform(point, transform)
  return point
}

function extractPageCurves(page, operatorList) {
  let transform = [1, 0, 0, 1, 0, 0]
  const stack = []
  const curves = []
  const scale = ANALYSIS_WIDTH / page.view[2]
  const viewport = page.getViewport({ scale, rotation: 0 })
  const toViewport = (point) => viewport.convertToViewportPoint(point[0], point[1])

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index]
    const args = operatorList.argsArray[index]
    if (fn === pdfjs.OPS.save) {
      stack.push([...transform])
      continue
    }
    if (fn === pdfjs.OPS.restore) {
      if (stack.length) {
        transform = stack.pop()
      }
      continue
    }
    if (fn === pdfjs.OPS.transform) {
      transform = pdfjs.Util.transform(transform, args)
      continue
    }
    if (fn !== pdfjs.OPS.constructPath) {
      continue
    }

    const paintOperation = args?.[0]
    const raw = pathChunks(args?.[1])
    let cursor = 0
    const commands = []
    const points = []
    while (cursor < raw.length) {
      const command = raw[cursor]
      cursor += 1
      commands.push(command)
      const coordinateCount = command === 0 || command === 1 ? 2 : command === 2 ? 6 : 0
      for (let offset = 0; offset < coordinateCount; offset += 2) {
        if (!Number.isFinite(raw[cursor + offset]) || !Number.isFinite(raw[cursor + offset + 1])) {
          continue
        }
        points.push(
          transformedPoint(
            raw[cursor + offset],
            raw[cursor + offset + 1],
            transform,
          ),
        )
      }
      cursor += coordinateCount
    }

    if (commands.join(',') !== '0,2,2,3' || points.length !== 7) {
      continue
    }
    const viewportPoints = points.map(toViewport)
    const xValues = viewportPoints.map((point) => point[0])
    const yValues = viewportPoints.map((point) => point[1])
    const x0 = Math.min(...xValues)
    const x1 = Math.max(...xValues)
    const y0 = Math.min(...yValues)
    const y1 = Math.max(...yValues)
    const width = x1 - x0
    const height = y1 - y0
    if (
      width < 1 ||
      width > 920 ||
      height < 0.5 ||
      height > 55 ||
      width / height < 2
    ) {
      continue
    }

    curves.push({
      candidateId: `path-${curves.length + 1}`,
      operatorIndex: index,
      paintOperation,
      x0,
      x1,
      y0,
      y1,
      width,
      height,
      aspect: width / height,
      start: viewportPoints[0],
      end: viewportPoints[3],
      startControl: viewportPoints[1],
      endControl: viewportPoints[2],
    })
  }

  return curves
}

const files = {
  gymnopedie: '/Users/ryland/Downloads/gymnopedie-no-1-satie.pdf',
  minecraft: '/Users/ryland/Downloads/beginner-minecraft-piano-themes-in-c-minecraft.pdf',
  evangelion: '/Users/ryland/Downloads/a-cruel-angels-thesis-neon-genesis-evangelion.pdf',
  articulation:
    '../../benchmarks/omr-fixtures/piano-articulation-scan/piano-articulation-scan.pdf',
}

const overlayDir = new URL('./path-overlays/', import.meta.url)
mkdirSync(overlayDir, { recursive: true })

for (const [source, path] of Object.entries(files)) {
  const document = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(new URL(path, import.meta.url))),
    isEvalSupported: false,
  }).promise
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 3); pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const curves = extractPageCurves(page, await page.getOperatorList())
    const baseViewport = page.getViewport({ scale: 1, rotation: 0 })
    const viewport = page.getViewport({
      scale: ANALYSIS_WIDTH / baseViewport.width,
      rotation: 0,
    })
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    context.font = '13px sans-serif'
    for (const curve of curves) {
      context.strokeStyle = '#ff2d55'
      context.lineWidth = 2
      context.strokeRect(curve.x0 - 2, curve.y0 - 2, curve.width + 4, curve.height + 4)
      context.fillStyle = '#007aff'
      context.beginPath()
      context.arc(curve.start[0], curve.start[1], 4, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ff9500'
      context.beginPath()
      context.arc(curve.end[0], curve.end[1], 4, 0, Math.PI * 2)
      context.fill()
      context.fillStyle = '#ff2d55'
      context.fillText(curve.candidateId, curve.x0, Math.max(12, curve.y0 - 5))
    }
    writeFileSync(
      new URL(`${source}-p${pageNumber}-curves.png`, overlayDir),
      canvas.toBuffer('image/png'),
    )
    console.log(`\n${source} page ${pageNumber}: ${curves.length} path curves`)
    console.log(
      curves.map((curve) => ({
        ...curve,
        x0: Number(curve.x0.toFixed(1)),
        x1: Number(curve.x1.toFixed(1)),
        y0: Number(curve.y0.toFixed(1)),
        y1: Number(curve.y1.toFixed(1)),
        width: Number(curve.width.toFixed(1)),
        height: Number(curve.height.toFixed(1)),
        aspect: Number(curve.aspect.toFixed(1)),
        start: curve.start.map((value) => Number(value.toFixed(1))),
        end: curve.end.map((value) => Number(value.toFixed(1))),
        startControl: undefined,
        endControl: undefined,
      })),
    )
  }
}
