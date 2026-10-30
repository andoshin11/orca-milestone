import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import activate from '../main.mjs'

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'orca-plugin.json'), 'utf8'))

test('registers exactly the commands declared in the manifest', () => {
  const commands = {}
  activate({
    events: { on: () => assert.fail('no event subscriptions are declared') },
    commands: { register: (id, handler) => (commands[id] = handler) },
    log: () => {}
  })
  assert.deepEqual(
    Object.keys(commands),
    manifest.contributes.commands.map((command) => command.id)
  )
})

test('milestone.hello writes to the plugin log', () => {
  const commands = {}
  const lines = []
  activate({
    events: { on: () => {} },
    commands: { register: (id, handler) => (commands[id] = handler) },
    log: (line) => lines.push(line)
  })
  commands['milestone.hello']()
  assert.deepEqual(lines, ['milestone: hello'])
})
