import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './Sidebar.jsx'
import ShellHeader from './ShellHeader.jsx'
import {
  SIDEBAR_DRAWER_MAX_WIDTH,
  SIDEBAR_MODE,
  SIDEBAR_RAIL_MAX_WIDTH,
  resolveSidebarMode,
} from '../../features/navigation/sidebarLayout.js'
import { focusFirstElement, handleFocusTrap } from '../../utils/focusTrap.js'
import './shell.css'

function readViewportWidth() {
  if (typeof window === 'undefined') return SIDEBAR_RAIL_MAX_WIDTH + 1
  return window.innerWidth
}

/**
 * Corranzo application shell: collapsible sidebar + quiet header + content.
 * - `expanded` is the persisted desktop preference (owned by the caller).
 * - Rail is forced at medium widths without touching the stored preference.
 * - Narrow widths get an ephemeral drawer (never persisted, ESC to close).
 * - Score views never auto-collapse anything: user choice is preserved.
 */
export default function AppShell({
  activeView,
  headerProps,
  expanded,
  onToggleExpanded,
  onNavigate,
  onGoHome,
  drawerId = 'cz-sidebar',
  children,
}) {
  const [viewportWidth, setViewportWidth] = useState(readViewportWidth)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const toggleRef = useRef(null)
  const drawerRef = useRef(null)
  const contentRef = useRef(null)
  const previousView = useRef(activeView)
  useEffect(() => {
    if (previousView.current === activeView) return
    previousView.current = activeView
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      contentRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeView])

  useEffect(() => {
    const railQuery = window.matchMedia(`(max-width: ${SIDEBAR_RAIL_MAX_WIDTH}px)`)
    const drawerQuery = window.matchMedia(`(max-width: ${SIDEBAR_DRAWER_MAX_WIDTH}px)`)
    function sync() {
      setViewportWidth(window.innerWidth)
      if (window.innerWidth > SIDEBAR_DRAWER_MAX_WIDTH) setDrawerOpen(false)
    }
    railQuery.addEventListener('change', sync)
    drawerQuery.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      railQuery.removeEventListener('change', sync)
      drawerQuery.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  const mode = resolveSidebarMode({ width: viewportWidth, expanded })
  const drawerActive = mode === SIDEBAR_MODE.DRAWER && drawerOpen

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }, [])

  // Any navigation closes an open drawer (no stale overlay).
  function handleNavigate(view, meta) {
    if (drawerActive) closeDrawer()
    onNavigate(view, meta)
  }

  // The temporary drawer owns focus and keyboard input, including over Practice.
  useEffect(() => {
    if (!drawerActive) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    focusFirstElement(drawerRef.current)
    function handleKeyDown(event) {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDrawer()
      } else {
        handleFocusTrap(drawerRef.current, event)
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [drawerActive, closeDrawer])

  function handleHeaderToggle() {
    if (mode === SIDEBAR_MODE.DRAWER) {
      if (drawerOpen) {
        closeDrawer()
      } else {
        setDrawerOpen(true)
      }
      return
    }
    onToggleExpanded()
  }

  return (
    <div className="cz-shell" data-view={activeView} data-sidebar={drawerActive ? 'drawer-open' : mode}>
      <a className="cz-skip-link" href="#corranzo-content" onClick={event => { event.preventDefault(); contentRef.current?.focus({ preventScroll: true }) }}>Skip to content</a>
      <div
        className={`cz-shell__sidewrap${drawerActive ? ' cz-shell__sidewrap--open' : ''}`}
        id={drawerId}
        ref={drawerRef}
        role={drawerActive ? 'dialog' : undefined}
        aria-modal={drawerActive || undefined}
        aria-label={drawerActive ? 'Navigation' : undefined}
        inert={mode === SIDEBAR_MODE.DRAWER && !drawerActive ? true : undefined}
      >
        <Sidebar
          activeView={activeView}
          onNavigate={handleNavigate}
          layout={drawerActive ? 'expanded' : mode}
          expanded={expanded}
          drawerActive={drawerActive}
          onToggleExpanded={drawerActive ? closeDrawer : onToggleExpanded}
        />
      </div>
      {drawerActive && (
        <button
          type="button"
          className="cz-shell__scrim"
          aria-label="Close navigation"
          onClick={closeDrawer}
        />
      )}
      <div className="cz-shell__main" inert={drawerActive ? true : undefined}>
        <ShellHeader
          {...headerProps}
          sidebarToggleRef={toggleRef}
          drawerMode={mode === SIDEBAR_MODE.DRAWER}
          sidebarExpanded={mode === SIDEBAR_MODE.EXPANDED || drawerActive}
          sidebarControlsId={drawerId}
          onToggleSidebar={handleHeaderToggle}
          onGoHome={onGoHome}
          onNavigate={handleNavigate}
        />
        <div id="corranzo-content" ref={contentRef} tabIndex={-1} className="cz-shell__content">{children}</div>
      </div>
    </div>
  )
}
