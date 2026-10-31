// Writes the first panel document. Orca refuses to load a plugin whose panel entry is missing,
// and the worker that keeps panel/index.html current only runs once the plugin has loaded.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPanel } from '../src/render.mjs'

const panelPath = join(import.meta.dirname, '..', 'panel', 'index.html')
if (existsSync(panelPath)) {
  console.log('panel/index.html already exists')
} else {
  mkdirSync(join(panelPath, '..'), { recursive: true })
  writeFileSync(panelPath, renderPanel({ kind: 'no-workspace' }))
  console.log('wrote panel/index.html')
}
