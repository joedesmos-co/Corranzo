import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    // Real-PDF/canvas render tests (spiderDanceCalibration, scoreFollowMotionModel)
    // take 3-4s each in isolation and can exceed the 5s default under parallel CPU
    // contention in the full suite. Raise the ceiling to avoid flaky timeouts.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
