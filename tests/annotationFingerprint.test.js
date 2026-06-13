import { describe, expect, it } from 'vitest'
import {
  LEGACY_BROKEN_FINGERPRINT,
  resolveAnnotationFingerprint,
} from '../src/hooks/useAnnotationPersistence.js'
import { buildPdfFingerprint } from '../src/features/score-follow/scoreFollowStorage.js'

/**
 * Regression: PdfViewer passes an object-URL *string* as `file`, so the old
 * `getFileFingerprint(file)` produced "undefined::undefined::undefined" and
 * every PDF shared one annotation bucket. Annotations must be keyed by the
 * same fileName::size::lastModified identity used by score-follow anchors.
 */
describe('annotation storage fingerprint', () => {
  const meta = { fileName: 'Minuet in G.pdf', size: 180708, lastModified: 1779285471477 }

  it('uses pdfMeta identity, matching the score-follow fingerprint', () => {
    const fingerprint = resolveAnnotationFingerprint({
      pdfMeta: meta,
      file: 'blob:http://localhost/abc-123',
    })
    expect(fingerprint).toBe('Minuet in G.pdf::180708::1779285471477')
    expect(fingerprint).toBe(buildPdfFingerprint(meta))
  })

  it('never derives a fingerprint from an object-URL string', () => {
    const fingerprint = resolveAnnotationFingerprint({
      pdfMeta: null,
      file: 'blob:http://localhost/abc-123',
    })
    expect(fingerprint).toBeNull()
    expect(fingerprint).not.toBe(LEGACY_BROKEN_FINGERPRINT)
  })

  it('falls back to a real File-like object when no meta exists', () => {
    const fingerprint = resolveAnnotationFingerprint({
      pdfMeta: null,
      file: { name: 'score.pdf', size: 1234, lastModified: 99 },
    })
    expect(fingerprint).toBe('score.pdf::1234::99')
  })

  it('returns null (skip persistence) when no identity is available', () => {
    expect(resolveAnnotationFingerprint({ pdfMeta: null, file: null })).toBeNull()
    expect(resolveAnnotationFingerprint({ pdfMeta: {}, file: undefined })).toBeNull()
  })
})
