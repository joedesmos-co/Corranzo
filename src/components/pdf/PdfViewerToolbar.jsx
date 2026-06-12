import { useRef } from 'react'
import { ANNOTATION_TOOLS } from './annotationConstants.js'
import AnnotationToolSettings from './AnnotationToolSettings.jsx'
import ToolbarPopover, { ToolbarIconButton } from '../ui/ToolbarPopover.jsx'

const DRAW_TOOLS = [
  { id: ANNOTATION_TOOLS.PEN, icon: '✎', label: 'Pen' },
  { id: ANNOTATION_TOOLS.HIGHLIGHTER, icon: '▬', label: 'Highlighter' },
  { id: ANNOTATION_TOOLS.ERASER, icon: '⌫', label: 'Eraser' },
]

export default function PdfViewerToolbar({
  variant = 'embedded',
  visible = true,
  chromePinned = false,
  onToggleChromePinned,
  file,
  fileName,
  pageNumber,
  numPages,
  fitMode,
  paperTheme,
  canGoPrev,
  canGoNext,
  activeTool,
  toolSettings,
  canUndoAnnotations,
  onFitModeChange,
  onPrevPage,
  onNextPage,
  onToggleFullscreen,
  onTogglePaper,
  onToolChange,
  onUpdateToolSettings,
  onUndoAnnotation,
  onClearAnnotations,
  onExportAnnotations,
  onImportAnnotations,
  onClose,
}) {
  const importInputRef = useRef(null)

  function handleImportClick() {
    importInputRef.current?.click()
  }

  async function handleImportChange(event) {
    const jsonFile = event.target.files?.[0]
    if (jsonFile) {
      await onImportAnnotations(jsonFile)
    }
    event.target.value = ''
  }

  const disabled = !file
  const pageLabel =
    file && numPages ? `${pageNumber}/${numPages}` : '—'

  return (
    <div
      className={`viewer-float-toolbar viewer-float-toolbar--${variant}${visible ? ' viewer-float-toolbar--visible' : ''}${variant === 'embedded' ? ' viewer-float-toolbar--embedded' : ''}`}
      role="toolbar"
      aria-label="PDF controls"
    >
      <div className="viewer-float-toolbar__bar">
        <ToolbarIconButton
          icon="‹"
          label="Previous page"
          disabled={disabled || !canGoPrev}
          onClick={onPrevPage}
        />
        <span className="viewer-float-toolbar__page" title="Current page">
          {pageLabel}
        </span>
        <ToolbarIconButton
          icon="›"
          label="Next page"
          disabled={disabled || !canGoNext}
          onClick={onNextPage}
        />

        <span className="viewer-float-toolbar__sep" aria-hidden="true" />

        <ToolbarPopover icon="⤢" label="Fit mode" disabled={disabled}>
          <div className="tb-menu">
            <button
              type="button"
              className={`tb-menu__item${fitMode === 'page' ? ' tb-menu__item--active' : ''}`}
              disabled={disabled}
              onClick={() => onFitModeChange('page')}
            >
              Fit page
            </button>
            <button
              type="button"
              className={`tb-menu__item${fitMode === 'width' ? ' tb-menu__item--active' : ''}`}
              disabled={disabled}
              onClick={() => onFitModeChange('width')}
            >
              Fit width
            </button>
          </div>
        </ToolbarPopover>

        <span className="viewer-float-toolbar__sep" aria-hidden="true" />

        {DRAW_TOOLS.map(({ id, icon, label }) => (
          <ToolbarIconButton
            key={id}
            icon={icon}
            label={label}
            active={activeTool === id}
            disabled={disabled}
            onClick={() => onToolChange(id)}
          />
        ))}

        <ToolbarPopover icon="⚙" label="Brush settings" disabled={disabled}>
          <AnnotationToolSettings
            disabled={disabled}
            activeTool={activeTool}
            toolSettings={toolSettings}
            onUpdate={onUpdateToolSettings}
            compact
          />
        </ToolbarPopover>

        <ToolbarIconButton
          icon="↶"
          label="Undo"
          disabled={disabled || !canUndoAnnotations}
          onClick={onUndoAnnotation}
        />
        <ToolbarIconButton
          icon="⌧"
          label="Clear page"
          disabled={disabled || !canUndoAnnotations}
          onClick={onClearAnnotations}
        />

        <span className="viewer-float-toolbar__sep" aria-hidden="true" />

        <ToolbarPopover icon="⋯" label="More options" disabled={disabled}>
          <div className="tb-menu">
            <button
              type="button"
              className="tb-menu__item"
              disabled={disabled}
              onClick={onTogglePaper}
            >
              {paperTheme === 'dark' ? 'Light paper' : 'Dark paper'}
            </button>
            <button
              type="button"
              className="tb-menu__item"
              disabled={disabled}
              onClick={onExportAnnotations}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="tb-menu__item"
              disabled={disabled}
              onClick={handleImportClick}
            >
              Import JSON
            </button>
            {variant === 'embedded' ? (
              <button
                type="button"
                className="tb-menu__item"
                disabled={disabled}
                onClick={onToggleFullscreen}
              >
                Fullscreen
              </button>
            ) : (
              <button type="button" className="tb-menu__item" onClick={onClose}>
                Exit fullscreen
              </button>
            )}
          </div>
        </ToolbarPopover>

        {variant === 'fullscreen' && onToggleChromePinned && (
          <ToolbarIconButton
            icon={chromePinned ? '◆' : '◇'}
            label={chromePinned ? 'Unpin controls (auto-hide)' : 'Pin controls visible'}
            onClick={onToggleChromePinned}
          />
        )}

        {variant === 'fullscreen' && (
          <ToolbarIconButton icon="✕" label="Exit fullscreen" onClick={onClose} />
        )}

        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={handleImportChange}
        />
      </div>

      {fileName && variant === 'embedded' && (
        <span className="viewer-float-toolbar__hint" title="Annotations autosave locally">
          Saved
        </span>
      )}
    </div>
  )
}
