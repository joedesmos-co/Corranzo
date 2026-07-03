/**
 * Canonical playback-voice status shared by every instrument. The values are
 * the long-standing piano ones so persisted/observed statuses stay identical.
 */
export const INSTRUMENT_STATUS = {
  LOADING: 'loading',
  SAMPLED: 'sampled',
  SYNTH: 'synth',
}

/** Status → user copy for a given instrument display name. */
export function buildInstrumentStatusLabels(instrumentLabel = 'Instrument') {
  return {
    [INSTRUMENT_STATUS.LOADING]: `Loading ${instrumentLabel.toLowerCase()}…`,
    [INSTRUMENT_STATUS.SAMPLED]: `${instrumentLabel} ready`,
    [INSTRUMENT_STATUS.SYNTH]: 'Using basic synth fallback',
  }
}
