import {
  BETA_LABEL,
  BETA_VERSION,
} from '../features/beta/betaInfo.js'
import FeedbackLink from './FeedbackLink.jsx'
import CorranzoLogo from './CorranzoLogo.jsx'

const VIEWS = [
  { id: 'library', label: 'Library' },
  { id: 'practice', label: 'Practice' },
  { id: 'profile', label: 'Profile' },
]

export default function TopBar({ activeView, onNavigate, onGoHome, practiceReady = true }) {
  function handleNavigate(id) {
    if (id === 'practice' && !practiceReady) {
      onNavigate(id, { blocked: true })
      return
    }
    onNavigate(id)
  }

  function handleGoHome(event) {
    event.preventDefault()
    onGoHome?.()
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
        <span className="topbar__beta">
          {BETA_LABEL} <span aria-hidden="true">·</span> v{BETA_VERSION}
        </span>
      </a>
      <div className="topbar__actions">
        <nav className="topbar__nav" aria-label="Main">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`topbar__nav-btn${activeView === id ? ' topbar__nav-btn--active' : ''}${
                id === 'practice' && !practiceReady ? ' topbar__nav-btn--muted' : ''
              }`}
              onClick={() => handleNavigate(id)}
              aria-current={activeView === id ? 'page' : undefined}
              title={
                id === 'practice' && !practiceReady
                  ? 'Upload a PDF and score timing file in Library first'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <FeedbackLink className="topbar__feedback" label="Feedback" />
      </div>
    </header>
  )
}
