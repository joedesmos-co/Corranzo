import { useCallback, useMemo, useState } from 'react'
import { InstrumentContext } from './instrumentContext.js'
import {
  getInstrument,
  normalizeInstrumentId,
} from '../features/instruments/instruments.js'
import {
  loadSelectedInstrumentId,
  saveSelectedInstrumentId,
} from '../features/instruments/instrumentStorage.js'

/** Provides the persisted app-wide instrument selection. */
export function InstrumentProvider({ children, initialInstrumentId = null }) {
  const [instrumentId, setInstrumentIdState] = useState(() =>
    normalizeInstrumentId(initialInstrumentId ?? loadSelectedInstrumentId()),
  )

  const setInstrumentId = useCallback((next) => {
    const normalized = normalizeInstrumentId(next)
    setInstrumentIdState(normalized)
    saveSelectedInstrumentId(normalized)
  }, [])

  const value = useMemo(
    () => ({
      instrumentId,
      instrument: getInstrument(instrumentId),
      setInstrumentId,
    }),
    [instrumentId, setInstrumentId],
  )

  return <InstrumentContext.Provider value={value}>{children}</InstrumentContext.Provider>
}
