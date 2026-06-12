import { useState } from 'react'

export default function MeasureNavigationControls({
  disabled,
  bounds,
  canGoPrevious,
  canGoNext,
  onPrevious,
  onNext,
  onGoToMeasure,
  embedded = false,
}) {
  const [inputValue, setInputValue] = useState('')

  function handleGoSubmit(event) {
    event.preventDefault()
    const parsed = Number(inputValue)
    if (!Number.isFinite(parsed)) {
      return
    }
    const success = onGoToMeasure(parsed)
    if (success) {
      setInputValue(String(parsed))
    }
  }

  const className = embedded
    ? 'measure-nav measure-nav--embedded'
    : 'measure-nav'

  return (
    <div className={className} aria-label="Measure navigation">
      <span className="measure-nav__label">Measures</span>
      <div className="measure-nav__controls">
        <button
          type="button"
          className="measure-nav__btn"
          disabled={disabled || !canGoPrevious}
          onClick={onPrevious}
          aria-label="Previous measure"
        >
          ← Prev
        </button>
        <button
          type="button"
          className="measure-nav__btn"
          disabled={disabled || !canGoNext}
          onClick={onNext}
          aria-label="Next measure"
        >
          Next →
        </button>

        <form className="measure-nav__goto" onSubmit={handleGoSubmit}>
          <label className="measure-nav__goto-label" htmlFor="measure-nav-goto">
            Go to
          </label>
          <input
            id="measure-nav-goto"
            type="number"
            className="measure-nav__goto-input"
            min={bounds.min}
            max={bounds.max}
            step={1}
            placeholder={String(bounds.min)}
            value={inputValue}
            disabled={disabled || bounds.count === 0}
            onChange={(event) => setInputValue(event.target.value)}
          />
          <button
            type="submit"
            className="measure-nav__btn measure-nav__btn--go"
            disabled={disabled || bounds.count === 0 || inputValue === ''}
          >
            Go
          </button>
        </form>
      </div>
    </div>
  )
}
