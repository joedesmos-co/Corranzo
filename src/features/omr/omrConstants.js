export const OMR_STATUS = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  DETECTING_NOTES: 'detecting-notes',
  BUILDING_PLAYBACK: 'building-playback',
  READY: 'ready',
  FAILED: 'failed',
}

export const OMR_STATUS_LABEL = {
  [OMR_STATUS.IDLE]: '',
  [OMR_STATUS.ANALYZING]: 'Analyzing PDF…',
  [OMR_STATUS.DETECTING_NOTES]: 'Detecting notes…',
  [OMR_STATUS.BUILDING_PLAYBACK]: 'Building playback…',
  [OMR_STATUS.READY]: 'Ready',
  [OMR_STATUS.FAILED]: 'Failed',
}

export const OMR_TOO_DIFFICULT_MESSAGE =
  'PDF too difficult for local generation. Try a cleaner digital export or upload MusicXML/MXL.'

export function omrPageProgressLabel(page, pageCount, phase = 'analyze') {
  if (phase === 'preprocess') {
    return `Cleaning up page ${page} of ${pageCount}…`
  }
  if (phase === 'detect') {
    return `Detecting notes on page ${page} of ${pageCount}…`
  }
  return `Analyzing page ${page} of ${pageCount}…`
}

export function yieldToBrowser() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Piano grand staff — two staves per system. */
export const OMR_PIANO_STAVES_PER_SYSTEM = 2

export const OMR_DEFAULT_TEMPO = 120
export const OMR_DEFAULT_BEATS = 4
export const OMR_DEFAULT_BEAT_TYPE = 4
