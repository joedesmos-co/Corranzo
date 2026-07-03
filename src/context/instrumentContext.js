import { createContext, useContext } from 'react'
import {
  DEFAULT_INSTRUMENT_ID,
  getInstrument,
} from '../features/instruments/instruments.js'

/**
 * App-wide selected instrument. Defaults to Piano (including when read outside
 * a provider, e.g. isolated component tests), so every legacy path behaves
 * exactly as before the instrument layer existed.
 *
 * Context + hook live here (no component exports) so Fast Refresh stays happy;
 * the provider component is in InstrumentContext.jsx.
 */
export const InstrumentContext = createContext({
  instrumentId: DEFAULT_INSTRUMENT_ID,
  instrument: getInstrument(DEFAULT_INSTRUMENT_ID),
  setInstrumentId: () => {},
})

export function useInstrument() {
  return useContext(InstrumentContext)
}
