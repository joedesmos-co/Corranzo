export default function PracticeHelpTip({ label, children }) {
  return (
    <span className="practice-help-tip">
      <button
        type="button"
        className="practice-help-tip__trigger"
        aria-label={label}
        title={typeof children === 'string' ? children : label}
      >
        ?
      </button>
      {typeof children === 'string' && (
        <span className="practice-help-tip__popover" role="tooltip">
          {children}
        </span>
      )}
    </span>
  )
}
