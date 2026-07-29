/**
 * PDF analysis cache must not collapse distinct OMR sources onto one key.
 */
import { describe, expect, it } from 'vitest'
import {
  clearPdfAnalysisCache,
  pdfAnalysisCacheKey,
  pdfBytesContentHash,
  pinPdfAnalysisCache,
  unpinPdfAnalysisCache,
} from '../src/features/score-follow/pdfPageAnalysis.js'

describe('pdfAnalysisCacheKey', () => {
  it('distinguishes OMR { data: Uint8Array } sources by content, not only length', () => {
    const a = { data: new Uint8Array(1000) }
    const b = { data: new Uint8Array(2000) }
    expect(pdfAnalysisCacheKey(a)).not.toBe(pdfAnalysisCacheKey(b))
    expect(pdfAnalysisCacheKey(a)).toMatch(/^bytes:1000:[0-9a-f]{8}$/)
    expect(pdfAnalysisCacheKey(b)).toMatch(/^bytes:2000:[0-9a-f]{8}$/)
  })

  it('distinguishes same-length PDFs with different bytes', () => {
    const a = new Uint8Array(64).fill(1)
    const b = new Uint8Array(64).fill(2)
    expect(pdfBytesContentHash(a)).not.toBe(pdfBytesContentHash(b))
    expect(pdfAnalysisCacheKey({ data: a })).not.toBe(pdfAnalysisCacheKey({ data: b }))
  })

  it('does not use the constant "buffer" key for data objects', () => {
    const source = { data: new Uint8Array(512) }
    expect(pdfAnalysisCacheKey(source)).not.toBe('buffer')
  })

  it('prefers scoreId + pdfHash when provided', () => {
    const bytes = { data: new Uint8Array(128) }
    expect(pdfAnalysisCacheKey(bytes, { scoreId: 's1', pdfHash: 'abc' })).toBe(
      'score:s1:pdf:abc',
    )
  })

  it('distinguishes ArrayBuffers by length', () => {
    expect(pdfAnalysisCacheKey(new ArrayBuffer(8))).not.toBe(
      pdfAnalysisCacheKey(new ArrayBuffer(16)),
    )
  })

  it('prefixes blob URLs so they do not collide with byte keys', () => {
    expect(pdfAnalysisCacheKey('blob:http://localhost/a')).toMatch(/^url:/)
  })

  it('toBytes copies views so cache keys do not share a transferable buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const keyBefore = pdfAnalysisCacheKey({ data: bytes })
    // Simulate pdf.js transfer/detach of a *different* consumer copy — the
    // caller's bytes must still hash identically after the pipeline pattern.
    const consumerCopy = new Uint8Array(bytes)
    try {
      const channel = new MessageChannel()
      channel.port1.postMessage(consumerCopy.buffer, [consumerCopy.buffer])
    } catch {
      // Transfer may be unavailable; still assert caller bytes stay hashable.
    }
    expect(pdfAnalysisCacheKey({ data: bytes })).toBe(keyBefore)
    expect(bytes.byteLength).toBe(8)
  })
})

describe('clearPdfAnalysisCache pin guard', () => {
  it('skips clear while pinned and clears after unpin', () => {
    pinPdfAnalysisCache('run-1', { scoreId: 's' })
    const skipped = clearPdfAnalysisCache({ reason: 'test-while-pinned' })
    expect(skipped).toEqual({ cleared: false, reason: 'pinned' })
    unpinPdfAnalysisCache('run-1', { scoreId: 's' })
    const cleared = clearPdfAnalysisCache({ reason: 'test-after-unpin' })
    expect(cleared).toEqual({ cleared: true })
  })
})
