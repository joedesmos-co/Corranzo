import { hasIcon, iconShapes } from './iconPaths.js'

/**
 * <Icon name="play" size={16} />
 * Decorative by default (aria-hidden). Pass `label` for a meaningful icon —
 * it then gets role="img" + aria-label. Never a bare glyph: icons always
 * render from this registry, never as unicode text.
 */
export default function Icon({ name, size = 16, strokeWidth = 1.8, label = null, className = '' }) {
  if (!hasIcon(name)) {
    if (import.meta.env.DEV) {
      console.warn(`[cz-icon] unknown icon: ${name}`)
    }
    return null
  }
  const shapes = iconShapes[name]
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return (
    <svg
      className={`cz-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...a11y}
    >
      {shapes.map((shape, index) => {
        if (shape.c) {
          const [cx, cy, r] = shape.c
          return (
            <circle
              key={index}
              cx={cx}
              cy={cy}
              r={r}
              fill={shape.f ? 'currentColor' : 'none'}
              stroke={shape.f ? 'none' : undefined}
            />
          )
        }
        return (
          <path
            key={index}
            d={shape.d}
            strokeWidth={shape.w ?? undefined}
            fill={shape.f ? 'currentColor' : 'none'}
            stroke={shape.f ? 'none' : undefined}
          />
        )
      })}
    </svg>
  )
}
