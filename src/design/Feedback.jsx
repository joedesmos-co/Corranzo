import Icon from './Icon.jsx'
import { Button } from './Button.jsx'

const BADGE_TONES = new Set(['neutral', 'ready', 'warn', 'error', 'signal'])

/**
 * Status language rule: default to StatusLine (inline icon + word, no
 * container). Reach for Badge (contained pill) only when a status must read
 * as a discrete flag — counts, live states pinned in chrome, deck modules.
 * Never a row of colored pills as ambient decoration.
 */
export function StatusLine({ tone = 'neutral', icon = null, children }) {
  const safeTone = BADGE_TONES.has(tone) ? tone : 'neutral'
  return (
    <span className={`cz-status cz-status--${safeTone}`}>
      {icon ? <Icon name={icon} size={14} /> : <span className="cz-status__dot" aria-hidden="true" />}
      <span>{children}</span>
    </span>
  )
}

/** Status indicator — contained pill for flags that need a boundary. See rule above. */
export function Badge({ tone = 'neutral', icon = null, children }) {
  const safeTone = BADGE_TONES.has(tone) ? tone : 'neutral'
  return (
    <span className={`cz-badge cz-badge--${safeTone}`}>
      <span className="cz-badge__dot" aria-hidden="true" />
      {icon ? <Icon name={icon} size={13} /> : null}
      <span>{children}</span>
    </span>
  )
}

export function Divider() {
  return <hr className="cz-divider" />
}

/** `headingLevel` lets callers keep a correct document outline under their own h1/h2. */
export function Panel({ variant = 'default', title = null, sub = null, headingLevel = 3, children }) {
  const Heading = `h${Math.min(6, Math.max(2, headingLevel))}`
  const modifier = variant === 'default' ? '' : ` cz-panel--${variant}`
  return (
    <section className={`cz-panel${modifier}`}>
      {title ? <Heading className="cz-panel__title">{title}</Heading> : null}
      {sub ? <p className="cz-panel__sub">{sub}</p> : null}
      {children}
    </section>
  )
}

export function EmptyState({
  icon = 'music',
  title,
  copy = null,
  primaryAction = null,
  secondaryAction = null,
}) {
  return (
    <div className="cz-empty">
      <span className="cz-empty__staff" aria-hidden="true" />
      <span className="cz-empty__medallion" aria-hidden="true">
        <Icon name={icon} size={26} strokeWidth={1.5} />
      </span>
      <h3 className="cz-empty__title">{title}</h3>
      {copy ? <p className="cz-empty__copy">{copy}</p> : null}
      {primaryAction || secondaryAction ? (
        <div className="cz-empty__actions">
          {primaryAction ? (
            <Button variant="primary" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button variant="ghost" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Hover + focus tooltip. Trigger must already be labeled — this adds detail only. */
export function Tooltip({ tip, children }) {
  return (
    <span className="cz-tip">
      {children}
      <span className="cz-tip__bubble" role="tooltip">
        {tip}
      </span>
    </span>
  )
}
