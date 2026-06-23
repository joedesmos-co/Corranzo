/**
 * Multi-file upload classification: sorting dropped/selected files to the right
 * existing import handler, with first-wins + skip warnings. Pure logic; the
 * React box is a thin wrapper over these functions.
 */
import { describe, expect, it } from 'vitest'
import {
  UPLOAD_KIND,
  classifyUploadFile,
  classifyUploadFiles,
  buildUploadNotices,
  applyClassifiedUploads,
} from '../src/features/import/classifyUploadFiles.js'

const file = (name, type = '') => ({ name, type })

describe('classifyUploadFile — by extension', () => {
  it('detects PDF', () => {
    expect(classifyUploadFile(file('score.pdf'))).toBe(UPLOAD_KIND.PDF)
  })
  it('detects MIDI (.mid and .midi)', () => {
    expect(classifyUploadFile(file('song.mid'))).toBe(UPLOAD_KIND.MIDI)
    expect(classifyUploadFile(file('song.midi'))).toBe(UPLOAD_KIND.MIDI)
  })
  it('detects score timing (.mxl, .musicxml, .xml)', () => {
    expect(classifyUploadFile(file('s.mxl'))).toBe(UPLOAD_KIND.MUSICXML)
    expect(classifyUploadFile(file('s.musicxml'))).toBe(UPLOAD_KIND.MUSICXML)
    expect(classifyUploadFile(file('s.xml'))).toBe(UPLOAD_KIND.MUSICXML)
  })
  it('routes MuseScore source files to the MusicXML handler', () => {
    expect(classifyUploadFile(file('s.mscz'))).toBe(UPLOAD_KIND.MUSICXML)
    expect(classifyUploadFile(file('s.mscx'))).toBe(UPLOAD_KIND.MUSICXML)
  })
  it('marks unknown extensions unsupported', () => {
    expect(classifyUploadFile(file('notes.txt'))).toBe(UPLOAD_KIND.UNSUPPORTED)
    expect(classifyUploadFile(null)).toBe(UPLOAD_KIND.UNSUPPORTED)
  })

  it('uses the extension even when MIME is ambiguous (a .mid reported as octet-stream)', () => {
    // Regression: application/octet-stream also appears in the score-timing MIME
    // list, so MIME-first would misfile a MIDI as a score. Extension wins.
    expect(classifyUploadFile(file('song.mid', 'application/octet-stream'))).toBe(UPLOAD_KIND.MIDI)
    expect(classifyUploadFile(file('book.mxl', 'application/octet-stream'))).toBe(
      UPLOAD_KIND.MUSICXML,
    )
  })
})

describe('classifyUploadFile — MIME fallback when no extension', () => {
  it('falls back to MIME for extensionless files', () => {
    expect(classifyUploadFile(file('blob', 'application/pdf'))).toBe(UPLOAD_KIND.PDF)
    expect(classifyUploadFile(file('blob', 'audio/midi'))).toBe(UPLOAD_KIND.MIDI)
    expect(classifyUploadFile(file('blob', 'application/vnd.recordare.musicxml+xml'))).toBe(
      UPLOAD_KIND.MUSICXML,
    )
    expect(classifyUploadFile(file('blob', 'text/plain'))).toBe(UPLOAD_KIND.UNSUPPORTED)
  })
})

describe('classifyUploadFiles — grouping', () => {
  it('groups by type and preserves order', () => {
    const result = classifyUploadFiles([
      file('a.pdf'),
      file('b.mxl'),
      file('c.mid'),
      file('d.pdf'),
      file('e.txt'),
    ])
    expect(result.pdf.map((f) => f.name)).toEqual(['a.pdf', 'd.pdf'])
    expect(result.musicXml.map((f) => f.name)).toEqual(['b.mxl'])
    expect(result.midi.map((f) => f.name)).toEqual(['c.mid'])
    expect(result.unsupported.map((f) => f.name)).toEqual(['e.txt'])
  })

  it('handles an empty / nullish selection', () => {
    expect(classifyUploadFiles([])).toEqual({ pdf: [], musicXml: [], midi: [], unsupported: [] })
    expect(classifyUploadFiles(null)).toEqual({ pdf: [], musicXml: [], midi: [], unsupported: [] })
  })
})

describe('buildUploadNotices', () => {
  it('no notices for a clean single-of-each set', () => {
    const classified = classifyUploadFiles([file('a.pdf'), file('b.mxl'), file('c.mid')])
    expect(buildUploadNotices(classified)).toEqual([])
  })

  it('warns about extra duplicates of the same type', () => {
    const classified = classifyUploadFiles([file('a.pdf'), file('b.pdf')])
    expect(buildUploadNotices(classified)).toContain('Using the first PDF. Extra PDFs ignored.')
  })

  it('lists unsupported files by name', () => {
    const classified = classifyUploadFiles([file('a.pdf'), file('weird.txt')])
    expect(buildUploadNotices(classified)).toContain('Unsupported file skipped: weird.txt')
  })
})

describe('applyClassifiedUploads — routes first valid of each type', () => {
  it('sends the first of each type to the matching handler and returns notices', () => {
    const pdf = []
    const xml = []
    const midi = []
    const classified = classifyUploadFiles([
      file('first.pdf'),
      file('second.pdf'),
      file('score.musicxml'),
      file('back.mid'),
      file('junk.bin'),
    ])

    const notices = applyClassifiedUploads(classified, {
      onPdf: (f) => pdf.push(f.name),
      onMusicXml: (f) => xml.push(f.name),
      onMidi: (f) => midi.push(f.name),
    })

    expect(pdf).toEqual(['first.pdf']) // first wins, second ignored
    expect(xml).toEqual(['score.musicxml'])
    expect(midi).toEqual(['back.mid'])
    expect(notices).toContain('Using the first PDF. Extra PDFs ignored.')
    expect(notices).toContain('Unsupported file skipped: junk.bin')
  })

  it('does not call handlers for absent types', () => {
    let pdfCalls = 0
    applyClassifiedUploads(classifyUploadFiles([file('only.mid')]), {
      onPdf: () => {
        pdfCalls += 1
      },
      onMidi: () => {},
    })
    expect(pdfCalls).toBe(0)
  })
})
