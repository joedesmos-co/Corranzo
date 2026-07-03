import { forwardRef, useEffect, useId, useRef, useState } from 'react'

export const ToolbarIconButton = forwardRef(function ToolbarIconButton(
  {
    icon,
    label,
    active = false,
    disabled = false,
    onClick,
    'aria-expanded': ariaExpanded,
    'aria-haspopup': ariaHaspopup,
    'aria-controls': ariaControls,
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`tb-icon${active ? ' tb-icon--active' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHaspopup}
      aria-controls={ariaControls}
    >
      <span className="tb-icon__glyph" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
})

export default function ToolbarPopover({
  icon,
  label,
  active = false,
  disabled = false,
  panelClassName = '',
  children,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
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
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={`tb-popover${open ? ' tb-popover--open' : ''}`}
    >
      <ToolbarIconButton
        ref={triggerRef}
        icon={icon}
        label={label}
        active={active || open}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      />
      <div
        id={panelId}
        role="group"
        aria-label={label}
        className={`tb-popover__panel${panelClassName ? ` ${panelClassName}` : ''}`}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  )
}
