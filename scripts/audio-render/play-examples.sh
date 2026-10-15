#!/usr/bin/env bash
# Plays the listening pack in order, so you can listen without touching Finder.
#
#   bash ~/Documents/scoreflow-sound-engine/scripts/audio-render/play-examples.sh
#
# Each file is announced before it plays. Press Ctrl+C to stop early.
# macOS `afplay` plays the WAVs directly - no audio app or install needed.

DIR="$HOME/Documents/scoreflow-sound-engine/scripts/audio-render/examples"

CLIPS=(
  "listening-piano-melody|1 - PIANO MELODY - can you follow the tune?"
  "listening-piano-chords|2 - PIANO CHORDS - do they sound like one instrument?"
  "listening-piano-pp-to-ff|3 - PIANO DYNAMICS - five steps from soft to loud"
  "listening-piano-top-octave|4 - PIANO TOP OCTAVE - G#7 up to C8"
  "electric-a3|5 - CLEAN ELECTRIC GUITAR - one A3"
  "guitar-strum-emajor|6 - ACOUSTIC STRUM - six strings, E major"
  "listening-acoustic-guitar-melody|7 - ACOUSTIC GUITAR MELODY - attack and decay"
)

echo
echo "Corranzo listening pack"
echo "======================="
echo
total=${#CLIPS[@]}
index=0
for entry in "${CLIPS[@]}"; do
  file="${entry%%|*}"
  label="${entry##*|}"
  index=$((index + 1))
  path="$DIR/$file.wav"
  if [[ ! -f "$path" ]]; then
    echo "  missing: $path"
    continue
  fi
  echo
  echo "[$index/$total] $label"
  echo "      $file.wav"
  echo
  afplay "$path"
  echo "      (done)"
done

echo
echo "Extra clips, same folder - play any of them the same way:"
for extra in piano-dynamics-ladder piano-crescendo piano-pedal-staccato \
             piano-trill-mordent guitar-bend-release guitar-palm-mute-vs-ring \
             guitar-slide-vibrato acoustic-vs-electric-a3; do
  if [[ -f "$DIR/$extra.wav" ]]; then
    echo "      afplay \"$DIR/$extra.wav\""
  fi
done
echo
echo "Thanks - note anything that sounds wrong and report it back."
echo
