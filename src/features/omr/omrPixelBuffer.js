/**
 * Explicit pixel ownership for OMR page images.
 * Never construct TypedArrays from another view's .buffer — copy elements instead.
 */

export function assertBufferNotDetached(buffer, label) {
  if (!buffer) {
    throw new Error(`[OMR ${label}] missing ArrayBuffer`)
  }
  try {
    // eslint-disable-next-line no-new
    new Uint8ClampedArray(buffer, 0, 1)
  } catch (error) {
    throw new Error(
      `[OMR ${label}] detached ArrayBuffer: ${error?.message ?? String(error)}`,
    )
  }
}

export function assertPixelViewReadable(data, label) {
  if (!data || typeof data.length !== 'number') {
    throw new Error(`[OMR ${label}] missing pixel view`)
  }
  try {
    if (data.length > 0) {
      // Touch one element and the backing buffer probe.
      // eslint-disable-next-line no-unused-expressions
      data[0]
      assertBufferNotDetached(data.buffer, `${label}-buffer`)
    }
  } catch (error) {
    if (String(error?.message ?? error).includes('[OMR ')) {
      throw error
    }
    throw new Error(
      `[OMR ${label}] cannot read pixel view: ${error?.message ?? String(error)}`,
    )
  }
}

export function describeOmrImageBuffer(imageData, label = 'image') {
  if (!imageData?.data) {
    return { label, missing: true }
  }
  try {
    assertPixelViewReadable(imageData.data, label)
    return {
      label,
      width: imageData.width,
      height: imageData.height,
      length: imageData.data.length,
      bufferByteLength: imageData.data.buffer.byteLength,
      detached: false,
      probe: imageData.data[0],
    }
  } catch (error) {
    return {
      label,
      width: imageData.width,
      height: imageData.height,
      detached: true,
      error: error?.message ?? String(error),
    }
  }
}

/**
 * Copy pixels element-wise into a fresh owned buffer.
 */
export function copyOmrPixels(imageData, label = 'copyOmrPixels') {
  if (!imageData?.data || imageData.width <= 0 || imageData.height <= 0) {
    throw new Error(`[OMR ${label}] invalid image data`)
  }
  assertPixelViewReadable(imageData.data, `${label}-input`)

  const length = imageData.data.length
  const data = new Uint8ClampedArray(length)
  for (let i = 0; i < length; i += 1) {
    data[i] = imageData.data[i]
  }
  assertBufferNotDetached(data.buffer, `${label}-output`)

  return {
    width: imageData.width,
    height: imageData.height,
    data,
  }
}

/** @deprecated Use copyOmrPixels — kept for tests/imports. */
export const cloneOmrPixelBuffer = copyOmrPixels

export function copyPixelView(data, label = 'copyPixelView') {
  assertPixelViewReadable(data, `${label}-input`)
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i]
  }
  assertBufferNotDetached(out.buffer, `${label}-output`)
  return out
}

/**
 * Boring worker payload: plain number array, no TypedArray, no transfer list.
 */
export function serializeOmrImageForWorker(imageData, label = 'serialize-for-worker') {
  assertPixelViewReadable(imageData.data, `${label}-input`)
  return {
    width: imageData.width,
    height: imageData.height,
    pixels: Array.from(imageData.data),
  }
}

export function deserializeOmrImageFromWorker(payload, label = 'deserialize-from-worker') {
  const { width, height, pixels } = payload ?? {}
  if (!pixels || width <= 0 || height <= 0) {
    throw new Error(`[OMR ${label}] invalid worker image payload`)
  }
  const expectedLength = width * height * 4
  if (pixels.length !== expectedLength) {
    throw new Error(
      `[OMR ${label}] pixel length mismatch (got ${pixels.length}, expected ${expectedLength})`,
    )
  }

  const data = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i += 1) {
    data[i] = pixels[i]
  }
  assertBufferNotDetached(data.buffer, `${label}-output`)

  return { width, height, data }
}

/** @deprecated Use deserializeOmrImageFromWorker. */
export function imageDataFromPixelBuffer(payload) {
  if (payload?.pixels) {
    return deserializeOmrImageFromWorker(payload)
  }
  const { width, height, data } = payload ?? {}
  if (data instanceof Uint8ClampedArray) {
    return copyOmrPixels({ width, height, data }, 'imageDataFromPixelBuffer')
  }
  return deserializeOmrImageFromWorker({ width, height, pixels: data })
}

export function isDetachedPixelBuffer(data) {
  if (!(data instanceof Uint8ClampedArray)) {
    return false
  }
  try {
    assertBufferNotDetached(data.buffer, 'isDetachedPixelBuffer')
    return false
  } catch {
    return true
  }
}
