export const IMPORT_MODE_HELP = {
  preview: 'Listen and follow.',
  'play-along': 'Play with the score while Corranzo keeps time.',
  'wait-for-you': 'Corranzo waits for you before moving on.',
}

export function describePreparation(status, progress = null) {
  const page = Number(progress?.page)
  const count = Number(progress?.pageCount)
  const detail = page > 0 && count >= page ? `Page ${page} of ${count}` : 'This can take a moment. Keep this page open.'
  if (status === 'building-playback') return { step: 2, title: 'Preparing playback', detail }
  if (status === 'ready') return { step: 2, title: 'Checking your score', detail: 'Making sure the score is ready to open.' }
  if (progress?.phase === 'preprocess') return { step: 0, title: 'Reading your score', detail: page > 0 ? `Cleaning up page ${page}${count >= page ? ` of ${count}` : ''}` : detail }
  if (status === 'detecting-notes') return { step: 1, title: 'Understanding the notation', detail }
  return { step: 0, title: 'Reading your score', detail }
}

/** Only describe diagnoses the existing processor supplies; never infer blur from confidence. */
export function describePreparationFailure(error) {
  const raw = [error?.code, error?.stage, error?.message, ...(error?.difficulty?.reasons ?? []), ...(error?.acceptance?.rejectReasons ?? []), ...(error?.quality?.rejectReasons ?? [])].filter(Boolean).join(' ')
  if (/password|encrypt/i.test(raw)) return { title: 'This PDF is locked', message: 'Export an unlocked copy, then choose that PDF.', quality: false }
  if (/invalid pdf|no.pages|empty pdf|missing pdf|pdf.*corrupt|invalidpdf/i.test(raw)) return { title: 'We couldn’t open this PDF', message: 'Try opening it in a PDF reader, then export a fresh copy.', quality: false }
  if (/blur|clipp|low.resolution|distort|too[ _-]difficult|confidence|no.notes|no.systems|sparse.notes|inconsistent.layout|empty.pages/i.test(raw)) return {
    title: 'We couldn’t read enough of the score',
    message: 'Playback isn’t ready. Try a clearer copy with sharp notes, complete page edges and even lighting. For a photo, keep the camera square to the page, then save it as a PDF.',
    quality: true,
  }
  if (/timeout|timed out|took too long/i.test(raw)) return { title: 'This score needs another try', message: 'Preparation took too long. Try again, or choose a smaller PDF with fewer pages.', quality: false }
  return { title: 'We couldn’t prepare playback', message: 'Your PDF is still here. Try again, or choose another copy of the score.', quality: false }
}

export function importFileNotice(file) {
  if (/\.(png|jpe?g|heic|webp|tiff?)$/i.test(file?.name ?? '') || file?.type?.startsWith('image/')) {
    return `${file.name}: image files can’t be opened directly. Save or print the image as a PDF, then import that copy.`
  }
  return `${file?.name ?? 'This file'} isn’t supported. Choose a PDF, or use Advanced for MusicXML/MXL and MIDI files.`
}
