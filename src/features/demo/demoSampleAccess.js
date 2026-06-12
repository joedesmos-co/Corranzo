/** Dev-only sample piece, or production when VITE_ENABLE_DEMO_SAMPLE=true. */
export function isDemoSampleEnabled() {
  return import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_SAMPLE === 'true'
}
