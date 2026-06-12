import { useCallback, useEffect, useState } from 'react'
import { loadWorkspacePreferences, saveWorkspacePreferences } from '../utils/annotationStorage.js'

const DEFAULTS = {
  sidebarOpen: true,
  paperTheme: 'dark',
}

export default function useWorkspacePreferences() {
  const [preferences, setPreferences] = useState(() => ({
    ...DEFAULTS,
    ...loadWorkspacePreferences(),
  }))

  useEffect(() => {
    saveWorkspacePreferences(preferences)
  }, [preferences])

  const setSidebarOpen = useCallback((open) => {
    setPreferences((prev) => ({ ...prev, sidebarOpen: open }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setPreferences((prev) => ({ ...prev, sidebarOpen: !prev.sidebarOpen }))
  }, [])

  const setPaperTheme = useCallback((paperTheme) => {
    setPreferences((prev) => ({ ...prev, paperTheme }))
  }, [])

  const togglePaperTheme = useCallback(() => {
    setPreferences((prev) => ({
      ...prev,
      paperTheme: prev.paperTheme === 'dark' ? 'light' : 'dark',
    }))
  }, [])

  return {
    sidebarOpen: preferences.sidebarOpen,
    paperTheme: preferences.paperTheme,
    setSidebarOpen,
    toggleSidebar,
    setPaperTheme,
    togglePaperTheme,
  }
}
