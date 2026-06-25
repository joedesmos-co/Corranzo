import {
  ANNOTATION_TOOLS,
  BRUSH_SIZE,
  ERASER_SIZE,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_OPACITY,
  PEN_COLORS,
  PEN_OPACITY,
  opacityToSlider,
  sliderToOpacity,
  sliderToWidth,
  widthToSlider,
} from './annotationConstants.js'

function ColorSwatches({ colors, value, onChange, disabled }) {
  const selectedColor = colors.includes(value) ? value : colors[0]

  return (
    <div className="ann-settings__colors" role="listbox" aria-label="Color">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="option"
          aria-selected={selectedColor === color}
          className={`ann-settings__swatch${selectedColor === color ? ' ann-settings__swatch--active' : ''}`}
          style={{ backgroundColor: color }}
          disabled={disabled}
          title={color}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function CompactSlider({ label, value, min = 0, max = 100, onChange, disabled }) {
  return (
    <label className="ann-settings__slider">
      <span className="ann-settings__slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export default function AnnotationToolSettings({
  disabled,
  activeTool,
  toolSettings,
  onUpdate,
  compact = false,
}) {
  const rootClass = compact ? 'ann-settings ann-settings--compact' : 'ann-settings'
  if (activeTool === ANNOTATION_TOOLS.ERASER) {
    const { width } = toolSettings.eraser
    return (
      <div className={rootClass} aria-label="Eraser settings">
        <CompactSlider
          label="Size"
          value={widthToSlider(width, ERASER_SIZE)}
          disabled={disabled}
          onChange={(value) =>
            onUpdate(ANNOTATION_TOOLS.ERASER, { width: sliderToWidth(value, ERASER_SIZE) })
          }
        />
      </div>
    )
  }

  if (activeTool === ANNOTATION_TOOLS.HIGHLIGHTER) {
    const { color, opacity, width } = toolSettings.highlighter
    return (
      <div className={rootClass} aria-label="Highlighter settings">
        <ColorSwatches
          colors={HIGHLIGHTER_COLORS}
          value={color}
          disabled={disabled}
          onChange={(next) => onUpdate(ANNOTATION_TOOLS.HIGHLIGHTER, { color: next })}
        />
        <CompactSlider
          label="Opacity"
          value={opacityToSlider(opacity, HIGHLIGHTER_OPACITY)}
          disabled={disabled}
          onChange={(value) =>
            onUpdate(ANNOTATION_TOOLS.HIGHLIGHTER, {
              opacity: sliderToOpacity(value, HIGHLIGHTER_OPACITY),
            })
          }
        />
        <CompactSlider
          label="Size"
          value={widthToSlider(width, BRUSH_SIZE)}
          disabled={disabled}
          onChange={(value) =>
            onUpdate(ANNOTATION_TOOLS.HIGHLIGHTER, { width: sliderToWidth(value, BRUSH_SIZE) })
          }
        />
      </div>
    )
  }

  const { color, opacity, width } = toolSettings.pen
  return (
    <div className={rootClass} aria-label="Pen settings">
      <ColorSwatches
        colors={PEN_COLORS}
        value={color}
        disabled={disabled}
        onChange={(next) => onUpdate(ANNOTATION_TOOLS.PEN, { color: next })}
      />
      <CompactSlider
        label="Opacity"
        value={opacityToSlider(opacity, PEN_OPACITY)}
        disabled={disabled}
        onChange={(value) =>
          onUpdate(ANNOTATION_TOOLS.PEN, { opacity: sliderToOpacity(value, PEN_OPACITY) })
        }
      />
      <CompactSlider
        label="Size"
        value={widthToSlider(width, BRUSH_SIZE)}
        disabled={disabled}
        onChange={(value) =>
          onUpdate(ANNOTATION_TOOLS.PEN, { width: sliderToWidth(value, BRUSH_SIZE) })
        }
      />
    </div>
  )
}
