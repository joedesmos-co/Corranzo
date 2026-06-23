import { FEEDBACK_MAILTO } from '../features/beta/betaInfo.js'

export default function FeedbackLink({
  className = '',
  label = 'Email feedback',
}) {
  return (
    <a
      className={`feedback-link ${className}`.trim()}
      href={FEEDBACK_MAILTO}
      title="Open your email app with a feedback template"
    >
      {label}
    </a>
  )
}
