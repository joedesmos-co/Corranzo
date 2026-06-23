import {
  BETA_VERSION,
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO,
} from '../features/beta/betaInfo.js'

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <span>ScoreFlow Beta v{BETA_VERSION}</span>
      <span>
        Feedback:{' '}
        <a href={FEEDBACK_MAILTO}>{FEEDBACK_EMAIL}</a>
      </span>
      <span>Uploads and practice stats stay on your device.</span>
      <span>Built for piano practice. More instruments later.</span>
    </footer>
  )
}
