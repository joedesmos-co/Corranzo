import { useRef } from 'react'
import Icon from '../../design/Icon.jsx'
import { ANNOTATION_TOOLS } from './annotationConstants.js'
import AnnotationToolSettings from './AnnotationToolSettings.jsx'
import ToolbarPopover, { ToolbarIconButton } from '../ui/ToolbarPopover.jsx'

const DRAW_TOOLS = [
  { id: ANNOTATION_TOOLS.POINTER, icon: <Icon name="follow" size={16} />, label: 'Select / navigate' },
  { id: ANNOTATION_TOOLS.PEN, icon: <Icon name="pen" size={16} />, label: 'Pen' },
  { id: ANNOTATION_TOOLS.HIGHLIGHTER, icon: <Icon name="highlighter" size={16} />, label: 'Highlighter' },
  { id: ANNOTATION_TOOLS.ERASER, icon: <Icon name="eraser" size={16} />, label: 'Eraser' },
]

export default function PdfViewerToolbar({
  variant = 'embedded',
  visible = true,
  chromePinned = false,
  onToggleChromePinned,
  onChromeActivity,
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
  managedFocus = false,
  saveStatus = 'saved',
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
      inert={variant === 'fullscreen' && !visible ? true : undefined}
      onPointerEnter={onChromeActivity}
      onFocusCapture={onChromeActivity}
    >
      <div className="viewer-float-toolbar__bar">
        <ToolbarIconButton
          icon={<Icon name="prev" size={16} />}
          label="Previous page"
          disabled={disabled || !canGoPrev}
          onClick={onPrevPage}
        />
        <span className="viewer-float-toolbar__page" title="Current page">
          {pageLabel}
        </span>
        <ToolbarIconButton
          icon={<Icon name="next" size={16} />}
          label="Next page"
          disabled={disabled || !canGoNext}
          onClick={onNextPage}
        />

        <span className="viewer-float-toolbar__sep" aria-hidden="true" />

        <ToolbarPopover icon={<Icon name="zoom" size={16} />} label="Fit mode" disabled={disabled}>
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

        <ToolbarPopover
          icon={<Icon name="pen" size={16} />}
          label="Markup"
          active={activeTool !== ANNOTATION_TOOLS.POINTER}
          disabled={disabled}
          panelClassName="tb-popover__panel--markup"
        >
          <div className="tb-markup">
            <div className="tb-markup__tools" aria-label="Markup tools">
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
            </div>
            <AnnotationToolSettings
              disabled={disabled}
              activeTool={activeTool}
              toolSettings={toolSettings}
              onUpdate={onUpdateToolSettings}
              compact
            />
            <div className="tb-menu tb-markup__actions">
              <button
                type="button"
                className="tb-menu__item"
                disabled={disabled || !canUndoAnnotations}
                onClick={onUndoAnnotation}
              >
                Undo markup
              </button>
              <button
                type="button"
                className="tb-menu__item"
                disabled={disabled || !canUndoAnnotations}
                onClick={onClearAnnotations}
              >
                Clear page markup
              </button>
              <button
                type="button"
                className="tb-menu__item"
                disabled={disabled}
                onClick={onExportAnnotations}
              >
                Export markup
              </button>
              <button
                type="button"
                className="tb-menu__item"
                disabled={disabled}
                onClick={handleImportClick}
              >
                Import markup
              </button>
            </div>
          </div>
        </ToolbarPopover>

        <span className="viewer-float-toolbar__sep" aria-hidden="true" />

        <ToolbarPopover icon={<Icon name="settings" size={16} />} label="More options" disabled={disabled}>
          <div className="tb-menu">
            <button
              type="button"
              className="tb-menu__item"
              disabled={disabled}
              onClick={onTogglePaper}
            >
              {paperTheme === 'dark' ? 'Light paper' : 'Dark paper'}
            </button>
            {managedFocus ? null : variant === 'embedded' ? (
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
        <span className="viewer-float-toolbar__hint" data-save-state={saveStatus} title="Annotations save on this device" role="status">
          {saveStatus === 'saved' ? 'Marks saved' : saveStatus === 'error' ? 'Could not save marks — export a copy' : 'Marks are temporary'}
        </span>
      )}
    </div>
  )
}
