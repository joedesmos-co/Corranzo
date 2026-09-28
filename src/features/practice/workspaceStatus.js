import { PRACTICE_MODE } from './practiceMode.js'
/** One musician-facing summary; technical details stay in advanced settings. */
export function workspaceStatus(session, follow) {
  if (session.timing.error || session.playback.error) return { kind: 'error', label: 'Playback unavailable', detail: 'Open settings for recovery options.' }
  if (session.timing.isLoading || session.playback.isLoading) return { kind: 'preparing', label: 'Preparing your score', detail: 'You can read and mark the page while it loads.' }
  if (!session.hasMusicXml) return { kind: 'quiet', label: 'Read & mark', detail: 'Playback is not available for this score yet.' }
  if (session.isWaitForYou) {
    if (session.waitForYou.displayStatus === 'correct') return { kind: 'ready', label: 'Correct · keep going', detail: 'Moving to your next notes.' }
    if (session.waitForYou.displayStatus === 'missed') return { kind: 'waiting', label: 'Try those notes again', detail: session.waitForYouInput?.inputFeedback?.message || 'The score will wait.' }
    if (session.wfyInputSourceReady && session.wfyInputSource === 'microphone' && ['denied', 'error'].includes(session.microphone?.permission)) return { kind: 'error', label: 'Microphone unavailable · use Continue', detail: 'Choose another input or check microphone access.' }
    if (session.wfyInputSourceReady && session.wfyInputSource === 'midi' && !session.webMidi?.devices?.length) return { kind: 'waiting', label: 'Connect a keyboard · or Continue', detail: 'Choose your keyboard in Practice input.' }
    if (session.waitForYou.isComplete) return { kind: 'ready', label: 'Passage complete', detail: 'Start again whenever you’re ready.' }
    if (session.waitForYouMic?.micCalibrating && session.wfyInputSource === 'microphone' && session.wfyInputSourceReady) return { kind: 'preparing', label: 'Listening to the room', detail: 'A quiet moment helps us hear your instrument.' }
    const matching = session.waitForYouInput?.matchingEnabled
    return { kind: 'waiting', label: matching ? 'Listening · your turn' : 'Your turn', detail: matching ? 'Play the highlighted notes to continue.' : 'Use Continue, or connect your instrument.' }
  }
  if (!follow.enabled) return { kind: 'quiet', label: 'Score follow off', detail: 'Turn it on in workspace settings.' }
  if (['running', 'preparing', 'analyzing', 'queued'].includes(follow.setupStatus?.phase)) return { kind: 'preparing', label: 'Preparing score follow', detail: 'The score is still available to read.' }
  if (!follow.canFollow) return { kind: 'quiet', label: 'Score follow unavailable', detail: 'Score following is unavailable. The page stays in your control.' }
  return { kind: 'ready', label: session.practiceMode === PRACTICE_MODE.PREVIEW ? 'Listen & follow' : 'Play with the score', detail: session.practiceMode === PRACTICE_MODE.PREVIEW ? 'The score follows the music.' : 'The music keeps time while you play.' }
}
