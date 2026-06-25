export const BETA_LABEL = 'Public beta'
export const BETA_VERSION = '0.2.0'
export const FEEDBACK_EMAIL = 'joedesmos.co@gmail.com'
export const FEEDBACK_SUBJECT = 'Corranzo beta feedback'

export const FEEDBACK_BODY = `Device/browser:
What I tried:
What worked:
What broke or confused me:
Score file type used:
Any other notes:`

export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
  FEEDBACK_SUBJECT,
)}&body=${encodeURIComponent(FEEDBACK_BODY)}`

export const LOCAL_ONLY_MESSAGE =
  'Your score files and practice history stay in this browser. No account or cloud sync.'
