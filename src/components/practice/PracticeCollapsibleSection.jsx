import { useEffect, useState } from 'react'

export default function PracticeCollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  onOpenChange,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true)
    }
  }, [defaultOpen])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  return (
    <section
      className={`practice-section practice-section--collapsible${open ? ' practice-section--collapsible-open' : ''}`}
    >
      <button
        type="button"
        className="practice-section__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="practice-section__toggle-label">
          <span className="practice-section__title">{title}</span>
          {!open && summary && (
            <span className="practice-section__summary">{summary}</span>
          )}
        </span>
        <span className="practice-section__chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      <div className="practice-section__collapse" aria-hidden={!open}>
        <div className="practice-section__collapse-inner" inert={open ? undefined : true}>
          {children}
        </div>
      </div>
    </section>
  )
}
