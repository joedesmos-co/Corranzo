import { describe, expect, it } from 'vitest'
import { musicXmlSourceKey } from '../src/features/import/musicXmlSource.js'
import { contentIdentitySync } from '../src/features/library/scoreSourceContentIdentity.js'

describe('musicXml content identity', () => {
  it('changes the source key when bytes change even if filename and length match', () => {
    const fileName = 'score.omr.musicxml'
    const a = new TextEncoder().encode('<score-partwise><!--aaaa--></score-partwise>')
    const b = new TextEncoder().encode('<score-partwise><!--bbbb--></score-partwise>')
    expect(a.byteLength).toBe(b.byteLength)

    const keyA = musicXmlSourceKey({
      fileName,
      data: a.buffer,
      source: 'omr',
      ownerPdfIdentity: 'a.pdf::1::1',
      omrMeta: { durationSeconds: 16 },
    })
    const keyB = musicXmlSourceKey({
      fileName,
      data: b.buffer,
      source: 'omr',
      ownerPdfIdentity: 'b.pdf::2::2',
      omrMeta: { durationSeconds: 16 },
    })

    expect(contentIdentitySync(a.buffer).hash).not.toBe(contentIdentitySync(b.buffer).hash)
    expect(keyA).not.toBe(keyB)
    expect(keyA).toContain(contentIdentitySync(a.buffer).hash)
    expect(keyB).toContain(contentIdentitySync(b.buffer).hash)
  })
})
