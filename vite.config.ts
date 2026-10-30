import { defineConfig } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function offlinePrecache(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'helpminths-offline-precache',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    async closeBundle() {
      const output = path.resolve(config.root, config.build.outDir)
      async function filesIn(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true })
        const nested = await Promise.all(entries.map(entry => {
          const filename = path.join(directory, entry.name)
          return entry.isDirectory() ? filesIn(filename) : Promise.resolve([filename])
        }))
        return nested.flat()
      }
      const filenames = (await filesIn(output))
        .filter(filename => path.relative(output, filename) !== 'sw.js')
        .sort()
      const template = await readFile(path.resolve(config.publicDir, 'sw.js'), 'utf8')
      const version = createHash('sha256')
      version.update(template).update('\0')
      const contents = await Promise.all(filenames.map(async filename => {
        const relative = path.relative(output, filename).split(path.sep).join('/')
        const bytes = await readFile(filename)
        return { relative, bytes }
      }))
      const assets = contents.map(({ relative, bytes }) => {
        version.update(relative).update('\0').update(bytes).update('\0')
        return {
          url: '/' + relative.split('/').map(encodeURIComponent).join('/'),
          integrity: 'sha256-' + createHash('sha256').update(bytes).digest('base64'),
        }
      })
      const worker = template
        .replace('__HELPMINTHS_BUILD_VERSION__', JSON.stringify(version.digest('hex').slice(0, 16)))
        .replace('__HELPMINTHS_PRECACHE__', JSON.stringify(assets))
      await writeFile(path.join(output, 'sw.js'), worker)
    },
  }
}

export default defineConfig({
  plugins: [react(), offlinePrecache()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Preserve the browser Host so same-origin login and CSRF checks also work
    // through Vite's local development proxy.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: { chunkSizeWarningLimit: 1200 },
})
