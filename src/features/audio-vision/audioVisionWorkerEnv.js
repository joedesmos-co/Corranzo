/**
 * Web Worker environment shim — MUST be imported before TF.js.
 *
 * TF.js's browser platform guards its custom-timer path with a bare
 * `!window`:
 *
 *     setTimeoutCustom(func, delay) {
 *       if (!window || !ENV.getBool('USE_SETTIMEOUTCUSTOM')) { setTimeout(func, delay); return }
 *       ...
 *     }
 *
 * In a Web Worker `window` is not declared at all, so that probe throws
 * "ReferenceError: Can't find variable: window" instead of falling back to
 * the platform timer. The throw happens inside the WebGL backend's fence
 * polling, so the fence promise never settles, `evaluateModel()` never
 * returns and the worker never posts its result — the arrangement generation
 * stalls at 90% forever, with no error the user can see.
 *
 * It only shows up where the WebGL backend is actually available in a worker
 * (Safari always has it; a GPU-backed desktop browser usually does), which is
 * why the same build can work in one browser and hang in another.
 *
 * Declaring `window` as `undefined` makes the probe behave exactly as its
 * author intended: fall back to the platform timer. `typeof window` still
 * reads "undefined", so every other TF.js feature probe is unchanged, and the
 * model, the backend, the thresholds and the recognized notes are all
 * untouched — only the thread's timer is used.
 */
if (typeof self !== 'undefined' && typeof self.window === 'undefined') {
  self.window = undefined
}

export {}
