import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadMatchSettingsFromPrefs, savePracticePrefs, loadPracticePrefs } from '../session/practicePrefsStorage.js'
import {
  normalizeMatchSettings,
  WFY_MATCH_DEFAULTS,
} from './waitForYouMatchSettings.js'

export default function useWaitForYouMatchSettings(initialMatchSettings = null) {
  const [rawSettings, setRawSettings] = useState(
    initialMatchSettings ?? loadMatchSettingsFromPrefs() ?? WFY_MATCH_DEFAULTS,
  )

  const settings = useMemo(() => normalizeMatchSettings(rawSettings), [rawSettings])

  const updateSetting = useCallback((key, value) => {
    setRawSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const resetSettings = useCallback(() => {
    setRawSettings(WFY_MATCH_DEFAULTS)
  }, [])

  useEffect(() => {
    const existing = loadPracticePrefs() ?? {}
    savePracticePrefs({ ...existing, matchSettings: rawSettings })
  }, [rawSettings])

  return {
    settings,
    rawSettings,
    updateSetting,
    resetSettings,
  }
}
