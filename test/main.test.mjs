import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import activate from '../main.mjs'
import { createLaunchHook, withProgressTool } from '../src/launch-hook.mjs'

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

const paths = { execPath: '/Apps/Orca.app/MacOS/Orca', serverPath: '/plugin/src/progress-server.mjs' }

test('a Claude launch gets the task tools turned on, and an unknown agent passes untouched', () => {
  const hook = createLaunchHook(paths)
  const next = (event) => event
  const decided = hook({ agent: 'claude', command: 'claude', env: { KEPT: 'x' } }, next)
  assert.deepEqual(decided.env, { KEPT: 'x', CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' })
  assert.equal(decided.command, 'claude')

  assert.equal(hook({ agent: 'gemini', command: 'gemini', env: {} }, () => assert.fail('passes')), undefined)
})

test('a Codex launch gets the progress tool, keeping the rest of its command line', () => {
  const hook = createLaunchHook(paths)
  const { command, env } = hook({ agent: 'codex', command: "/bin/codex --yolo 'do it'", env: {} }, (event) => event)
  assert.deepEqual(env, {})
  assert.ok(command.startsWith('/bin/codex -c '))
  assert.ok(command.endsWith(" --yolo 'do it'"))
  assert.ok(command.includes(`-c 'mcp_servers.milestone.command="/Apps/Orca.app/MacOS/Orca"'`))
  assert.ok(command.includes(`-c 'mcp_servers.milestone.args=["/plugin/src/progress-server.mjs"]'`))
  assert.ok(command.includes(`-c 'mcp_servers.milestone.env={ELECTRON_RUN_AS_NODE="1"}'`))
  assert.ok(command.includes(`-c 'developer_instructions="Before you start`))
  assert.equal(command.match(/'/g).length % 2, 0, 'the quotes balance')
})

test('withProgressTool leaves other commands and paths it cannot quote alone', () => {
  assert.equal(withProgressTool('env X=1 codex', paths), 'env X=1 codex')
  assert.equal(withProgressTool('codexish', paths), 'codexish')
  assert.equal(withProgressTool('codex', { ...paths, serverPath: "/it's/server.mjs" }), 'codex')
})
