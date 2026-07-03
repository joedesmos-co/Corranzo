import { describe, expect, it } from 'vitest'
import {
  decideMicEngineV2Enabled,
  isMicEngineV2Enabled,
  MIC_ENGINE_MODE,
  MIC_ENGINE_V2_FLAG,
  MIC_ENGINE_V2_STORAGE_KEY,
  resolveFlagOverride,
} from '../src/features/microphone-input/micEngineFlag.js'

describe('micEngineFlag', () => {
  it('defaults V2 on in dev when no sources are set', () => {
    expect(decideMicEngineV2Enabled({ devDefault: true })).toBe(true)
    expect(decideMicEngineV2Enabled({ devDefault: true, globalValue: null, storageValue: null })).toBe(
      true,
    )
  })

  it('defaults V2 off in production when no sources are set', () => {
    expect(decideMicEngineV2Enabled({ devDefault: false })).toBe(false)
  })

  it('explicit storage false opts out of dev default V2', () => {
    expect(
      decideMicEngineV2Enabled({
        devDefault: true,
        storageValue: 'false',
      }),
    ).toBe(false)
    expect(
      decideMicEngineV2Enabled({
        devDefault: true,
        globalValue: false,
      }),
    ).toBe(false)
  })

  it('respects explicit override before global or storage', () => {
    expect(
      decideMicEngineV2Enabled({
        override: true,
        globalValue: false,
        storageValue: false,
        devDefault: false,
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        override: false,
        globalValue: true,
        storageValue: true,
        devDefault: true,
      }),
    ).toBe(false)
  })

  it('falls back global then storage before dev default', () => {
    expect(
      decideMicEngineV2Enabled({
        devDefault: false,
        globalValue: true,
        storageValue: false,
      }),
    ).toBe(true)
    expect(
      decideMicEngineV2Enabled({
        devDefault: false,
        globalValue: null,
        storageValue: 'on',
      }),
    ).toBe(true)
  })

  it('parses common truthy/falsy strings', () => {
    expect(resolveFlagOverride('true')).toBe(true)
    expect(resolveFlagOverride('off')).toBe(false)
    expect(resolveFlagOverride('maybe')).toBe(null)
  })

  it('exposes stable flag identifiers for dev QA', () => {
    expect(MIC_ENGINE_V2_FLAG).toBe('micEngineV2')
    expect(MIC_ENGINE_V2_STORAGE_KEY).toBe('scoreflow.flags.micEngineV2')
  })

  it('honors explicit override via isMicEngineV2Enabled', () => {
    expect(isMicEngineV2Enabled(false)).toBe(false)
    expect(isMicEngineV2Enabled(true)).toBe(true)
  })
})
