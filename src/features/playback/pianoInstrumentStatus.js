import {
  INSTRUMENT_STATUS,
  buildInstrumentStatusLabels,
} from './instrumentVoiceStatus.js'

/**
 * Piano-worded status labels (legacy import path — the canonical status enum
 * lives in instrumentVoiceStatus.js and is shared by every instrument voice).
 */
export { INSTRUMENT_STATUS }

export const INSTRUMENT_STATUS_LABEL = buildInstrumentStatusLabels('Piano')
