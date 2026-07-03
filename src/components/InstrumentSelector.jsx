import { useRef } from 'react'
import { useInstrument } from '../context/instrumentContext.js'
import { listInstruments } from '../features/instruments/instruments.js'

/**
 * Compact segmented control for the app-wide instrument. Lives in the top bar
 * so the selection is visible (and switchable) everywhere.
 */
export default function InstrumentSelector({ disabled = false }) {
  const { instrumentId, setInstrumentId } = useInstrument()
  const optionRefs = useRef({})
  const instruments = listInstruments()

  function focusOption(id) {
    optionRefs.current[id]?.focus()
  }

  function handleKeyDown(event) {
    const currentIndex = instruments.findIndex((instrument) => instrument.id === instrumentId)
    if (currentIndex < 0) {
      return
    }

    let nextIndex = currentIndex
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      nextIndex = (currentIndex + 1) % instruments.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      nextIndex = (currentIndex - 1 + instruments.length) % instruments.length
    } else {
      return
    }

    const nextInstrument = instruments[nextIndex]
    setInstrumentId(nextInstrument.id)
    focusOption(nextInstrument.id)
  }

  return (
    <div
      className="instrument-selector"
      role="radiogroup"
      aria-label="Practice instrument"
      data-tour-id="instrument-selector"
      onKeyDown={handleKeyDown}
    >
      {instruments.map((instrument) => {
        const active = instrument.id === instrumentId
        return (
          <button
            key={instrument.id}
            ref={(element) => {
              optionRefs.current[instrument.id] = element
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            className={`instrument-selector__option${
              active ? ' instrument-selector__option--active' : ''
            }`}
            onClick={() => setInstrumentId(instrument.id)}
          >
            {instrument.label}
          </button>
        )
      })}
    </div>
  )
}
