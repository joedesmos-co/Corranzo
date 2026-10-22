import { FEEDBACK_EMAIL } from '../beta/betaInfo.js'

export const CONTACT_EMAIL = FEEDBACK_EMAIL
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`

/**
 * Third-party sample libraries behind instrument playback.
 *
 * Every entry below was verified against the ORIGINATING owner's terms,
 * not only against the license claim of whichever repository redistributed
 * the files. The previous clean-electric entry ("tonejs-instruments, CC-BY-3.0")
 * was exactly that mistake: the wrapper repo claims CC-BY-3.0 for its
 * samples, but its own sample-source-info.txt credits the electric guitar
 * set to Karoryfer, a commercial vendor whose terms could not be confirmed
 * for that set. It has been replaced with a set whose licence is verifiable
 * directly from the owner.
 *
 * Legal status per asset:
 *   Salamander Grand Piano      CC-BY-3.0, attribution required (given here).
 *   Iowa acoustic guitar        "freely available ... may be downloaded and
 *                               used for any projects, without restrictions"
 *                               (University of Iowa EMS). No obligation.
 *   Emilyguitar (clean electric) CC0-1.0 public domain dedication, published
 *                               by Karoryfer Lecolds. No attribution required;
 *                               credited here as courtesy.
 *
 * Keep in sync with TermsOfServicePage's "Sound credits" section.
 */
export const SOUND_CREDITS = Object.freeze([
  {
    work: 'Salamander Grand Piano (Yamaha C5 recordings)',
    author: 'Alexander Holm',
    license: 'CC-BY-3.0',
    attributionRequired: true,
    usedFor: ['piano'],
    verifiedFrom: 'sfzinstruments/SalamanderGrandPiano LICENSE + README',
  },
  {
    work: 'Acoustic guitar samples',
    author: 'University of Iowa Electronic Music Studios (Lawrence Fritts)',
    license: 'Free for any project, without restrictions',
    attributionRequired: false,
    usedFor: ['guitar'],
    verifiedFrom: 'theremin.music.uiowa.edu — Musical Instrument Samples',
  },
  {
    work: 'Emilyguitar — clean electric guitar samples (Epiphone Emily the Strange)',
    author: 'Karoryfer Lecolds (D. Smolken), 2014',
    license: 'CC0-1.0',
    attributionRequired: false,
    usedFor: ['electric-guitar'],
    verifiedFrom: 'github.com/sfzinstruments/karoryfer.emilyguitar LICENSE + readme.txt',
  },
])
