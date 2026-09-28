import { useId } from 'react'

export function Field({ label, hint, error, children }) {
  return (
    <label className="cz-field">
      {label ? <span className="cz-field__label">{label}</span> : null}
      {children}
      {error ? (
        <span className="cz-field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="cz-field__hint">{hint}</span>
      ) : null}
    </label>
  )
}

export function TextInput({ label, hint, error, id: idProp, ...rest }) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Field label={label} hint={hint} error={error}>
      <input id={id} className="cz-input" aria-invalid={error ? 'true' : undefined} {...rest} />
    </Field>
  )
}

export function Select({ label, hint, options, id: idProp, ...rest }) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <Field label={label} hint={hint}>
      <span className="cz-select">
        <select id={id} {...rest}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </Field>
  )
}

/** Toggle switch — a real `switch` role with Space/Enter + click. */
export function Toggle({ label, checked, onChange, disabled = false, ...rest }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="cz-toggle"
      {...rest}
    >
      <span className="cz-toggle__track" aria-hidden="true">
        <span className="cz-toggle__thumb" />
      </span>
      {label ? <span>{label}</span> : null}
    </button>
  )
}

/** Labeled range foundation (tempo, volume, seek). */
export function Slider({
  label,
  value,
  displayValue,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  id: idProp,
  ...rest
}) {
  const autoId = useId()
  const id = idProp ?? autoId
  return (
    <div className="cz-slider">
      <div className="cz-slider__head">
        <label className="cz-slider__label" htmlFor={id}>
          {label}
        </label>
        {displayValue != null ? <span className="cz-slider__value">{displayValue}</span> : null}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        {...rest}
      />
    </div>
  )
}
