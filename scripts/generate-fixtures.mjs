/**
 * Regenerates minimal placeholder fixtures (legacy smoke tests).
 * For the real demo piece, use: npm run fixtures
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'fixtures')

mkdirSync(outDir, { recursive: true })

const generator = join(root, 'scripts', 'generate-fixtures.py')
const result = spawnSync('python3', [generator], { cwd: root, encoding: 'utf8' })

if (result.status !== 0) {
  console.error(result.stderr || result.stdout)
  process.exit(result.status ?? 1)
}

console.log(readFileSync(join(outDir, 'README.md'), 'utf8').split('\n')[0])
console.log('Wrote fixtures to public/fixtures/')
