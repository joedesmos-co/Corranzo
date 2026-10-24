import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export default {
  server: {
    fs: { allow: [resolve(here, '../../..')] },
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'opensheetmusicdisplay'],
  },
}
