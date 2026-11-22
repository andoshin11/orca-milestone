import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMilestoneWorker } from '../src/milestone-worker.mjs'
import { createRemoteClient, readSnapshot, statusUrl } from '../src/remote.mjs'
import { renderBody } from '../src/render.mjs'
import { makeHome } from './helpers.mjs'

const tasks = (rows) => JSON.stringify(rows)

const BODY = {
  v: '1',
  at: '1700000000000',
  sessions: [
    { id: 'a', agent: 'claude', state: 'finished', live: '1', attention: '', workspace: 'done-app', goal: 'Ship it', tasks: tasks([['c', 'Build'], ['c', 'Test']]), done: '2', total: '2', offer: 'o-a', suggestions: JSON.stringify(['Deploy']), details: JSON.stringify(['Deploy to staging']), reasons: JSON.stringify(['Tests passed']), question: 'Shipped; tests pass.' },
    { id: 'b', agent: 'claude', state: 'active', live: '1', attention: 'permission', workspace: 'api', goal: 'Rate limit', tasks: tasks([['c', 'Read'], ['i', 'Writing code'], ['p', 'Test']]), done: '1', total: '3', offer: 'o-b', suggestions: JSON.stringify(['許可', '拒否']), details: JSON.stringify(['', '']), question: '［実行する］Bash を許可しますか？ rm -rf build', dangerous: '1' },
    { id: 'c', agent: 'codex', state: 'active', live: '0', attention: 'waiting', workspace: 'web', goal: '', tasks: '[]', done: '0', total: '0', offer: 'o-c', suggestions: JSON.stringify(['100', '300']), details: JSON.stringify(['推奨', '']), question: 'How many per minute?' },
    { id: 'd', agent: 'claude', state: 'active', live: '1', attention: 'waiting', workspace: 'form', goal: 'Ask', tasks: '[]', done: '0', total: '0', offer: 'o-d', suggestions: '[]', details: '[]', questions: JSON.stringify([{ question: 'Which?', multiSelect: true, options: [{ label: 'A', detail: 'first' }, { label: 'B' }] }]) },
    { id: 'e', agent: 'claude', state: 'active', live: '1', attention: '', workspace: 'quiet', goal: 'Refactor', tasks: tasks([['i', 'Moving files']]), done: '0', total: '1' }
  ]
}

test('statusUrl takes a bare host or an https URL and refuses anything else', () => {
  assert.equal(statusUrl('mac.example.ts.net').href, 'https://mac.example.ts.net/status.json')
  assert.equal(statusUrl(' https://mac.example.ts.net/ ').href, 'https://mac.example.ts.net/status.json')
  assert.equal(statusUrl('https://mac.example.ts.net/status.json?x=1').href, 'https://mac.example.ts.net/status.json')
  assert.equal(statusUrl('http://mac.example.ts.net'), null)
  assert.equal(statusUrl('https://user:pw@mac.example.ts.net'), null)
  assert.equal(statusUrl(''), null)
  assert.equal(statusUrl(undefined), null)
})

test('readSnapshot tells each kind of offer by its fields and puts those needing the user first', () => {
  const { sessions } = readSnapshot(BODY)
  assert.deepEqual(sessions.map((s) => s.id), ['b', 'c', 'd', 'e', 'a'])
  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]))
  assert.equal(byId.a.offer.kind, 'proposal')
  assert.deepEqual(byId.a.offer.suggestions, [{ label: 'Deploy', reason: 'Tests passed', prompt: 'Deploy to staging' }])
  assert.equal(byId.a.offer.summary, 'Shipped; tests pass.', 'a finished turn’s text is a summary, not a question')
  assert.equal(byId.b.offer.kind, 'permission')
  assert.equal(byId.b.offer.dangerous, true)
  assert.deepEqual(byId.b.offer.suggestions.map((s) => s.action), ['allow', 'deny'])
  assert.equal(byId.c.offer.kind, 'question')
  assert.equal(byId.c.live, false)
  assert.equal(byId.d.offer.kind, 'form')
  assert.deepEqual(byId.d.offer.questions[0].options, [{ label: 'A', detail: 'first' }, { label: 'B', detail: '' }])
  assert.equal(byId.e.offer, null)
  assert.deepEqual(byId.b.tasks, [{ status: 'completed', subject: 'Read' }, { status: 'in_progress', subject: 'Writing code' }, { status: 'pending', subject: 'Test' }])
  assert.throws(() => readSnapshot({}), TypeError)
})

test('the panel shows the remote sessions with their cards, and the daemon’s failures in words', () => {
  const remote = { label: 'Mac mini', ...readSnapshot(BODY) }
  const html = renderBody({ kind: 'no-workspace', others: { attention: 0, rows: [] }, remote })
  assert.ok(html.includes('<div class="remote"><h2><span>Mac mini</span><span class="attention">要確認 3</span></h2>'))
  assert.ok(html.includes('data-next="o-b" data-index="0" data-dangerous="1"'))
  assert.ok(html.includes('data-submit="o-d"'))
  assert.ok(html.includes('Deploy to staging'))
  assert.ok(html.includes('<p class="summary">Shipped; tests pass.</p>'))
  assert.ok(html.includes('1 / 3'))
  assert.ok(!html.includes('data-open='), 'a remote row has no path here to open')
  const failed = renderBody({ kind: 'no-workspace', others: { attention: 0, rows: [] }, remote: { label: 'Mac mini', error: 'unreachable' } })
  assert.ok(failed.includes('つながりません'))
  const none = renderBody({ kind: 'no-workspace', others: { attention: 0, rows: [] }, remote: null })
  assert.ok(!none.includes('class="remote"'))
})

function fakeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const route = routes[`${init.method ?? 'GET'} ${new URL(url).pathname}`]
    if (route instanceof Error) throw route
    return route
  }
  return { impl, calls }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('the client reads the sessions and turns the daemon’s answers to a press into reasons', async () => {
  const url = statusUrl('mac.example.ts.net')
  for (const [status, expected] of [[204, { sent: true }], [409, { sent: false, reason: 'stale' }], [423, { sent: false, reason: 'busy' }], [428, { sent: false, reason: 'confirm' }], [403, { sent: false, reason: 'forbidden' }], [502, { sent: false, reason: 'failed' }]]) {
    const { impl, calls } = fakeFetch({ 'POST /next': new Response(null, { status }) })
    assert.deepEqual(await createRemoteClient({ fetchImpl: impl }).press(url, { offer: 'o-b', index: 0, confirmed: true }), expected)
    assert.equal(calls[0].url, 'https://mac.example.ts.net/next')
    assert.deepEqual(JSON.parse(calls[0].init.body), { offer: 'o-b', index: 0, confirmed: true })
  }
  const ok = fakeFetch({ 'GET /status.json': json(BODY) })
  assert.equal((await createRemoteClient({ fetchImpl: ok.impl }).read(url)).sessions.length, 5)
  const down = fakeFetch({ 'GET /status.json': new TypeError('fetch failed') })
  assert.deepEqual(await createRemoteClient({ fetchImpl: down.impl }).read(url), { error: 'unreachable' })
  const loading = fakeFetch({ 'GET /status.json': json({ error: 'not read yet' }, 503) })
  assert.deepEqual(await createRemoteClient({ fetchImpl: loading.impl }).read(url), { error: 'loading' })
  const odd = fakeFetch({ 'GET /status.json': json({ nope: true }) })
  assert.deepEqual(await createRemoteClient({ fetchImpl: odd.impl }).read(url), { error: 'unreadable' })
})

function fakeOrca() {
  const posts = []
  return {
    log: () => {},
    panels: { post: (event, payload) => posts.push({ event, payload }) },
    shown: () => posts.at(-1)?.payload.html ?? ''
  }
}

test('the worker shows the daemon the settings name and sends its cards there, not to a local agent', async () => {
  const home = await makeHome()
  const orca = fakeOrca()
  const presses = []
  const remote = {
    read: async () => readSnapshot(BODY),
    press: async (url, request) => {
      presses.push({ url: url.href, request })
      return { sent: true }
    }
  }
  let settings = { remoteUrl: 'mac.example.ts.net', remoteLabel: 'Mac mini' }
  const worker = createMilestoneWorker({
    orca,
    home,
    cli: 'orca',
    readOrca: async () => ({ active: null, agents: [], offers: [] }),
    watchDir: () => {},
    remote,
    readSettings: async () => settings,
    remoteMs: 60_000
  })
  await worker.readRemote()
  await worker.refresh(true)
  assert.ok(orca.shown().includes('<span>Mac mini</span>'))
  assert.ok(orca.shown().includes('Rate limit'))

  assert.deepEqual(await worker.sendNext({ offer: 'o-c', index: 1 }), { sent: true })
  assert.deepEqual(presses, [{ url: 'https://mac.example.ts.net/status.json', request: { offer: 'o-c', index: 1 } }])

  // A card that is not the daemon's goes the local way, which finds nothing to press here.
  const local = await worker.sendNext({ offer: 'o-local', index: 0 })
  assert.equal(local.sent, false)
  assert.equal(presses.length, 1)

  // Clearing the setting takes the section away and stops its timer.
  settings = { remoteUrl: '' }
  await worker.readRemote()
  await worker.refresh()
  assert.ok(!orca.shown().includes('class="remote"'))
})
