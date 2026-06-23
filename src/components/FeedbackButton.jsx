import { useId, useState } from 'react'
import { FEEDBACK_TEMPLATE } from '../features/beta/betaInfo.js'

async function copyFeedbackTemplate() {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(FEEDBACK_TEMPLATE)
      return 'copied'
    } catch {
      // Some browsers expose Clipboard API but deny it outside a secure context.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = FEEDBACK_TEMPLATE
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    // Continue to the manual copy panel.
  }
  textarea.remove()

  if (copied) {
    return 'copied'
  }

  return 'manual'
}

export default function FeedbackButton({
  className = '',
  label = 'Feedback',
  copiedLabel = 'Copied',
}) {
  const [status, setStatus] = useState('idle')
  const dialogTitleId = useId()

  async function handleCopy() {
    try {
      setStatus(await copyFeedbackTemplate())
    } catch {
      setStatus('error')
    }
  }

  let visibleLabel = label
  if (status === 'copied') {
    visibleLabel = copiedLabel
  } else if (status === 'error') {
    visibleLabel = 'Try copy again'
  }

  return (
    <>
      <button
        type="button"
        className={`feedback-button ${className}`.trim()}
        onClick={handleCopy}
        aria-label="Copy private beta feedback template"
        title="Copy a short feedback template to your clipboard"
      >
        {visibleLabel}
      </button>

      {status === 'manual' && (
        <div className="feedback-dialog-backdrop">
          <section
            className="feedback-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
          >
            <h2 id={dialogTitleId}>Beta feedback</h2>
            <p>Copy this prompt and send it to the person who invited you.</p>
            <textarea
              aria-label="Private beta feedback template"
              value={FEEDBACK_TEMPLATE}
              readOnly
              rows={8}
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              className="feedback-dialog__close"
              onClick={() => setStatus('idle')}
            >
              Done
            </button>
          </section>
        </div>
      )}
    </>
  )
}
