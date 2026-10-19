import { loadSessionMeta, saveSessionMeta } from './sessionPersistence.js'

/** Save navigation immediately without rewriting files or another score's metadata. */
export function updateSavedSessionView(activeView, pdfMeta, instrumentId, musicXmlSource = null) {
  const saved = loadSessionMeta()
  if (!saved || !saved.meta) return false
  const meta = saved.meta
  // Score identity: prefer pdfMeta, fall back to the MusicXML source (e.g. an
  // Audio Vision arrangement with no PDF).
  const scoreFileName = pdfMeta?.fileName ?? musicXmlSource?.fileName ?? meta.musicXmlFileName
  const scoreSize = pdfMeta?.size ?? musicXmlSource?.data?.byteLength ?? meta.musicXmlSize
  if (!scoreFileName) return false
  const sameFile =
    meta.pdfMeta?.fileName
      ? meta.pdfMeta.fileName === scoreFileName && meta.pdfMeta.size === scoreSize
      : meta.musicXmlFileName === scoreFileName && meta.musicXmlSize === scoreSize
  if (!sameFile || (meta.instrumentId ?? 'piano') !== (instrumentId ?? 'piano')) return false
  if (meta.activeView === activeView) return true
  return saveSessionMeta({ ...meta, activeView, savedAt: Date.now() })
}
