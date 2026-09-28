import { useState } from 'react'
import Icon from './Icon.jsx'
import { ICON_NAMES } from './iconPaths.js'
import { Button, IconButton } from './Button.jsx'
import SegmentedControl from './SegmentedControl.jsx'
import { Field, Select, Slider, TextInput, Toggle } from './Fields.jsx'
import { Badge, Divider, EmptyState, Panel, StatusLine, Tooltip } from './Feedback.jsx'
import Popover, { PopoverItem } from './Popover.jsx'
import ModeSwitch from './ModeSwitch.jsx'
import { PRACTICE_MODES } from './modeOptions.js'
import './sandbox.css'

function SandboxSection({ kicker, title, children }) {
  return (
    <section className="cz-sandbox__section">
      <p className="cz-kicker">{kicker}</p>
      <h2 className="cz-sandbox__heading">{title}</h2>
      <div className="cz-sandbox__demo">{children}</div>
    </section>
  )
}

/**
 * Dev-only design proof surface (Phase A). Rendered ONLY when
 * `import.meta.env.DEV` and the path is /design — never linked from prod UI.
 * Lets reviewers judge the Studio-Console-warmed direction (tokens, type,
 * icons, primitives, mode switch) without rewriting production screens.
 */
export default function DesignSandbox() {
  const [mode, setMode] = useState(PRACTICE_MODES.PLAY_ALONG)
  const [segment, setSegment] = useState('score')
  const [tempo, setTempo] = useState(100)
  const [muted, setMuted] = useState(false)
  const [name, setName] = useState('')
  const [voice, setVoice] = useState('piano')

  return (
    <main className="cz-sandbox">
      <header className="cz-sandbox__hero">
        <p className="cz-kicker">Corranzo · Phase A · dev only</p>
        <h1 className="cz-sandbox__title">Studio console, warmed.</h1>
        <p className="cz-sandbox__lede">
          Precision controls on a warm-charcoal desk, editorial serif reserved for musical
          moments, brand gold for primary actions — warning orange is a different hue,
          never a fill. This page proves the direction; it is not a customer feature.
        </p>
        <div className="cz-sandbox__row">
          <StatusLine tone="ready" icon="check">Sound ready</StatusLine>
          <StatusLine tone="warn" icon="warn">Cursor needs setup</StatusLine>
          <StatusLine tone="error" icon="error">Mic blocked</StatusLine>
          <StatusLine tone="signal" icon="dot">Following score</StatusLine>
          <StatusLine>Manual input</StatusLine>
        </div>
        <p className="cz-sandbox__note">
          Status is inline icon + word by default. Contained pills are reserved for flags
          that need a boundary: <Badge tone="signal">Following score</Badge>
        </p>
      </header>

      <SandboxSection kicker="01 · Mode clarity" title="Three-state mode switch">
        <ModeSwitch value={mode} onChange={setMode} />
        <p className="cz-sandbox__note">
          Active: <strong>{mode}</strong> — glyph + signal edge-bar + pip + hint contrast make it
          unmistakable at piano distance. Arrow keys move; selection follows focus.
        </p>
        <ModeSwitch value={mode} onChange={setMode} disabled />
      </SandboxSection>

      <SandboxSection kicker="02 · Typography" title="One sans, one serif, one mono">
        <p className="cz-piece-title">Minuet in G major, BWV Anh. 114</p>
        <p className="cz-sandbox__note">Editorial serif — piece titles and home moments only.</p>
        <h3 className="cz-sandbox__uihead">Practice workspace section heading</h3>
        <p>UI sans for everything functional. Tempo and time read as tabular numerals: <span className="cz-numeric">96 BPM · 01:24 / 03:10 · 72%</span></p>
      </SandboxSection>

      <SandboxSection kicker="03 · Controls" title="Buttons and icon buttons">
        <div className="cz-sandbox__row">
          <Button variant="primary">Start practice</Button>
          <Button>Upload timing file</Button>
          <Button variant="ghost">Skip for now</Button>
          <Button variant="danger">Remove piece</Button>
          <Button disabled>Loading…</Button>
        </div>
        <div className="cz-sandbox__row">
          <IconButton icon="play" label="Play" />
          <IconButton icon="pause" label="Pause" />
          <IconButton icon="stop" label="Stop" />
          <IconButton icon="loop" label="Loop section" active />
          <IconButton icon="metronome" label="Metronome" />
          <IconButton icon="pen" label="Annotate" />
          <Tooltip tip="Popover menus open on click, close on Escape">
            <span className="cz-sandbox__inline">Focus or hover me</span>
          </Tooltip>
          <Popover triggerIcon="tracks" triggerLabel="Tracks">
            {({ close }) => (
              <>
                <PopoverItem icon="check" active onClick={close}>Piano · mute off</PopoverItem>
                <PopoverItem icon="tracks" onClick={close}>Strings · muted</PopoverItem>
              </>
            )}
          </Popover>
        </div>
      </SandboxSection>

      <SandboxSection kicker="04 · Inputs" title="Fields, selects, toggles, sliders">
        <div className="cz-sandbox__grid">
          <TextInput label="Piece name" placeholder="e.g. Clair de lune" value={name} onChange={(e) => setName(e.target.value)} hint="Stays in this browser." />
          <Select
            label="Instrument voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            options={[{ value: 'piano', label: 'Piano' }, { value: 'guitar', label: 'Guitar' }]}
          />
          <Toggle label="Metronome" checked={!muted} onChange={(value) => setMuted(!value)} />
          <Slider label="Tempo" value={tempo} displayValue={`${tempo}% · ${Math.round(0.96 * tempo)} BPM`} min={25} max={150} step={5} onChange={setTempo} />
        </div>
        <div className="cz-sandbox__row">
          <SegmentedControl label="Score view" value={segment} onChange={setSegment} options={[{ value: 'score', label: 'Score' }, { value: 'guide', label: 'Guide' }]} />
        </div>
      </SandboxSection>

      <SandboxSection kicker="05 · Surfaces" title="Desk, panel, paper">
        <div className="cz-sandbox__desk">
          <Panel title="Practice panel" sub="Default raised surface for controls.">
            <div className="cz-sandbox__row">
              <Button size="sm">Loop this bar</Button>
              <Button size="sm" variant="ghost">Set start / end</Button>
            </div>
          </Panel>
          <div className="cz-sandbox__sheet" aria-label="Score sheet sample">
            <p className="cz-kicker">Now practicing</p>
            <p className="cz-sandbox__sheettitle">Für Elise — Bagatelle in A minor</p>
            <p className="cz-sandbox__sheetmeta">Bar 12 of 48 · Play Along · 84%</p>
          </div>
        </div>
      </SandboxSection>

      <SandboxSection kicker="06 · Library" title="A musician's collection">
        <div className="cz-sandbox__shelf" aria-label="Collection sample">
          {[
            { title: 'Minuet in G', meta: 'Bach · Beginner · Last played Tue · Bar 12 · 72%' },
            { title: 'Für Elise', meta: 'Beethoven · Intermediate · Yesterday · 24 min · 84%' },
            { title: 'Gymnopédie No. 1', meta: 'Satie · Intermediate · Not started yet' },
          ].map((piece) => (
            <div key={piece.title} className="cz-sandbox__shelfrow">
              <span className="cz-sandbox__shelfart" aria-hidden="true">
                <Icon name="music" size={17} strokeWidth={1.6} />
              </span>
              <span className="cz-sandbox__shelfmain">
                <span className="cz-sandbox__shelftitle">{piece.title}</span>
                <span className="cz-sandbox__shelfmeta">{piece.meta}</span>
              </span>
              <Button size="sm" variant="ghost">Resume</Button>
            </div>
          ))}
        </div>
        <p className="cz-sandbox__note">
          Serif titles, tabular progress, one quiet action per row — a shelf of pieces,
          not a file table. Empty collections get the staff-motif state below.
        </p>
        <Divider />
        <EmptyState
          title="Your shelf is waiting"
          copy="Add a PDF of your sheet music. Corranzo reads it automatically; a notes file is optional."
          primaryAction={{ label: 'Import a score', onClick: () => {} }}
          secondaryAction={{ label: 'Try the demo', onClick: () => {} }}
        />
      </SandboxSection>

      <SandboxSection kicker="08 · Rule" title="Dark workspace, warm home">
        <div className="cz-sandbox__rule">
          <div className="cz-sandbox__rulecard cz-sandbox__rulecard--studio">
            <strong>Score / Practice</strong>
            <span>Dark, precise, focused, studio-like.</span>
          </div>
          <div className="cz-sandbox__rulecard cz-sandbox__rulecard--editorial">
            <strong>Home / Library</strong>
            <span>Warmer, editorial, musical — ivory, serif, shelf.</span>
          </div>
        </div>
        <p className="cz-sandbox__note">
          One product, two temperatures. Chrome stays dark everywhere; warmth enters
          through paper, titles, and collection surfaces — never as full-app beige.
        </p>
      </SandboxSection>

      <SandboxSection kicker="09 · Icon set" title="Vendored stroke icons">
        <div className="cz-sandbox__icons">
          {ICON_NAMES.map((iconName) => (
            <span key={iconName} className="cz-sandbox__iconcell" title={iconName}>
              <Icon name={iconName} size={20} />
              <span>{iconName}</span>
            </span>
          ))}
        </div>
        <Field label="Icon API check" hint="Icons render from the registry — no unicode glyphs.">
          <span className="cz-sandbox__inline">See grid above ({ICON_NAMES.length} icons).</span>
        </Field>
      </SandboxSection>
    </main>
  )
}
