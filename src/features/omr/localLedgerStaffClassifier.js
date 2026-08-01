/**
 * Conservative local-ledger vs staff-row classification for notehead ink recovery.
 *
 * Joint features only — never row-count alone. Short local ledger runs near a
 * chord/note must not be treated as system staff geometry.
 */

/**
 * @typedef {object} HorizontalRowEvidence
 * @property {number} y
 * @property {number} longestRunPx
 * @property {number} [runStart]
 * @property {number} [runEnd]
 * @property {number} lengthRelativeToSystem
 * @property {number} lengthRelativeToLocalWindow
 */

/**
 * Classify one horizontal ink row as staff-like, local-ledger, or ambiguous.
 *
 * @returns {{
 *   result: 'staff-like'|'local-ledger'|'ambiguous',
 *   confidence: number,
 *   features: Record<string, number|boolean|string|null>,
 *   reason: string,
 * }}
 */
export function classifyHorizontalInkRow(row, context = {}) {
  const gapPx = Number(context.gapPx) || 0
  const staffTopPx = context.staffTopPx
  const staffBottomPx = context.staffBottomPx
  const noteheadX = context.noteheadX
  const chordColumnXs = Array.isArray(context.chordColumnXs) ? context.chordColumnXs : []
  const systemEventSupport = Number(context.systemEventSupport) || 0

  const lengthSystem = Number(row?.lengthRelativeToSystem) || 0
  const lengthLocal = Number(row?.lengthRelativeToLocalWindow) || 0
  const y = Number(row?.y)
  const runMid =
    Number.isFinite(row?.runStart) && Number.isFinite(row?.runEnd)
      ? (row.runStart + row.runEnd) / 2
      : noteheadX

  const aboveStaff =
    Number.isFinite(staffTopPx) && Number.isFinite(y) && y < staffTopPx - gapPx * 0.25
  const belowStaff =
    Number.isFinite(staffBottomPx) && Number.isFinite(y) && y > staffBottomPx + gapPx * 0.25
  const insideStaffBand =
    Number.isFinite(staffTopPx) &&
    Number.isFinite(staffBottomPx) &&
    Number.isFinite(y) &&
    y >= staffTopPx - gapPx * 0.35 &&
    y <= staffBottomPx + gapPx * 0.35

  const halfSpaceFromStaffTop =
    gapPx > 0 && Number.isFinite(staffTopPx) && Number.isFinite(y)
      ? Math.abs(staffTopPx - y) / gapPx
      : null
  const halfSpaceAligned =
    halfSpaceFromStaffTop != null
      ? Math.min(halfSpaceFromStaffTop % 0.5, 0.5 - (halfSpaceFromStaffTop % 0.5)) <= 0.12
      : false

  const nearNotehead =
    Number.isFinite(noteheadX) && Number.isFinite(runMid)
      ? Math.abs(runMid - noteheadX) <= gapPx * 1.8
      : false
  const nearChordColumn =
    chordColumnXs.length > 0 &&
    Number.isFinite(runMid) &&
    chordColumnXs.some((x) => Math.abs(runMid - x) <= gapPx * 2)

  const features = {
    lengthRelativeToSystem: lengthSystem,
    lengthRelativeToLocalWindow: lengthLocal,
    aboveStaff,
    belowStaff,
    insideStaffBand,
    halfSpaceAligned,
    nearNotehead,
    nearChordColumn,
    systemEventSupport,
  }

  // True staff-like: long vs system, or long local run inside the recognized staff band.
  if (lengthSystem >= 0.4) {
    return {
      result: 'staff-like',
      confidence: 0.9,
      features,
      reason: 'system-spanning-horizontal-run',
    }
  }
  if (insideStaffBand && lengthLocal >= 0.82 && lengthSystem >= 0.18) {
    return {
      result: 'staff-like',
      confidence: 0.82,
      features,
      reason: 'staff-band-long-local-run',
    }
  }
  if (insideStaffBand && lengthLocal >= 0.82 && systemEventSupport >= 8) {
    return {
      result: 'staff-like',
      confidence: 0.78,
      features,
      reason: 'staff-band-with-system-event-support',
    }
  }

  // Local ledger: short vs system, outside staff, near note/chord, half-space aligned.
  if (
    (aboveStaff || belowStaff) &&
    lengthSystem < 0.35 &&
    lengthLocal >= 0.35 &&
    (nearNotehead || nearChordColumn) &&
    (halfSpaceAligned || halfSpaceFromStaffTop != null)
  ) {
    return {
      result: 'local-ledger',
      confidence: halfSpaceAligned ? 0.86 : 0.7,
      features,
      reason: 'short-local-run-outside-staff-near-notation',
    }
  }

  if ((aboveStaff || belowStaff) && lengthSystem < 0.22 && lengthLocal >= 0.5) {
    return {
      result: 'local-ledger',
      confidence: 0.64,
      features,
      reason: 'short-localized-exterior-run',
    }
  }

  // Ambiguous: do not promote to ledger; keep conservative staff-like suppression
  // only when the existing long-local threshold would have fired.
  if (lengthLocal >= 0.82) {
    return {
      result: 'ambiguous',
      confidence: 0.45,
      features,
      reason: 'long-local-run-without-staff-or-ledger-confidence',
    }
  }

  return {
    result: 'ambiguous',
    confidence: 0.35,
    features,
    reason: 'insufficient-joint-evidence',
  }
}

/**
 * Decide which scanline ys should be suppressed as staff-like for ink recovery.
 * Local ledger rows are returned separately for optional stroke masking.
 */
export function partitionHorizontalRowsForInkRecovery(rows, context = {}) {
  const suppressedStaffRows = []
  const acceptedLedgerRows = []
  const ambiguousRows = []
  const classifications = []

  for (const row of rows ?? []) {
    const classification = classifyHorizontalInkRow(row, context)
    classifications.push({ y: row.y, ...classification })
    if (classification.result === 'staff-like') {
      suppressedStaffRows.push(row.y)
    } else if (classification.result === 'local-ledger') {
      acceptedLedgerRows.push(row)
    } else {
      ambiguousRows.push(row)
      // Conservative: ambiguous long locals still suppress (prior behavior).
      if ((Number(row.lengthRelativeToLocalWindow) || 0) >= 0.82) {
        suppressedStaffRows.push(row.y)
      }
    }
  }

  return {
    suppressedStaffRows: [...new Set(suppressedStaffRows)],
    acceptedLedgerRows,
    ambiguousRows,
    classifications,
  }
}
