import {
  BETA_LABEL,
  BETA_VERSION,
} from '../features/beta/betaInfo.js'
import FeedbackLink from './FeedbackLink.jsx'
import CorranzoLogo from './CorranzoLogo.jsx'

const VIEWS = [
  { id: 'library', label: 'Library' },
  { id: 'practice', label: 'Practice' },
  { id: 'profile', label: 'Progress' },
]

export default function TopBar({
  activeView,
  onNavigate,
  onGoHome,
  onReplayTutorial,
  onShowFileHelp,
  practiceReady = true,
}) {
  function handleNavigate(id) {
    if (id === 'practice' && !practiceReady) {
      onNavigate(id, { emptyPractice: true })
      return
    }
    onNavigate(id)
  }

  function handleGoHome(event) {
    event.preventDefault()
    onGoHome?.()
  }

  function closeHelpMenu(event) {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  function handleShowFileHelp(event) {
    closeHelpMenu(event)
    if (typeof onShowFileHelp === 'function') {
      onShowFileHelp()
      return
    }
    handleNavigate('library')
  }

  return (
    <header className="topbar">
      <a
        href="/"
        className="topbar__brand topbar__brand-btn"
        onClick={handleGoHome}
        aria-label="Corranzo home"
      >
        <CorranzoLogo className="topbar__logo" width={148} height={40} loading="eager" />
        <span className="topbar__beta" title={`${BETA_LABEL} v${BETA_VERSION}`}>
          Beta
        </span>
      </a>
      <div className="topbar__actions">
        <nav className="topbar__nav" aria-label="Main">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              data-tour-id={id === 'practice' ? 'topbar-practice' : undefined}
              className={`topbar__nav-btn${activeView === id ? ' topbar__nav-btn--active' : ''}${
                id === 'practice' && !practiceReady ? ' topbar__nav-btn--muted' : ''
              }`}
              onClick={() => handleNavigate(id)}
              aria-current={activeView === id ? 'page' : undefined}
              title={
                id === 'practice' && !practiceReady
                  ? 'Try the demo or add sheet music first'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <details className="topbar__help-menu" data-tour-id="topbar-help">
          <summary className="topbar__help">Help</summary>
          <div className="topbar__help-panel">
            {onReplayTutorial && (
              <button
                type="button"
                className="topbar__help-item"
                onClick={(event) => {
                  closeHelpMenu(event)
                  onReplayTutorial()
                }}
              >
                Replay tutorial
              </button>
            )}
            <button
              type="button"
              className="topbar__help-item"
              onClick={handleShowFileHelp}
            >
              How files work
            </button>
            <FeedbackLink className="topbar__help-item topbar__help-link" label="Contact / Feedback" />
          </div>
        </details>
      </div>
    </header>
  )
}
