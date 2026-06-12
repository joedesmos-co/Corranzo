import { useEffect, useId, useRef, useState } from 'react'

export function ToolbarIconButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}) {
  return (
    <button
      type="button"
      className={`tb-icon${active ? ' tb-icon--active' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="tb-icon__glyph" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

export default function ToolbarPopover({
  icon,
  label,
  active = false,
  disabled = false,
  children,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`tb-popover${open ? ' tb-popover--open' : ''}`}
    >
      <ToolbarIconButton
        icon={icon}
        label={label}
        active={active || open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      />
      <div
        id={panelId}
        role="menu"
        className="tb-popover__panel"
        hidden={!open}
      >
        {children}
      </div>
    </div>
  )
}
