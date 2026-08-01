import { describe, expect, it } from 'vitest'
import {
  classifyHorizontalInkRow,
  partitionHorizontalRowsForInkRecovery,
} from '../src/features/omr/localLedgerStaffClassifier.js'
import { resolveNoteheadAnchor } from '../src/features/omr/pitchFromStaffPosition.js'

function image(width = 400, height = 280) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  return { width, height, data }
}

function inkPixel(target, x, y) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return
  const offset = (Math.round(y) * target.width + Math.round(x)) * 4
  target.data[offset] = 0
  target.data[offset + 1] = 0
  target.data[offset + 2] = 0
  target.data[offset + 3] = 255
}

function horizontal(target, x0, x1, y, thickness = 1) {
  for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy += 1) {
    for (let x = Math.round(x0); x <= Math.round(x1); x += 1) inkPixel(target, x, y + dy)
  }
}

function ellipse(target, cx, cy, rx, ry) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y += 1) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x += 1) {
      const dx = (x - cx) / rx
      const dy = (y - cy) / ry
      if (dx * dx + dy * dy <= 1) inkPixel(target, x, y)
    }
  }
}

function staff(target, lineYs, x0 = 20, x1 = 380) {
  for (const y of lineYs) horizontal(target, x0, x1, y)
}

const LINES = [100, 120, 140, 160, 180]
const GAP = 20

describe('local ledger vs staff classifier', () => {
  it('1. five long staff lines remain staff-like', () => {
    const rows = LINES.map((y) => ({
      y,
      longestRunPx: 360,
      runStart: 20,
      runEnd: 380,
      lengthRelativeToSystem: 0.9,
      lengthRelativeToLocalWindow: 0.95,
    }))
    for (const row of rows) {
      const result = classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 200,
      })
      expect(result.result).toBe('staff-like')
    }
  })

  it('2. three short upper ledger lines remain local ledgers', () => {
    const rows = [40, 60, 80].map((y) => ({
      y,
      longestRunPx: 28,
      runStart: 186,
      runEnd: 214,
      lengthRelativeToSystem: 0.07,
      lengthRelativeToLocalWindow: 0.7,
    }))
    for (const row of rows) {
      expect(
        classifyHorizontalInkRow(row, {
          gapPx: GAP,
          staffTopPx: 100,
          staffBottomPx: 180,
          noteheadX: 200,
        }).result,
      ).toBe('local-ledger')
    }
  })

  it('3. five short upper ledger lines remain local ledgers', () => {
    const rows = [20, 40, 60, 80, 90].map((y) => ({
      y,
      longestRunPx: 30,
      runStart: 185,
      runEnd: 215,
      lengthRelativeToSystem: 0.075,
      lengthRelativeToLocalWindow: 0.75,
    }))
    const partitioned = partitionHorizontalRowsForInkRecovery(rows, {
      gapPx: GAP,
      staffTopPx: 100,
      staffBottomPx: 180,
      noteheadX: 200,
    })
    expect(partitioned.acceptedLedgerRows.length).toBe(5)
    expect(partitioned.suppressedStaffRows.length).toBe(0)
  })

  it('4. dense ledgers centered on one chord column stay local', () => {
    const row = {
      y: 60,
      longestRunPx: 36,
      runStart: 190,
      runEnd: 226,
      lengthRelativeToSystem: 0.09,
      lengthRelativeToLocalWindow: 0.8,
    }
    expect(
      classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 200,
        chordColumnXs: [200, 205],
      }).result,
    ).toBe('local-ledger')
  })

  it('5. ledger rows spanning two nearby chord tones stay local', () => {
    const row = {
      y: 70,
      longestRunPx: 48,
      runStart: 180,
      runEnd: 228,
      lengthRelativeToSystem: 0.12,
      lengthRelativeToLocalWindow: 0.85,
    }
    expect(
      classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 190,
        chordColumnXs: [190, 220],
      }).result,
    ).toBe('local-ledger')
  })

  it('6. beam-like mid-staff short run is not promoted to local ledger', () => {
    const row = {
      y: 130,
      longestRunPx: 40,
      runStart: 200,
      runEnd: 240,
      lengthRelativeToSystem: 0.1,
      lengthRelativeToLocalWindow: 0.6,
    }
    const result = classifyHorizontalInkRow(row, {
      gapPx: GAP,
      staffTopPx: 100,
      staffBottomPx: 180,
      noteheadX: 220,
    })
    expect(result.result).not.toBe('local-ledger')
  })

  it('7. barline-like vertical geometry is not classified via horizontal ledger path', () => {
    // Classifier only sees horizontal rows; a non-horizontal candidate stays ambiguous.
    const row = {
      y: 140,
      longestRunPx: 4,
      runStart: 100,
      runEnd: 104,
      lengthRelativeToSystem: 0.01,
      lengthRelativeToLocalWindow: 0.1,
    }
    expect(
      classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 200,
      }).result,
    ).toBe('ambiguous')
  })

  it('8. text underline far below staff is not a local ledger', () => {
    const row = {
      y: 250,
      longestRunPx: 120,
      runStart: 40,
      runEnd: 160,
      lengthRelativeToSystem: 0.3,
      lengthRelativeToLocalWindow: 0.9,
    }
    const result = classifyHorizontalInkRow(row, {
      gapPx: GAP,
      staffTopPx: 100,
      staffBottomPx: 180,
      noteheadX: 300,
      chordColumnXs: [300],
    })
    expect(result.result).not.toBe('local-ledger')
  })

  it('9. partial staff fragment inside staff band with system support stays staff-like', () => {
    const row = {
      y: 140,
      longestRunPx: 200,
      runStart: 20,
      runEnd: 220,
      lengthRelativeToSystem: 0.5,
      lengthRelativeToLocalWindow: 0.9,
    }
    expect(
      classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 100,
        systemEventSupport: 12,
      }).result,
    ).toBe('staff-like')
  })

  it('10. ambiguous row set is rejected from ledger promotion', () => {
    const row = {
      y: 50,
      longestRunPx: 20,
      runStart: 10,
      runEnd: 30,
      lengthRelativeToSystem: 0.05,
      lengthRelativeToLocalWindow: 0.3,
    }
    expect(
      classifyHorizontalInkRow(row, {
        gapPx: GAP,
        staffTopPx: 100,
        staffBottomPx: 180,
        noteheadX: 300,
      }).result,
    ).toBe('ambiguous')
  })

  it('11-14. filled/open heads under dense short ledgers recover ink centers', () => {
    const page = image()
    staff(page, LINES)
    for (const y of [40, 60, 80]) horizontal(page, 192, 220, y)
    ellipse(page, 206, 40, 8, 5)
    ellipse(page, 206, 60, 8, 5)
    ellipse(page, 206, 80, 8, 5)
    const upper = resolveNoteheadAnchor(
      { x: 206, y: 53, width: 18, height: 30, text: '\ue0a4', fontName: 'g_d9_f3' },
      page,
      LINES,
    )
    const mid = resolveNoteheadAnchor(
      { x: 206, y: 73, width: 18, height: 30, text: '\ue0a4', fontName: 'g_d9_f3' },
      page,
      LINES,
    )
    expect(upper.source).toMatch(/ink-notehead-geometry/)
    expect(mid.source).toMatch(/ink-notehead-geometry/)
    expect(Math.round(upper.yNorm * page.height)).toBe(40)
    expect(Math.round(mid.yNorm * page.height)).toBe(60)
  })

  it('15-17. displaced seconds and shared stem keep separate recovered centers', () => {
    const page = image()
    staff(page, LINES)
    horizontal(page, 188, 236, 80)
    ellipse(page, 200, 80, 8, 5)
    ellipse(page, 218, 90, 8, 5)
    // shared stem
    for (let y = 50; y <= 95; y += 1) inkPixel(page, 226, y)
    const left = resolveNoteheadAnchor(
      { x: 200, y: 93, width: 18, height: 30, text: '\ue0a4', fontName: 'g_d9_f3' },
      page,
      LINES,
    )
    const right = resolveNoteheadAnchor(
      { x: 218, y: 103, width: 18, height: 30, text: '\ue0a4', fontName: 'g_d9_f3' },
      page,
      LINES,
    )
    expect(Math.round(left.yNorm * page.height)).toBe(80)
    expect(Math.round(right.yNorm * page.height)).toBe(90)
  })

  it('20. reliable ordinary ink anchor still wins without ledger masking', () => {
    const page = image()
    staff(page, LINES)
    ellipse(page, 200, 140, 8, 5)
    const anchor = resolveNoteheadAnchor(
      { x: 200, y: 151, width: 18, height: 30, text: '\ue0a4', fontName: 'g_d9_f3' },
      page,
      LINES,
    )
    expect(anchor.source).toBe('ink-notehead-geometry')
    expect(Math.round(anchor.yNorm * page.height)).toBe(140)
  })
})
