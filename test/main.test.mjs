import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import activate from '../main.mjs'
import { enableTaskTools } from '../src/launch-hook.mjs'

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'orca-plugin.json'), 'utf8'))

test('registers the commands and events declared in the manifest, and starts nothing on activate', () => {
  const commands = []
  const events = []
  const handlers = []
  const hooks = []
  activate({
    host: { call: () => assert.fail('activate must not call the host') },
    events: { on: (event) => events.push(event) },
    commands: { register: (id) => commands.push(id) },
    panels: { handle: (name) => handlers.push(name), post: () => assert.fail('activate must not post') },
    hooks: { on: (hook) => hooks.push(hook) },
    log: () => {}
  })
  assert.deepEqual(commands, manifest.contributes.commands.map((command) => command.id))
  assert.deepEqual(events, manifest.contributes.events.map((event) => event.on))
  assert.deepEqual(handlers, ['view.get', 'workspace.open'])
  assert.deepEqual(hooks, manifest.contributes.hooks.map((hook) => hook.event))
})

test('a Claude launch gets the task tools turned on, and other agents pass untouched', () => {
  const next = (event) => event
  const decided = enableTaskTools({ agent: 'claude', command: 'claude', env: { KEPT: 'x' } }, next)
  assert.deepEqual(decided.env, { KEPT: 'x', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' })
  assert.equal(decided.command, 'claude')

  assert.equal(enableTaskTools({ agent: 'codex', command: 'codex', env: {} }, () => assert.fail('passes')), undefined)
})
