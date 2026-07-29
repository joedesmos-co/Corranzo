import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  OMR_ACCEPTANCE,
  OMR_QUALITY_WARNING_MESSAGE,
} from '../src/features/omr/assessOmrAcceptance.js'

const root = join(import.meta.dirname, '..')
function readSrc(...parts) {
  return readFileSync(join(root, 'src', ...parts), 'utf8')
}

describe('OMR quality warning UI contracts', () => {
  it('banner is score-owned and dismissible without alarming copy', () => {
    const banner = readSrc('components', 'practice', 'OmrQualityWarningBanner.jsx')
    expect(banner).toContain('ownerScoreId')
    expect(banner).toContain('dismissedScoreIds')
    expect(banner).toContain('OMR_ACCEPTANCE.WARNING')
    expect(banner).toContain('Dismiss')
    expect(banner).not.toMatch(/corrupt|unsafe/i)
    expect(OMR_QUALITY_WARNING_MESSAGE).toMatch(/Compare with the original PDF/i)
    expect(OMR_QUALITY_WARNING_MESSAGE).not.toMatch(/corrupt|unsafe/i)
  })

  it('PracticeView wires score-scoped warning props', () => {
    const view = readSrc('components', 'practice', 'PracticeView.jsx')
    expect(view).toContain('OmrQualityWarningBanner')
    expect(view).toContain('omrQuality')
    expect(view).toContain('omrOwnerScoreId')
    expect(view).toContain('omrWarningDismissedScoreIds')
  })

  it('App persists quality metadata on omrMeta and scopes dismissal by score id', () => {
    const app = readSrc('App.jsx')
    expect(app).toContain('omrMeta.quality')
    expect(app).toContain('omrWarningDismissedScoreIds')
    expect(app).toContain('onDismissOmrQualityWarning')
    expect(app).toContain('omrAcceptance ?? quality?.acceptance')
  })

  it('pipeline exposes acceptance/quality without filename branches', () => {
    const pipeline = readSrc('features', 'omr', 'runPdfOmrPipeline.js')
    expect(pipeline).toContain('assessOmrAcceptance')
    expect(pipeline).toContain('acceptance: acceptanceDecision')
    expect(pipeline).toContain('quality: qualityMeta')
    expect(pipeline).not.toMatch(/bach-chorale|turkish-march|fur-elise|mutopia/i)
    expect(OMR_ACCEPTANCE.WARNING).toBe('warning')
  })
})
