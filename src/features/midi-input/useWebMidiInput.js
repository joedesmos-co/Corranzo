import { useCallback, useEffect, useRef, useState } from 'react'
import { midiToNoteLabel } from './midiNoteLabel.js'
import { isWebMidiSupported, parseMidiMessage } from './parseMidiMessage.js'
import {
  WEB_MIDI_PERMISSION,
  WEB_MIDI_SUPPORT,
} from './webMidiConstants.js'

function listInputDevices(access) {
  if (!access?.inputs) {
    return []
  }
  return [...access.inputs.values()].map((input) => ({
    id: input.id,
    name: input.name || 'MIDI input',
    manufacturer: input.manufacturer || '',
  }))
}

export default function useWebMidiInput({ listen = false }) {
  const accessRef = useRef(null)
  const noteOnListenersRef = useRef(new Set())

  const support = isWebMidiSupported() ? WEB_MIDI_SUPPORT.SUPPORTED : WEB_MIDI_SUPPORT.UNSUPPORTED

  const [permission, setPermission] = useState(
    support === WEB_MIDI_SUPPORT.SUPPORTED
      ? WEB_MIDI_PERMISSION.PROMPT
      : WEB_MIDI_PERMISSION.UNSUPPORTED,
  )
  const [devices, setDevices] = useState([])
  const [lastNote, setLastNote] = useState(null)
  const [errorMessage, setErrorMessage] = useState(null)

  const notifyNoteOn = useCallback((midi, velocity) => {
    const note = {
      midi,
      velocity,
      label: midiToNoteLabel(midi),
      at: Date.now(),
    }
    setLastNote(note)
    noteOnListenersRef.current.forEach((listener) => {
      listener(midi, velocity, note)
    })
  }, [])

  const attachInputHandlers = useCallback(
    (access) => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = (event) => {
          const parsed = parseMidiMessage(event.data)
          if (parsed?.type === 'noteon') {
            notifyNoteOn(parsed.midi, parsed.velocity)
          }
        }
      }
    },
    [notifyNoteOn],
  )

  const refreshDevices = useCallback(() => {
    if (accessRef.current) {
      setDevices(listInputDevices(accessRef.current))
    }
  }, [])

  const requestAccess = useCallback(async () => {
    if (support !== WEB_MIDI_SUPPORT.SUPPORTED) {
      return false
    }

    setErrorMessage(null)

    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      accessRef.current = access
      setPermission(WEB_MIDI_PERMISSION.GRANTED)
      setDevices(listInputDevices(access))
      attachInputHandlers(access)

      access.onstatechange = () => {
        refreshDevices()
        attachInputHandlers(access)
      }

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
  }, [support, attachInputHandlers, refreshDevices])

  useEffect(() => {
    if (!listen || permission !== WEB_MIDI_PERMISSION.GRANTED || !accessRef.current) {
      return
    }
    attachInputHandlers(accessRef.current)
  }, [listen, permission, attachInputHandlers])

  const subscribeNoteOn = useCallback((listener) => {
    noteOnListenersRef.current.add(listener)
    return () => {
      noteOnListenersRef.current.delete(listener)
    }
  }, [])

  return {
    support,
    permission,
    devices,
    lastNote,
    errorMessage,
    isGranted: permission === WEB_MIDI_PERMISSION.GRANTED,
    isListening: listen && permission === WEB_MIDI_PERMISSION.GRANTED,
    requestAccess,
    refreshDevices,
    subscribeNoteOn,
  }
}
