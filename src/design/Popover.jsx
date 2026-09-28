import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'

/**
 * Generic popover/menu surface. Outside-dismiss + ESC (with focus return),
 * `role="menu"` semantics. Children get `close()` via render prop or plain nodes.
 */
export default function Popover({
  triggerIcon = null,
  triggerLabel,
  triggerContent = null,
  align = 'start',
  disabled = false,
  active = false,
  children,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const panelId = useId()
  const panelRef = useRef(null)
  const openAtEndRef = useRef(false)

  function close() {
    setOpen(false)
  }

  function handleMenuKeyDown(event) {
    const items = [...panelRef.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    const current = items.indexOf(document.activeElement)
    let next
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    const trigger = triggerRef.current
    const items = panelRef.current?.querySelectorAll('[role="menuitem"]:not(:disabled)')
    items?.[openAtEndRef.current ? items.length - 1 : 0]?.focus()
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      if (document.activeElement === document.body) trigger?.focus()
    }
  }, [open ])

  return (
    <span ref={rootRef} className="cz-pop" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <button
        ref={triggerRef}
        type="button"
        className={`cz-iconbtn${active || open ? ' cz-iconbtn--active' : ''}`}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => { openAtEndRef.current = false; setOpen((value) => !value) }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openAtEndRef.current = event.key === 'ArrowUp'
            setOpen(true)
          }
        }}
      >
        {triggerContent ?? (triggerIcon ? <Icon name={triggerIcon} size={18} /> : null)}
      </button>
      {open ? (
        <span
          ref={panelRef}
          id={panelId}
          onKeyDown={handleMenuKeyDown}
          role="menu"
          aria-label={triggerLabel}
          className={`cz-pop__panel${align === 'end' ? ' cz-pop__panel--end' : ''}`}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </span>
      ) : null}
    </span>
  )
}

export function PopoverItem({ icon = null, active = false, disabled = false, onClick, children }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`cz-pop__item${active ? ' cz-pop__item--active' : ''}`}
    >
      {icon ? <Icon name={icon} size={15} /> : null}
      <span>{children}</span>
    </button>
  )
}
