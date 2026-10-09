import { FEEDBACK_EMAIL } from '../beta/betaInfo.js'

export const CONTACT_EMAIL = FEEDBACK_EMAIL
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`

/**
 * Third-party sample libraries behind instrument playback. Every entry is
 * used under its stated license; the Terms page renders these credits for
 * CC-BY attribution compliance. Keep in sync with TermsOfServicePage.
 */
export const SOUND_CREDITS = Object.freeze([
  {
    work: 'Salamander Grand Piano (Yamaha C5 recordings)',
    author: 'Alexander Holm',
    license: 'CC-BY-3.0',
    usedFor: ['piano'],
  },
  {
    work: 'tonejs-instruments guitar samples (acoustic, clean electric)',
    author: 'Nicholaus P. Brosowsky',
    license: 'CC-BY-3.0',
    usedFor: ['guitar', 'electric-guitar'],
  },
])
