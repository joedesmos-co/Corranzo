import { useEffect, useId, useState } from 'react'

const HELP = 'See the notes and finger positions as the music moves. Use Score for the original page.'

/** A contextual explanation, without interrupting entry or changing practice mode. */
export default function NoteGuideButton({ active, onSelect }) {
  const helpId = useId()
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (!showHelp) return undefined
    const dismiss = event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setShowHelp(false)
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [showHelp])

  return (
    <span
      className="workspace-note-guide-help"
      onPointerEnter={() => setShowHelp(true)}
      onPointerLeave={() => setShowHelp(false)}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-describedby={helpId}
        onFocus={() => setShowHelp(true)}
        onBlur={() => setShowHelp(false)}
        onClick={() => { setShowHelp(false); onSelect() }}
      >
        Note guide
      </button>
      <span id={helpId} role="tooltip" className="workspace-note-guide-tooltip" hidden={!showHelp}>
        <span>{HELP}</span>
      </span>
    </span>
  )
}
