import InstrumentSelector from '../InstrumentSelector.jsx'
import Popover, { PopoverItem } from '../../design/Popover.jsx'
import { Button } from '../../design/Button.jsx'
import CorranzoMark from './CorranzoMark.jsx'
import Icon from '../../design/Icon.jsx'

/**
 * Quiet global chrome: sidebar toggle, location context, one global Import
 * action, instrument, help. Score and playback controls are explicitly NOT
 * here — they belong to the score workspace phase.
 */
export default function ShellHeader({
  title,
  sub = null,
  sidebarExpanded,
  sidebarToggleRef,
  drawerMode = false,
  sidebarControlsId,
  onToggleSidebar,
  onGoHome,
  onNavigate,
  onReplayTutorial,
  onShowFileHelp,
  importActive = false,
}) {
  function handleBrandClick(event) {
    event.preventDefault()
    onGoHome()
  }

  return (
    <header className="cz-shell__header">
      <div className="cz-shell__header-left">
        <button
          ref={sidebarToggleRef}
          type="button"
          className="cz-shell__toggle"
          onClick={onToggleSidebar}
          aria-expanded={sidebarExpanded}
          aria-controls={sidebarControlsId}
          aria-label={drawerMode ? 'Open navigation' : sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          title={drawerMode ? 'Open navigation' : sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <Icon name="panel" size={19} />
        </button>
        <a href="/" className="cz-shell__brandbtn" onClick={handleBrandClick} aria-label="Corranzo home">
          <span className="cz-shell__mark cz-shell__mark--sm" aria-hidden="true">
            <CorranzoMark size={26} />
          </span>
        </a>
        <div className="cz-shell__location">
          <span className="cz-shell__title">{title}</span>
          {sub ? <span className="cz-shell__sub">{sub}</span> : null}
        </div>
      </div>

      <div className="cz-shell__header-right">
        {!importActive && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate('import')}>
            <Icon name="import" size={15} /> Import
          </Button>
        )}
        <InstrumentSelector />
        <span data-tour-id="topbar-help">
          <Popover triggerIcon="info" triggerLabel="Help" align="end">
            {({ close }) => (
              <>
                {onReplayTutorial && (
                  <PopoverItem
                    icon="follow"
                    onClick={() => {
                      close()
                      onReplayTutorial()
                    }}
                  >
                    Replay tutorial
                  </PopoverItem>
                )}
                <PopoverItem
                  icon="music"
                  onClick={() => {
                    close()
                    onShowFileHelp()
                  }}
                >
                  How files work
                </PopoverItem>
                <PopoverItem
                  icon="pen"
                  onClick={() => {
                    close()
                    onNavigate('contact')
                  }}
                >
                  Contact &amp; feedback
                </PopoverItem>
              </>
            )}
          </Popover>
        </span>
      </div>
    </header>
  )
}
