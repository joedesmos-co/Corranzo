import { useId } from 'react'

export default function PracticeHelpTip({ label, children }) {
  const descriptionId = useId()
  const hasDescription = typeof children === 'string'

  return (
    <span className="practice-help-tip">
      <button
        type="button"
        className="practice-help-tip__trigger"
        aria-label={label}
        aria-describedby={hasDescription ? descriptionId : undefined}
        title={hasDescription ? children : label}
      >
        ?
      </button>
      {hasDescription && (
        <span id={descriptionId} className="practice-help-tip__popover" role="tooltip">
          {children}
        </span>
      )}
    </span>
  )
}
