export const INSTRUMENT_STATUS = {
  LOADING: 'loading',
  SAMPLED: 'sampled',
  SYNTH: 'synth',
}

export const INSTRUMENT_STATUS_LABEL = {
  [INSTRUMENT_STATUS.LOADING]: 'Loading piano samples…',
  [INSTRUMENT_STATUS.SAMPLED]: 'Piano samples loaded',
  [INSTRUMENT_STATUS.SYNTH]: 'Using basic synth fallback',
}
