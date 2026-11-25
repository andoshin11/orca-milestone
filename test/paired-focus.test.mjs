import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMilestoneWorker } from '../src/milestone-worker.mjs'
import { buildModel, withPairedFocus } from '../src/model.mjs'
import { pairedPathOf, placeOf, readSnapshot, splitByPlace } from '../src/remote.mjs'
import { renderBody } from '../src/render.mjs'
import { makeHome } from './helpers.mjs'

const PATH = '/Users/me/orca/workspaces/app/rate-limit'
// What Orca's `workspace.changed` gives a worker for a workspace of a paired Orca server.
const CONTEXT = { workspaceId: `repo-1::${PATH}`, branch: 'rate-limit', displayName: 'rate limit', terminals: [] }

const tasks = (rows) => JSON.stringify(rows)
const BODY = {
  v: '1',
  at: '1',
  sessions: [
    { id: 'a', agent: 'claude', state: 'active', live: '1', attention: 'permission', workspace: 'rate-limit', place: placeOf(PATH), goal: 'Rate limit', tasks: tasks([['c', 'Read'], ['i', 'Writing code'], ['p', 'Test']]), done: '1', total: '3', offer: 'o-a', suggestions: JSON.stringify(['許可', '拒否']), details: JSON.stringify(['', '']), question: '［実行する］Bash を許可しますか？ ls' },
    { id: 'b', agent: 'claude', state: 'active', live: '1', attention: '', workspace: 'web', place: placeOf('/Users/me/orca/workspaces/web'), goal: 'Dark mode', tasks: tasks([['i', 'Colors']]), done: '0', total: '1' }
  ]
}

test('the path of a paired server’s workspace is read from the id Orca gives it', () => {
  assert.equal(pairedPathOf(CONTEXT), PATH)
  assert.equal(pairedPathOf({ workspaceId: 'identity:wt2:ssh%3Ahost:abc' }), null)
  assert.equal(pairedPathOf({ workspaceId: 'repo::relative/path' }), null)
  assert.equal(pairedPathOf(null), null)
  assert.equal(placeOf(PATH).length, 16)
})

test('readSnapshot keeps where a session runs, and an older daemon’s sessions match no workspace', () => {
  const { sessions } = readSnapshot(BODY)
  const { mine, others } = splitByPlace(sessions, PATH)
  assert.deepEqual(mine.map((s) => s.id), ['a'])
  assert.deepEqual(others.map((s) => s.id), ['b'])
  const old = readSnapshot({ ...BODY, sessions: BODY.sessions.map(({ place, ...rest }) => rest) })
  assert.equal(splitByPlace(old.sessions, PATH).mine.length, 0)
})

test('a focused workspace of a paired server shows its tasks and cards at the top, and the rest below', () => {
  const remote = { label: 'Mac mini', ...readSnapshot(BODY) }
  const model = withPairedFocus(buildModel(null, [], [], []), CONTEXT, remote)
  assert.equal(model.kind, 'sessions')
  assert.equal(model.workspace, 'rate limit')
  assert.equal(model.agent, 'waiting')
  assert.equal(model.next.id, 'o-a')
  assert.deepEqual(model.remote.sessions.map((s) => s.id), ['b'])
  const html = renderBody(model)
  assert.ok(html.startsWith('<main class="paired"><header><h1>rate limit<span class="host">Mac mini</span></h1>'))
  assert.ok(html.includes('1 / 3'))
  assert.ok(html.includes('data-next="o-a" data-index="0"'))
  assert.equal(html.split('data-next="o-a"').length - 1, 2, 'its cards are not repeated below')
  assert.ok(html.includes('Dark mode'))

  // Nothing there yet: its name with nothing to show.
  const empty = withPairedFocus(buildModel(null, [], [], []), { ...CONTEXT, workspaceId: 'repo-1::/Users/me/new' }, remote)
  assert.equal(empty.kind, 'no-tasks')
  assert.equal(empty.workspace, 'rate limit')
  assert.equal(empty.remote.sessions.length, 2)
})

test('a workspace focused here, a daemon out of reach or none set leaves the panel as it was', () => {
  const remote = { label: 'Mac mini', ...readSnapshot(BODY) }
  const local = buildModel({ path: '/w/here', displayName: 'here', agentStates: [] }, [], [], [])
  assert.equal(withPairedFocus(local, CONTEXT, remote).workspace, 'here')
  assert.equal(withPairedFocus(local, CONTEXT, remote).remote.sessions.length, 2)
  assert.equal(withPairedFocus(buildModel(null, []), CONTEXT, { label: 'Mac mini', error: 'unreachable' }).kind, 'no-workspace')
  assert.equal(withPairedFocus(buildModel(null, []), CONTEXT, null).kind, 'no-workspace')
})

test('the worker follows Orca’s focus to a paired server’s workspace and presses its cards there', async () => {
  const posts = []
  const orca = { log: () => {}, panels: { post: (_event, payload) => posts.push(payload.html) } }
  const presses = []
  let settings = { remoteUrl: 'mac.example.ts.net', remoteLabel: 'Mac mini' }
  const worker = createMilestoneWorker({
    orca,
    home: await makeHome(),
    cli: 'orca',
    readOrca: async () => ({ active: null, agents: [], offers: [] }),
    watchDir: () => {},
    remote: { read: async () => readSnapshot(BODY), press: async (_url, request) => (presses.push(request), { sent: true }) },
    readSettings: async () => settings,
    remoteMs: 60_000
  })
  await worker.readRemote()
  await worker.refresh(true)
  assert.ok(!posts.at(-1).includes('<main class="paired">'))
  worker.focusChanged(CONTEXT)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.ok(posts.at(-1).includes('<main class="paired">'))
  assert.deepEqual(await worker.sendNext({ offer: 'o-a', index: 0 }), { sent: true })
  assert.deepEqual(presses, [{ offer: 'o-a', index: 0 }])
  worker.focusChanged(null)
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.ok(!posts.at(-1).includes('<main class="paired">'))
  // Clearing the setting stops the daemon's timer.
  settings = {}
  await worker.readRemote()
})
