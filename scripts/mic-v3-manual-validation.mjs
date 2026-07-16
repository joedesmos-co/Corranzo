#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createMicV3ManualSessionTemplate,
  evaluateMicV3ManualSession,
} from '../src/features/microphone-input/v3/manualValidation.js'

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1] ?? null
}

const args = process.argv.slice(2)
const templatePath = argValue(args, '--write-template')
if (templatePath) {
  writeFileSync(resolve(templatePath), `${JSON.stringify(createMicV3ManualSessionTemplate(), null, 2)}\n`)
  console.log(`Wrote ${resolve(templatePath)}`)
  process.exit(0)
}

const sessionPath = argValue(args, '--session')
if (!sessionPath) {
  console.error('Usage: npm run mic:manual-validate -- --session path/to/session.json')
  process.exit(2)
}

const session = JSON.parse(readFileSync(resolve(sessionPath), 'utf8'))
const result = evaluateMicV3ManualSession(session)
console.log(JSON.stringify(result, null, 2))
if (!result.releaseReady) process.exitCode = 1
