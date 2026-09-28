import { useCallback, useRef } from 'react'
import Icon from './Icon.jsx'
import { PRACTICE_MODE_OPTIONS } from './modeOptions.js'

/**
 * ModeSwitch — the signature three-state practice mode control.
 * A dark inset track with per-mode glyphs; the active position reads as a
 * raised warm key with a signal edge-bar, pip, and full-hint contrast.
 * Precision instrument, not skeuomorphic hardware: flat surfaces, one accent.
 *
 * Prototype scope (Phase A): NOT wired to the score workspace. The sandbox
 * drives it with local state; real wiring lands in Phase D.
 */
export default function ModeSwitch({ label = 'Practice mode', value, onChange, disabled = false }) {
  const refs = useRef([])

  const focusOption = useCallback(
    (index) => {
      const count = PRACTICE_MODE_OPTIONS.length
      const next = (index + count) % count
      refs.current[next]?.focus()
      const option = PRACTICE_MODE_OPTIONS[next]
      if (option && option.value !== value) {
        onChange(option.value)
      }
    },
    [value, onChange],
  )

  function handleKeyDown(event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusOption(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusOption(index - 1)
    }
  }

  return (
    <div className="cz-modeswitch" role="radiogroup" aria-label={label}>
      {PRACTICE_MODE_OPTIONS.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-pressed={selected}
            disabled={disabled}
            tabIndex={selected || (!value && index === 0) ? 0 : -1}
            className="cz-modeswitch__option"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="cz-modeswitch__label">
              <Icon
                name={option.icon}
                size={16}
                className="cz-modeswitch__glyph"
              />
              {option.label}
              <span className="cz-modeswitch__pip" aria-hidden="true" />
            </span>
            <span className="cz-modeswitch__hint">{option.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
