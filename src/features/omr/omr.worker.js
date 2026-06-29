import {
  deserializeOmrImageFromWorker,
} from './omrPixelBuffer.js'
import { omrDebugStep } from './omrDebug.js'
import { omrTrace } from './omrTrace.js'
import { processOmrPageAnalysis } from './processOmrPage.js'

self.onmessage = (event) => {
  const traceRunId = event.data?.traceRunId ?? null
  omrTrace('worker:onmessage-start', {
    hasPixels: Array.isArray(event.data?.pixels),
    width: event.data?.width,
    height: event.data?.height,
  }, traceRunId)

  try {
    const { width, height, pixels, pageOptions } = event.data

    omrTrace('worker:before-deserialize', { pixelCount: pixels?.length ?? 0 }, traceRunId)

    const imageData = deserializeOmrImageFromWorker(
      { width, height, pixels },
      'worker:deserialize',
    )

    omrDebugStep('worker:after-deserialize', imageData)
    omrTrace('worker:before-processOmrPage', { page: pageOptions?.page }, traceRunId)

    const result = processOmrPageAnalysis(imageData, pageOptions)

    omrTrace('worker:after-processOmrPage', {
      notes: result?.stats?.notes ?? 0,
      systems: result?.stats?.systems ?? 0,
    }, traceRunId)

    self.postMessage({ result, traceRunId })
    omrTrace('worker:result-posted', null, traceRunId)
  } catch (error) {
    omrTrace('worker:error', {
      message: error?.message ?? String(error),
      stack: error?.stack,
    }, traceRunId)
    self.postMessage({
      error: error?.message ?? 'OMR worker failed.',
      traceRunId,
    })
  }
}
