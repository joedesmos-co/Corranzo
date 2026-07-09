/**
 * Non-blocking import warnings and next-step guidance (main Practice panel).
 */
import { partitionImportWarnings } from '../../features/import/importWarningCategories.js'

export default function PracticeImportNotices({ warnings = [], guidance = [], maxGuidance = 3 }) {
  const visibleGuidance = guidance.filter(Boolean).slice(0, maxGuidance)
  const { critical, disclosure } = partitionImportWarnings(warnings.filter((item) => item?.message))

  if (critical.length === 0 && disclosure.length === 0 && visibleGuidance.length === 0) {
    return null
  }

  return (
    <div className="practice-import-notices" aria-label="Import notes">
      {visibleGuidance.length > 0 && (
        <div className="practice-import-notices__guidance">
          <p className="practice-import-notices__heading">Notes</p>
          <ul className="practice-import-notices__list">
            {visibleGuidance.map((step) => (
              <li key={step} className="practice-import-notices__guidance-item">
                {step}
              </li>
            ))}
          </ul>
        </div>
      )}

      {critical.length > 0 && (
        <ul className="practice-import-notices__warnings">
          {critical.map((warning) => (
            <li
              key={warning.id}
              className="practice-import-notices__warning practice-import-notices__warning--wrap practice-import-notices__warning--strong"
            >
              {warning.message}
            </li>
          ))}
        </ul>
      )}

      {disclosure.length > 0 && (
        <details className="practice-import-notices__disclosure">
          <summary className="practice-import-notices__disclosure-summary">
            <span className="practice-import-notices__disclosure-label">
              Import notes{disclosure.length > 0 ? ` (${disclosure.length})` : ''}
            </span>
          </summary>
          <ul className="practice-import-notices__warnings practice-import-notices__warnings--disclosure">
            {disclosure.map((warning) => (
              <li
                key={warning.id}
                className="practice-import-notices__warning practice-import-notices__warning--wrap"
              >
                {warning.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
