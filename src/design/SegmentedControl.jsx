import { useCallback, useRef } from 'react'
import Icon from './Icon.jsx'

/**
 * SegmentedControl — single-select row. Buttons keep the native `button` role
 * with `aria-pressed` (the existing prod contract — e.g. the Score/Visual
 * toggle asserted by browser tests); arrow keys move between options and
 * selection follows focus as an enhancement.
 */
export default function SegmentedControl({ label, options, value, onChange, disabled = false, size = 'md' }) {
  const refs = useRef([])

  const focusOption = useCallback(
    (index) => {
      const count = options.length
      const next = (index + count) % count
      refs.current[next]?.focus()
      const option = options[next]
      if (option && !option.disabled && option.value !== value) {
        onChange(option.value)
      }
    },
    [options, value, onChange],
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
    <div className="cz-segmented" role="group" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value
        const optionDisabled = disabled || option.disabled
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            aria-pressed={selected}
            disabled={optionDisabled}
            tabIndex={selected || (!value && index === 0) ? 0 : -1}
            className="cz-segmented__option"
            data-size={size}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            title={option.hint ?? option.label}
          >
            {option.icon ? <Icon name={option.icon} size={15} /> : null}
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
