import { describe, expect, it } from 'vitest'

import { reuseOwnedPdfPracticeSource } from '../src/features/import/pdfPracticeSource.js'

describe('PDF practice source reuse', () => {
  it('keeps valid owned bytes and the existing viewer URL', () => {
    const pdfBuffer = new Uint8Array([37, 80, 68, 70]).buffer
    expect(
      reuseOwnedPdfPracticeSource({ pdfFile: 'blob:score', pdfBuffer }),
    ).toEqual({
      pdfFile: 'blob:score',
      pdfBuffer,
      byteLength: 4,
      reused: true,
    })
  })

  it('requires both a viewer URL and readable non-empty bytes', () => {
    expect(reuseOwnedPdfPracticeSource({ pdfFile: null, pdfBuffer: new ArrayBuffer(4) })).toBeNull()
    expect(reuseOwnedPdfPracticeSource({ pdfFile: 'blob:score', pdfBuffer: null })).toBeNull()
    expect(
      reuseOwnedPdfPracticeSource({ pdfFile: 'blob:score', pdfBuffer: new ArrayBuffer(0) }),
    ).toBeNull()
  })
})
