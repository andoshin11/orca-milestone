// Shows the body the worker renders: what it has when the panel opens, then each change it posts.
// Orca recreates the panel when its sidebar tab is switched, and nothing is posted while it is
// closed, so every open asks again. Asking again while open also keeps the worker from being
// stopped as idle, which would end its watch on the task lists.
import { scrollExpandedRows } from './expand.mjs'
import { sendOnPress } from './next.mjs'
import { openOnPress } from './open.mjs'
import { patchChildren } from './patch.mjs'

const RETRY_MS = 3000
// Orca stops a worker after 5 minutes without any call.
const KEEP_ALIVE_MS = 60_000

let pushes = 0
// Declared before the first body arrives, since each one restores what the user picked in a form.
const presses = sendOnPress(document.body, (request) => window.orca.plugin.request('next.send', request))
let loaded = false

const { plugin } = window.orca

plugin.on('view.changed', ({ html }) => {
  pushes += 1
  loaded = true
  patchChildren(document.body, html)
  presses.restore()
})

async function load() {
  const seen = pushes
  try {
    const { html } = await plugin.request('view.get')
    // A post that arrived while this was on its way is newer.
    if (pushes === seen) {
      patchChildren(document.body, html)
      presses.restore()
    }
    loaded = true
  } catch (error) {
    console.warn(`milestone: view.get failed: ${error.code ?? error.message}`)
    if (!loaded) setTimeout(load, RETRY_MS)
  }
}

scrollExpandedRows(document.body)
openOnPress(document.body, (path) => {
  plugin.request('workspace.open', { path }).catch((error) => {
    console.warn(`milestone: workspace.open failed: ${error.code ?? error.message}`)
  })
})


void load()
setInterval(load, KEEP_ALIVE_MS)
