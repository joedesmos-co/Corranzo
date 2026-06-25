import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { midiToNoteLabel } from './midiNoteLabel.js'
import { isWebMidiSupported, parseMidiMessage } from './parseMidiMessage.js'
import {
  WEB_MIDI_PERMISSION,
  WEB_MIDI_SUPPORT,
} from './webMidiConstants.js'
import {
  activeNoteList,
  applyParsedMessage,
  createMidiActivity,
  describeDevice,
  deviceStatusLabel,
  loadLastMidiDeviceName,
  pickActiveDevice,
  saveLastMidiDeviceName,
  updateLatencyEstimate,
} from './webMidiEngine.js'

export default function useWebMidiInput({ listen = false }) {
  const accessRef = useRef(null)
  const noteOnListenersRef = useRef(new Set())
  const activityRef = useRef(createMidiActivity())
  const latencyRef = useRef(null)
  const rememberedNameRef = useRef(loadLastMidiDeviceName())

  const support = isWebMidiSupported() ? WEB_MIDI_SUPPORT.SUPPORTED : WEB_MIDI_SUPPORT.UNSUPPORTED

  const [permission, setPermission] = useState(
    support === WEB_MIDI_SUPPORT.SUPPORTED
      ? WEB_MIDI_PERMISSION.PROMPT
      : WEB_MIDI_PERMISSION.UNSUPPORTED,
  )
  const [devices, setDevices] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [activeDeviceId, setActiveDeviceId] = useState(null)
  const [lastNote, setLastNote] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)
  const [sustain, setSustain] = useState(false)
  const [activeNotes, setActiveNotes] = useState([])
  const [noteCount, setNoteCount] = useState(0)
  const [latencyMs, setLatencyMs] = useState(null)

  // Mirrors the selection for handlers/callbacks that are created once; kept in
  // sync inside selectDevice (the only place the selection changes).
  const selectedDeviceIdRef = useRef(selectedDeviceId)

  // The note path: parse → fold into the activity model → notify listeners
  // SYNCHRONOUSLY (before any React state update, so matching stays immediate) →
  // then refresh the diagnostic state.
  const handleMessage = useCallback((event) => {
    const parsed = parseMidiMessage(event.data)
    if (!parsed) return
    const receive = typeof performance !== 'undefined' ? performance.now() : Date.now()
    applyParsedMessage(activityRef.current, parsed, receive)
    latencyRef.current = updateLatencyEstimate(latencyRef.current, event.timeStamp, receive)

    if (parsed.type === 'noteon') {
      const note = {
        midi: parsed.midi,
        velocity: parsed.velocity,
        label: midiToNoteLabel(parsed.midi),
        at: receive,
      }
      noteOnListenersRef.current.forEach((listener) => listener(parsed.midi, parsed.velocity, note))
      setLastNote(note)
    }

    setActiveNotes(activeNoteList(activityRef.current))
    setNoteCount(activityRef.current.noteCount)
    if (parsed.type === 'sustain') {
      setSustain(parsed.on)
    }
    if (latencyRef.current != null) {
      setLatencyMs(Math.round(latencyRef.current * 10) / 10)
    }
  }, [])

  // Attach the message handler to the active device only; detach all others so a
  // non-selected keyboard never injects notes.
  const attachToActiveDevice = useCallback(
    (access, activeId) => {
      if (!access?.inputs) return
      for (const input of access.inputs.values()) {
        input.onmidimessage = input.id === activeId ? handleMessage : null
      }
    },
    [handleMessage],
  )

  // Reconcile the device list and the active device after any change (initial
  // grant, hot-plug, unplug, re-plug, manual selection). Persists the chosen
  // device name so it auto-reconnects next time it appears.
  const syncDevicesAndActive = useCallback(() => {
    const access = accessRef.current
    if (!access?.inputs) return
    const list = [...access.inputs.values()].map(describeDevice)
    setDevices(list)

    const active = pickActiveDevice(list, selectedDeviceIdRef.current, rememberedNameRef.current)
    setActiveDeviceId(active?.id ?? null)
    if (active) {
      rememberedNameRef.current = active.name
      saveLastMidiDeviceName(active.name)
    } else {
      // Device disconnected — drop held notes/sustain so state is honest.
      activityRef.current.active.clear()
      activityRef.current.sustain = false
      setActiveNotes([])
      setSustain(false)
    }
    attachToActiveDevice(access, active?.id ?? null)
  }, [attachToActiveDevice])

  const requestAccess = useCallback(async () => {
    if (support !== WEB_MIDI_SUPPORT.SUPPORTED) {
      return false
    }
    setErrorMessage(null)
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      accessRef.current = access
      setPermission(WEB_MIDI_PERMISSION.GRANTED)
      access.onstatechange = () => syncDevicesAndActive()
      syncDevicesAndActive()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MIDI access failed'
      if (error?.name === 'SecurityError' || message.toLowerCase().includes('denied')) {
        setPermission(WEB_MIDI_PERMISSION.DENIED)
      } else {
        setPermission(WEB_MIDI_PERMISSION.ERROR)
      }
      setErrorMessage(message)
      return false
    }
  }, [support, syncDevicesAndActive])

  const selectDevice = useCallback(
    (deviceId) => {
      selectedDeviceIdRef.current = deviceId
      setSelectedDeviceId(deviceId)
      syncDevicesAndActive()
    },
    [syncDevicesAndActive],
  )

  // Re-assert handlers if listening starts after access was granted.
  useEffect(() => {
    if (!listen || permission !== WEB_MIDI_PERMISSION.GRANTED || !accessRef.current) {
      return
    }
    syncDevicesAndActive()
  }, [listen, permission, syncDevicesAndActive])

  const subscribeNoteOn = useCallback((listener) => {
    noteOnListenersRef.current.add(listener)
    return () => {
      noteOnListenersRef.current.delete(listener)
    }
  }, [])

  const activeDevice = useMemo(
    () => devices.find((d) => d.id === activeDeviceId) ?? null,
    [devices, activeDeviceId],
  )

  const statusLabel = deviceStatusLabel({
    supported: support === WEB_MIDI_SUPPORT.SUPPORTED,
    granted: permission === WEB_MIDI_PERMISSION.GRANTED,
    activeDevice,
  })

  return {
    support,
    permission,
    devices,
    selectedDeviceId,
    activeDeviceId,
    activeDevice,
    statusLabel,
    lastNote,
    errorMessage,
    isGranted: permission === WEB_MIDI_PERMISSION.GRANTED,
    isListening: listen && permission === WEB_MIDI_PERMISSION.GRANTED,
    sustain,
    activeNotes,
    noteCount,
    latencyMs,
    requestAccess,
    refreshDevices: syncDevicesAndActive,
    selectDevice,
    subscribeNoteOn,
  }
}
