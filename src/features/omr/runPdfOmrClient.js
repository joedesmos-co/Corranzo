import { runPdfOmrPipeline } from './runPdfOmrPipeline.js'
import {
  assertPixelViewReadable,
  copyOmrPixels,
  serializeOmrImageForWorker,
} from './omrPixelBuffer.js'
import { resolveOmrPdfSource, describePdfSourceType, isPdfBufferAttached } from './omrPdfSource.js'
import { omrDebugStep } from './omrDebug.js'
import { omrTrace } from './omrTrace.js'

let activeWorker = null

function terminateActiveWorker() {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
}

function createWorkerAnalyzer(signal, traceRunId = null) {
  terminateActiveWorker()
  omrTrace('client:createWorker', null, traceRunId)
  const worker = new Worker(new URL('./omr.worker.js', import.meta.url), { type: 'module' })
  activeWorker = worker
  omrTrace('client:worker-created', { url: './omr.worker.js' }, traceRunId)

  let pending = null

  worker.onmessage = (event) => {
    omrTrace('client:worker-onmessage', {
      hasError: Boolean(event.data?.error),
      hasResult: Boolean(event.data?.result),
      error: event.data?.error ?? null,
    }, traceRunId)

    const current = pending
    pending = null
    if (!current) {
      return
    }
    current.cleanupAbort?.()
    if (event.data?.error) {
      current.reject(new Error(event.data.error))
      return
    }
    current.resolve(event.data.result)
  }

  worker.onerror = (error) => {
    omrTrace('client:worker-onerror', {
      message: error?.message ?? String(error),
    }, traceRunId)
    const current = pending
    pending = null
    if (!current) {
      return
    }
    current.cleanupAbort?.()
    current.reject(error)
  }

  return (imageData, pageOptions) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('OMR generation cancelled.', 'AbortError'))
        return
      }

      let abortHandler = null
      const cleanupAbort = () => {
        if (abortHandler) {
          signal?.removeEventListener('abort', abortHandler)
          abortHandler = null
        }
      }

      abortHandler = () => {
        cleanupAbort()
        pending = null
        terminateActiveWorker()
        reject(new DOMException('OMR generation cancelled.', 'AbortError'))
      }
      signal?.addEventListener('abort', abortHandler, { once: true })

      pending = { resolve, reject, cleanupAbort }

      try {
        omrTrace('client:before-worker-postMessage', {
          page: pageOptions?.page,
          width: imageData.width,
          height: imageData.height,
        }, traceRunId)
        assertPixelViewReadable(imageData.data, 'client:before-worker-postMessage')

        const payload = serializeOmrImageForWorker(imageData, 'client:serialize-for-worker')
        omrDebugStep('client:serialized-payload', null, {
          width: payload.width,
          height: payload.height,
          pixelCount: payload.pixels.length,
        })

        omrTrace('client:postMessage', {
          page: pageOptions?.page,
          pixelCount: payload.pixels.length,
        }, traceRunId)
        worker.postMessage({
          width: payload.width,
          height: payload.height,
          pixels: payload.pixels,
          pageOptions,
          traceRunId,
        })

        omrDebugStep('client:after-worker-postMessage', imageData, { page: pageOptions?.page })
      } catch (error) {
        omrTrace('client:postMessage-sync-error', {
          message: error?.message ?? String(error),
          stack: error?.stack,
        }, traceRunId)
        cleanupAbort()
        pending = null
        reject(error)
      }
    })
}

/**
 * Run experimental OMR off the main thread when workers are available.
 */
export async function runPdfOmrClient(pdfSource, options = {}) {
  const { signal, useWorker = true, traceRunId = null, pdfFileUrl = null, ...rest } = options
  const canUseWorker = useWorker && typeof Worker !== 'undefined'
  omrTrace('client:runPdfOmrClient:enter', { useWorker: canUseWorker }, traceRunId)

  try {
    const ownedPdfSource = await resolveOmrPdfSource({
      pdfSource,
      pdfFileUrl,
      traceRunId,
    })
    return await runPdfOmrPipeline(ownedPdfSource, {
      ...rest,
      signal,
      traceRunId,
      analyzePage: canUseWorker ? createWorkerAnalyzer(signal, traceRunId) : null,
    })
  } finally {
    terminateActiveWorker()
    omrTrace('client:runPdfOmrClient:exit', null, traceRunId)
  }
}

export function cancelActiveOmrWorker() {
  terminateActiveWorker()
}

export { copyOmrPixels, describePdfSourceType, isPdfBufferAttached }
