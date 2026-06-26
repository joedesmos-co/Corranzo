import { describe, expect, it } from 'vitest'
import { buildUploadNotices } from '../src/features/import/classifyUploadFiles.js'

describe('restore upload gate pending kinds', () => {
  it('queues one pending upload per kind without overwriting others', () => {
    const pending = { pdf: null, musicXml: null, midi: null }
    pending.pdf = { file: 'score.pdf' }
    pending.musicXml = { file: 'piece.mxl' }
    pending.midi = { file: 'piece.mid' }

    expect(pending.pdf.file).toBe('score.pdf')
    expect(pending.musicXml.file).toBe('piece.mxl')
    expect(pending.midi.file).toBe('piece.mid')
  })

  it('classified upload notices still report ignored extras', () => {
    const notices = buildUploadNotices({
      pdf: [{ name: 'a.pdf' }, { name: 'b.pdf' }],
      musicXml: [],
      midi: [],
      unsupported: [],
    })
    expect(notices).toContain('Using the first PDF. Extra PDFs ignored.')
  })
})
