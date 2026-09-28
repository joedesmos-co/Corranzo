import { describe, expect, it } from 'vitest'
import { describePreparation, describePreparationFailure, importFileNotice, IMPORT_MODE_HELP } from '../src/features/import/importPresentation.js'
import { classifyUploadFile, UPLOAD_KIND } from '../src/features/import/classifyUploadFiles.js'

describe('truthful import presentation', () => {
  it('uses real phases and page counts, without inferred percentages', () => {
    expect(describePreparation('analyzing', { phase: 'preprocess', page: 2, pageCount: 4 })).toEqual({ step: 0, title: 'Reading your score', detail: 'Cleaning up page 2 of 4' })
    expect(describePreparation('detecting-notes', { phase: 'detect', page: 3, pageCount: 4 })).toEqual({ step: 1, title: 'Understanding the notation', detail: 'Page 3 of 4' })
    expect(describePreparation('building-playback')).toMatchObject({ step: 2, title: 'Preparing playback' })
    expect(describePreparation('ready').title).toBe('Checking your score')
    expect(describePreparation('analyzing').detail).not.toMatch(/\d|%/)
  })
  it('offers practical quality guidance without asserting an unsupported diagnosis', () => {
    const result = describePreparationFailure({ quality: { rejectReasons: ['low-confidence', 'sparse-notes'] } })
    expect(result.quality).toBe(true)
    expect(result.message).toContain('Playback isn’t ready')
    expect(result.message).toContain('sharp notes, complete page edges and even lighting')
    expect(result.message).not.toMatch(/your (photo|scan) is blurry/i)
  })
  it.each([
    [{ name: 'InvalidPDFException', message: 'Invalid PDF structure' }, 'We couldn’t open this PDF'],
    [{ message: 'Password required' }, 'This PDF is locked'],
    [{ code: 'OMR_TOO_DIFFICULT' }, 'We couldn’t read enough of the score'],
    [{ message: 'Worker timed out' }, 'This score needs another try'],
    [{ message: 'Internal recognition graph exploded at checkpoint 19' }, 'We couldn’t prepare playback'],
  ])('keeps recovery actionable and technical exceptions out of normal copy', (error, title) => {
    const result = describePreparationFailure(error)
    expect(result.title).toBe(title)
    expect(result.message).not.toMatch(/graph|checkpoint|OMR|timing asset/)
  })
  it('does not classify an image or unrelated binary as optional notation', () => {
    for (const name of ['photo.png', 'recording.mp3', 'unrelated.bin']) {
      expect(classifyUploadFile({ name, type: 'application/octet-stream' })).toBe(UPLOAD_KIND.UNSUPPORTED)
    }
    expect(classifyUploadFile({ name: 'score.mxl', type: 'application/octet-stream' })).toBe(UPLOAD_KIND.MUSICXML)
    expect(importFileNotice({ name: 'photo.heic' })).toContain('Save or print the image as a PDF')
  })
  it('teaches only the approved modes', () => {
    expect(Object.keys(IMPORT_MODE_HELP)).toEqual(['preview', 'play-along', 'wait-for-you'])
    expect(IMPORT_MODE_HELP.preview).toBe('Listen and follow.')
  })
})
