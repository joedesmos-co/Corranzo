import { useEffect, useId, useState } from 'react'

export default function PracticeCollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  onOpenChange,
  dataTourId = null,
  ariaLabel = null,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  useEffect(() => {
    if (defaultOpen) {
      const timeoutId = window.setTimeout(() => setOpen(true), 0)
      return () => window.clearTimeout(timeoutId)
    }
    return undefined
  }, [defaultOpen])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  return (
    <section
      className={`practice-section practice-section--collapsible${open ? ' practice-section--collapsible-open' : ''}`}
      data-tour-id={dataTourId ?? undefined}
      aria-label={ariaLabel ?? undefined}
    >
      <button
        type="button"
        className="practice-section__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="practice-section__toggle-label">
          <span className="practice-section__title practice-section__title--editorial">{title}</span>
          {!open && summary && (
            <span className="practice-section__summary">{summary}</span>
          )}
        </span>
        <span className="practice-section__chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div id={panelId} className="practice-section__collapse" aria-hidden={!open}>
        <div className="practice-section__collapse-inner" inert={open ? undefined : true}>
          {children}
        </div>
      </div>
    </section>
  )
}
