#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  runFinalMicCorpus,
  summarizeFinalMicCorpusMarkdown,
} from './lib/finalMicReleaseCorpus.mjs'

function valueAfter(flag, fallback) {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const jsonPath = resolve(valueAfter('--json', 'tmp/final-mic-release/mic-final.json'))
const markdownPath = resolve(valueAfter('--markdown', 'tmp/final-mic-release/PHASE_4_MIC_FINAL.md'))
const label = valueAfter('--label', 'Final')
const corpus = runFinalMicCorpus()
mkdirSync(dirname(jsonPath), { recursive: true })
mkdirSync(dirname(markdownPath), { recursive: true })
writeFileSync(jsonPath, `${JSON.stringify(corpus, null, 2)}\n`)
writeFileSync(markdownPath, summarizeFinalMicCorpusMarkdown(corpus, { label }))
console.log(JSON.stringify({ jsonPath, markdownPath, summary: corpus.summary }, null, 2))
