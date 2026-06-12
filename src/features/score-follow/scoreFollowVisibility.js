export const CURSOR_HIDE_REASON = {
  VISIBLE: 'visible',
  NO_PDF: 'no-pdf',
  NO_TIMING: 'no-timing',
  NO_ANCHORS: 'no-anchors',
  OVERLAY_DISABLED: 'overlay-disabled',
  ALIGNMENT_MODE: 'alignment-mode',
  CURSOR_NOT_COMPUTED: 'cursor-not-computed',
  WRONG_PAGE: 'wrong-page',
  NEEDS_SETUP: 'needs-setup',
  LOW_TRUST: 'low-trust',
  NOTE_TARGET: 'note-target',
}

export const CURSOR_HIDE_REASON_LABELS = {
  [CURSOR_HIDE_REASON.VISIBLE]: 'Cursor visible on this page',
  [CURSOR_HIDE_REASON.NO_PDF]: 'No PDF loaded',
  [CURSOR_HIDE_REASON.NO_TIMING]: 'No score timing file loaded',
  [CURSOR_HIDE_REASON.NO_ANCHORS]: 'No measure anchors placed',
  [CURSOR_HIDE_REASON.OVERLAY_DISABLED]: 'Score-follow overlay is off',
  [CURSOR_HIDE_REASON.ALIGNMENT_MODE]: 'Hidden during alignment mode',
  [CURSOR_HIDE_REASON.CURSOR_NOT_COMPUTED]: 'Could not compute cursor position',
  [CURSOR_HIDE_REASON.WRONG_PAGE]: 'Cursor is on a different PDF page',
  [CURSOR_HIDE_REASON.NEEDS_SETUP]: 'Score follow needs setup',
  [CURSOR_HIDE_REASON.LOW_TRUST]: 'Score follow needs setup',
  [CURSOR_HIDE_REASON.NOTE_TARGET]: 'Hidden while Your note is shown',
}

/** Short, musician-friendly hint when the follow cursor is not on the current page. */
export function getCursorFollowHint(reason, { cursorPage, visiblePageNumber } = {}) {
  switch (reason) {
    case CURSOR_HIDE_REASON.ALIGNMENT_MODE:
      return 'The follow cursor returns when you finish placing anchors (Esc).'
    case CURSOR_HIDE_REASON.OVERLAY_DISABLED:
      return 'Turn on “Show cursor overlay” to see the follow cursor.'
    case CURSOR_HIDE_REASON.NO_ANCHORS:
      return 'Place at least one measure anchor to see the follow cursor.'
    case CURSOR_HIDE_REASON.NEEDS_SETUP:
    case CURSOR_HIDE_REASON.LOW_TRUST:
      return 'Score follow needs setup — mark measures manually or use the demo sample for a calibrated cursor.'
    case CURSOR_HIDE_REASON.NOTE_TARGET:
      return 'Follow the amber Your note marker during Wait For You.'
    case CURSOR_HIDE_REASON.WRONG_PAGE:
      return cursorPage != null && visiblePageNumber != null
        ? `Follow cursor is on page ${cursorPage} — switch to page ${cursorPage} to see it.`
        : 'Follow cursor is on another page.'
    case CURSOR_HIDE_REASON.CURSOR_NOT_COMPUTED:
      return 'Score follow needs setup.'
    default:
      return null
  }
}

/**
 * Decide whether the follow cursor should render on the visible PDF page.
 */
export function getCursorVisibilityState({
  hasPdf,
  hasTiming,
  hasAnchors,
  enabled,
  alignmentMode,
  semiAutoPreview = false,
  cursor,
  visiblePageNumber,
  anchorTrust = null,
  needsSetup = false,
  hideForNoteTarget = false,
}) {
  if (!hasPdf) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.NO_PDF,
      cursorPage: null,
    }
  }

  if (!hasTiming) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.NO_TIMING,
      cursorPage: null,
    }
  }

  if (!hasAnchors) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.NO_ANCHORS,
      cursorPage: null,
    }
  }

  if (anchorTrust && !anchorTrust.showCursor) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.LOW_TRUST,
      cursorPage: null,
    }
  }

  if (needsSetup) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.NEEDS_SETUP,
      cursorPage: null,
    }
  }

  if (hideForNoteTarget) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.NOTE_TARGET,
      cursorPage: cursor?.page ?? null,
    }
  }

  if (!enabled) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.OVERLAY_DISABLED,
      cursorPage: cursor?.page ?? null,
    }
  }

  if (alignmentMode || semiAutoPreview) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.ALIGNMENT_MODE,
      cursorPage: cursor?.page ?? null,
    }
  }

  if (!cursor?.visible) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.CURSOR_NOT_COMPUTED,
      cursorPage: null,
    }
  }

  if (cursor.page !== visiblePageNumber) {
    return {
      show: false,
      reason: CURSOR_HIDE_REASON.WRONG_PAGE,
      cursorPage: cursor.page,
    }
  }

  return {
    show: true,
    reason: CURSOR_HIDE_REASON.VISIBLE,
    cursorPage: cursor.page,
  }
}
