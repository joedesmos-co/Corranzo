import readline from 'node:readline'
import { repairContext, repairScope } from '../semantic-gold/repair-scope.mjs'

let context = null
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const message = JSON.parse(line)
    if (message.command === 'score') {
      context = repairContext(message.xml, message.scopes)
      process.stdout.write('{"ready":true}\n')
    } else if (message.command === 'scope') {
      if (!context) throw new Error('NO_SCORE_CONTEXT')
      process.stdout.write(JSON.stringify(repairScope(context, message.source, message.target)) + '\n')
    } else throw new Error('UNKNOWN_REPAIR_COMMAND')
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.stack }) + '\n')
  }
}
