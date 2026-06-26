import {
  BETA_VERSION,
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO,
} from '../features/beta/betaInfo.js'
import { LEGAL_PATHS } from '../features/legal/legalRoutes.js'
import CorranzoLogo from './CorranzoLogo.jsx'

export default function AppFooter({ onLegalNavigate }) {
  function handleLegalClick(event, view) {
    if (!onLegalNavigate) {
      return
    }
    event.preventDefault()
    onLegalNavigate(view)
  }

  return (
    <footer className="app-footer">
      <CorranzoLogo className="app-footer__logo" width={96} height={96} alt="" aria-hidden />
      <nav className="app-footer__legal" aria-label="Legal">
        <a href={LEGAL_PATHS.privacy} onClick={(event) => handleLegalClick(event, 'privacy')}>
          Privacy Policy
        </a>
        <a href={LEGAL_PATHS.terms} onClick={(event) => handleLegalClick(event, 'terms')}>
          Terms of Service
        </a>
        <a href={LEGAL_PATHS.contact} onClick={(event) => handleLegalClick(event, 'contact')}>
          Contact
        </a>
      </nav>
      <span>Corranzo Beta v{BETA_VERSION}</span>
      <span>
        Feedback:{' '}
        <a href={FEEDBACK_MAILTO}>{FEEDBACK_EMAIL}</a>
      </span>
      <span>Uploads and practice stats stay on your device.</span>
      <span>Built for piano practice. More instruments later.</span>
    </footer>
  )
}
