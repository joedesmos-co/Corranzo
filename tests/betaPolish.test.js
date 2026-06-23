import { describe, expect, it } from 'vitest'
import {
  BETA_VERSION,
  FEEDBACK_TEMPLATE,
  LOCAL_ONLY_MESSAGE,
} from '../src/features/beta/betaInfo.js'

describe('private beta polish', () => {
  it('provides a self-contained feedback prompt without a fragile external link', () => {
    expect(FEEDBACK_TEMPLATE).toContain(`v${BETA_VERSION}`)
    expect(FEEDBACK_TEMPLATE).toContain('What happened:')
    expect(FEEDBACK_TEMPLATE).toContain('Browser / device:')
    expect(FEEDBACK_TEMPLATE).not.toContain('http')
  })

  it('keeps the local-only explanation short and explicit', () => {
    expect(LOCAL_ONLY_MESSAGE).toContain('stay in this browser')
    expect(LOCAL_ONLY_MESSAGE).toContain('No account or cloud sync')
  })
})
