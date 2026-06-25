import { describe, expect, it } from 'vitest'
import {
  BETA_LABEL,
  BETA_VERSION,
  FEEDBACK_BODY,
  FEEDBACK_EMAIL,
  FEEDBACK_MAILTO,
  FEEDBACK_SUBJECT,
  LOCAL_ONLY_MESSAGE,
} from '../src/features/beta/betaInfo.js'

describe('public beta polish', () => {
  it('builds a prefilled email feedback link', () => {
    expect(BETA_LABEL).toBe('Public beta')
    expect(BETA_VERSION).toBe('0.2.0')
    expect(FEEDBACK_EMAIL).toBe('joedesmos.co@gmail.com')
    expect(FEEDBACK_SUBJECT).toBe('Corranzo beta feedback')
    expect(FEEDBACK_BODY).toContain('Device/browser:')
    expect(FEEDBACK_BODY).toContain('What broke or confused me:')
    expect(FEEDBACK_BODY).toContain('Score file type used:')
    expect(FEEDBACK_MAILTO).toBe(
      `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
        FEEDBACK_SUBJECT,
      )}&body=${encodeURIComponent(FEEDBACK_BODY)}`,
    )
  })

  it('keeps the local-only explanation short and explicit', () => {
    expect(LOCAL_ONLY_MESSAGE).toContain('stay in this browser')
    expect(LOCAL_ONLY_MESSAGE).toContain('No account or cloud sync')
  })
})
