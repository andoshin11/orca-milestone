// Shows the body the worker renders: what it has when the panel opens, then each change it posts.
// Orca recreates the panel when its sidebar tab is switched, and nothing is posted while it is
// closed, so every open asks again.
import { patchChildren } from './patch.mjs'

const RETRY_MS = 3000

let pushed = false

const { plugin } = window.orca

plugin.on('view.changed', ({ html }) => {
  pushed = true
  patchChildren(document.body, html)
})

async function load() {
  try {
    const { html } = await plugin.request('view.get')
    // A post that arrived while this was on its way is newer.
    if (!pushed) patchChildren(document.body, html)
  } catch (error) {
    console.warn(`milestone: view.get failed: ${error.code ?? error.message}`)
    if (!pushed) setTimeout(load, RETRY_MS)
  }
}

void load()
