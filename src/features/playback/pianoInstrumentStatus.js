export const INSTRUMENT_STATUS = {
  LOADING: 'loading',
  SAMPLED: 'sampled',
  SYNTH: 'synth',
}

export const INSTRUMENT_STATUS_LABEL = {
  [INSTRUMENT_STATUS.LOADING]: 'Loading piano…',
  [INSTRUMENT_STATUS.SAMPLED]: 'Piano ready',
  [INSTRUMENT_STATUS.SYNTH]: 'Using basic synth fallback',
}
