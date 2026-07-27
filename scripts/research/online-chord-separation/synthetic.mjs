/**
 * Controlled synthetic chord crops for Spike 6.
 */
import { DEFAULT_INK_THRESHOLD } from './methods.mjs'

function blank(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  return { data, width, height }
}

function setInk(imageData, x, y, value = 24) {
  const { data, width, height } = imageData
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) {
    return
  }
  const index = (iy * width + ix) * 4
  data[index] = data[index + 1] = data[index + 2] = value
  data[index + 3] = 255
}

function hLine(imageData, y, x0, x1) {
  for (let x = x0; x <= x1; x += 1) {
    setInk(imageData, x, y)
  }
}

function filledHead(imageData, cx, cy, rx = 5, ry = 4) {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) {
        setInk(imageData, x, y)
      }
    }
  }
}

function hollowHead(imageData, cx, cy, rx = 5, ry = 4) {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      const r2 = nx * nx + ny * ny
      if (r2 <= 1 && r2 >= 0.45) {
        setInk(imageData, x, y)
      }
    }
  }
}

function stem(imageData, cx, cy, up = true, length = 28) {
  const x = cx + 5
  const y0 = up ? cy - length : cy
  const y1 = up ? cy : cy + length
  for (let y = y0; y <= y1; y += 1) {
    setInk(imageData, x, y)
  }
}

function staccatoDot(imageData, cx, cy, below = true) {
  const y = below ? cy + 10 : cy - 10
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      setInk(imageData, cx + dx, y + dy)
    }
  }
}

const WIDTH = 80
const HEIGHT = 120
const STAFF_TOP = 30
const STAFF_GAP = 10
const LINES = [0, 1, 2, 3, 4].map((index) => STAFF_TOP + index * STAFF_GAP)

function withStaff(draw) {
  const imageData = blank(WIDTH, HEIGHT)
  for (const y of LINES) {
    hLine(imageData, y, 8, WIDTH - 8)
  }
  draw(imageData)
  return {
    imageData,
    columnX: 40,
    lineYsPx: LINES,
    staffSpace: STAFF_GAP,
    clef: 'treble',
    threshold: DEFAULT_INK_THRESHOLD,
  }
}

export function buildSyntheticCases() {
  return [
    {
      id: 'synth-two-online-filled',
      label: 'Two filled heads on adjacent staff lines',
      expectedCenters: [LINES[1], LINES[2]],
      expectCount: 2,
      kind: 'chord',
      ...withStaff((img) => {
        filledHead(img, 40, LINES[1])
        filledHead(img, 40, LINES[2])
      }),
    },
    {
      id: 'synth-three-online-filled',
      label: 'Three filled heads on consecutive lines',
      expectedCenters: [LINES[1], LINES[2], LINES[3]],
      expectCount: 3,
      kind: 'chord',
      ...withStaff((img) => {
        filledHead(img, 40, LINES[1])
        filledHead(img, 40, LINES[2])
        filledHead(img, 40, LINES[3])
      }),
    },
    {
      id: 'synth-two-online-hollow',
      label: 'Two hollow heads on adjacent staff lines',
      expectedCenters: [LINES[1], LINES[2]],
      expectCount: 2,
      kind: 'chord',
      ...withStaff((img) => {
        hollowHead(img, 40, LINES[1])
        hollowHead(img, 40, LINES[2])
      }),
    },
    {
      id: 'synth-single-online',
      label: 'Single filled head on a staff line',
      expectedCenters: [LINES[2]],
      expectCount: 1,
      kind: 'single',
      ...withStaff((img) => {
        filledHead(img, 40, LINES[2])
        stem(img, 40, LINES[2], true)
      }),
    },
    {
      id: 'synth-single-space',
      label: 'Single filled head in a staff space',
      expectedCenters: [(LINES[1] + LINES[2]) / 2],
      expectCount: 1,
      kind: 'single',
      ...withStaff((img) => {
        filledHead(img, 40, (LINES[1] + LINES[2]) / 2)
      }),
    },
    {
      id: 'synth-single-with-staccato',
      label: 'Single on-line head with staccato dot',
      expectedCenters: [LINES[2]],
      expectCount: 1,
      kind: 'single-with-articulation',
      ...withStaff((img) => {
        filledHead(img, 40, LINES[2])
        stem(img, 40, LINES[2], true)
        staccatoDot(img, 40, LINES[2], true)
      }),
    },
    {
      id: 'synth-chord-with-beam',
      label: 'Two on-line heads with stem and beam',
      expectedCenters: [LINES[1], LINES[2]],
      expectCount: 2,
      kind: 'chord',
      ...withStaff((img) => {
        filledHead(img, 40, LINES[1])
        filledHead(img, 40, LINES[2])
        stem(img, 40, LINES[1], true, 22)
        stem(img, 40, LINES[2], true, 12)
        for (let x = 45; x <= 62; x += 1) {
          setInk(img, x, LINES[1] - 22)
          setInk(img, x, LINES[1] - 20)
        }
      }),
    },
  ]
}
