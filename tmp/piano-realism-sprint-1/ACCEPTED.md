# Audio Rendering / Piano Realism Sprint 1 — ACCEPTED / FROZEN

**Accepted 2026-07-26** after manual listening (Minecraft → Evangelion, no refresh).

## Frozen behavior
- Local Salamander samples (`/audio/salamander/`) as primary
- CDN Salamander as fallback
- Synth as last-resort fallback only
- Current gain curve, release (1.85s), polyphony (72), master FX, and DEV diagnostics

## Do not change unless a demonstrated audio regression appears
- Sample loading / URL preference
- Envelope, voice-mix, velocity gain mapping
- `pianoPlaybackDiagnostics` log contract

## Deferred
Multi-velocity piano sampling (next audio sprint candidate). Pedal modeling and broader audio changes remain out of scope until then.
