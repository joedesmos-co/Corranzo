import { describe, expect, it } from 'vitest'
import {
  resolveWfyDisplayStatus,
  labelForWfyDisplayStatus,
  WFY_DISPLAY_STATUS,
} from '../src/features/practice/waitForYouDisplayStatus.js'
import { WFY_STATUS } from '../src/features/practice/waitForYouEngine.js'
import { WFY_INPUT_OUTCOME } from '../src/features/practice/waitForYouInputFeedback.js'

describe('resolveWfyDisplayStatus', () => {
  it('returns inactive when mode is off', () => {
    expect(resolveWfyDisplayStatus({ active: false, engineStatus: WFY_STATUS.WAITING }))
      .toBe(WFY_DISPLAY_STATUS.INACTIVE)
  })

  it('shows continuing during the advance transition', () => {
    expect(
      resolveWfyDisplayStatus({
        active: true,
        engineStatus: WFY_STATUS.WAITING,
        displayPhase: 'continuing',
      }),
    ).toBe(WFY_DISPLAY_STATUS.CONTINUING)
  })

  it('shows correct after a matched note', () => {
    expect(
      resolveWfyDisplayStatus({
        active: true,
        engineStatus: WFY_STATUS.WAITING,
        inputFeedback: { outcome: WFY_INPUT_OUTCOME.CORRECT },
      }),
    ).toBe(WFY_DISPLAY_STATUS.CORRECT)
  })

  it('shows missed on wrong input', () => {
    expect(
      resolveWfyDisplayStatus({
        active: true,
        engineStatus: WFY_STATUS.WAITING,
        inputFeedback: { outcome: WFY_INPUT_OUTCOME.WRONG },
      }),
    ).toBe(WFY_DISPLAY_STATUS.MISSED)
  })

  it('exposes human labels', () => {
    expect(labelForWfyDisplayStatus(WFY_DISPLAY_STATUS.WAITING)).toBe('Waiting')
    expect(labelForWfyDisplayStatus(WFY_DISPLAY_STATUS.MISSED)).toBe('Missed / late')
  })
})
