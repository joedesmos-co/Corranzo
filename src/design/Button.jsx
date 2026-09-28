import Icon from './Icon.jsx'

/** Primary / secondary / ghost / danger. */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  disabled = false,
  onClick,
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`cz-btn cz-btn--${variant} cz-btn--${size}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Square icon button — always needs an accessible label. */
export function IconButton({
  icon,
  label,
  size = 'md',
  iconSize = 19,
  active = false,
  disabled = false,
  onClick,
  ...rest
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={typeof rest['aria-pressed'] !== 'undefined' ? rest['aria-pressed'] : undefined}
      className={`cz-iconbtn cz-iconbtn--${size}${active ? ' cz-iconbtn--active' : ''}`}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  )
}
