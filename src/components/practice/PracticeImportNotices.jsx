/**
 * Non-blocking import warnings and next-step guidance (main Practice panel).
 */
export default function PracticeImportNotices({ warnings = [], guidance = [], maxGuidance = 3 }) {
  const visibleWarnings = warnings.filter((item) => item?.message)
  const visibleGuidance = guidance.filter(Boolean).slice(0, maxGuidance)

  if (visibleWarnings.length === 0 && visibleGuidance.length === 0) {
    return null
  }

  return (
    <div className="practice-import-notices" aria-label="Import notes">
      {visibleGuidance.length > 0 && (
        <div className="practice-import-notices__guidance">
          <p className="practice-import-notices__heading">Suggested next steps</p>
          <ul className="practice-import-notices__list">
            {visibleGuidance.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <ul className="practice-import-notices__warnings">
          {visibleWarnings.map((warning) => (
            <li
              key={warning.id}
              className={`practice-import-notices__warning${
                warning.strength === 'strong'
                  ? ' practice-import-notices__warning--strong'
                  : ''
              }`}
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
