import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildModel, isInside } from '../src/model.mjs'
import { renderPanel } from '../src/render.mjs'
import { task } from './helpers.mjs'

const workspace = { path: '/work/app', displayName: 'app', claudeStates: ['working'] }

test('isInside matches the root and its subfolders only', () => {
  assert.ok(isInside('/work/app', '/work/app'))
  assert.ok(isInside('/work/app/pkg', '/work/app'))
  assert.ok(!isInside('/work/app-2', '/work/app'))
})

test('buildModel keeps sessions with tasks inside the focused workspace', () => {
  const model = buildModel(workspace, [
    { listId: 'a', cwd: '/work/app/pkg', goal: 'Goal A', tasks: [task(1, 'x', 'completed'), task(2, 'y', 'pending')] },
    { listId: 'b', cwd: '/work/other', goal: 'Goal B', tasks: [task(1, 'z', 'pending')] },
    { listId: 'c', cwd: '/work/app', goal: 'Goal C', tasks: [] }
  ])
  assert.equal(model.kind, 'sessions')
  assert.equal(model.agent, 'working')
  assert.deepEqual(
    model.sessions.map((s) => [s.listId, s.done, s.total]),
    [['a', 1, 2]]
  )
})

test('buildModel reports no workspace and no tasks', () => {
  assert.equal(buildModel(null, []).kind, 'no-workspace')
  const model = buildModel({ ...workspace, claudeStates: [] }, [])
  assert.equal(model.kind, 'no-tasks')
  assert.equal(model.agent, 'none')
})

test('renderPanel escapes text, shows progress and is deterministic', () => {
  const model = buildModel(workspace, [
    {
      listId: 'a',
      cwd: '/work/app',
      goal: 'Fix <script> injection',
      tasks: [task(1, 'Read spec', 'completed'), task(2, 'Write code', 'in_progress', { activeForm: 'Writing code' }), task(3, 'Run tests', 'pending')]
    }
  ])
  const html = renderPanel(model)
  assert.ok(html.includes('Fix &lt;script&gt; injection'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('1 / 3'))
  assert.ok(html.includes('width:33%'))
  assert.ok(html.includes('Writing code'))
  assert.ok(html.includes('作業中'))
  assert.equal(renderPanel(model), html)
})

test('the machine summary sorts agents into needing the user and at work, with their progress', () => {
  const now = 10 * 60 * 60 * 1000
  const agent = (workspace, state, minutesAgo, extra = {}) => ({
    workspace,
    path: `/work/${workspace}`,
    focused: false,
    unread: false,
    state,
    since: now - minutesAgo * 60_000,
    title: null,
    ...extra
  })
  const model = buildModel(
    workspace,
    [{ listId: 'q', cwd: '/work/question/pkg', goal: 'Answer the question', tasks: [task(1, 'x', 'completed'), task(2, 'y', 'pending')] }],
    [
      agent('question', 'waiting', 12),
      agent('allow', 'blocked', 30),
      agent('finished', 'done', 3, { unread: true }),
      agent('seen', 'done', 90),
      agent('busy', 'working', 0.5, { title: 'Orca title' }),
      agent('app', 'waiting', 5, { focused: true })
    ],
    now
  )
  assert.deepEqual(model.machine.counts, { attention: 4, working: 1, idle: 1 })
  assert.deepEqual(
    model.machine.attention.map((row) => [row.workspace, row.reason]),
    [['allow', 'permission'], ['question', 'input'], ['finished', 'review']]
  )
  const question = model.machine.attention[1]
  assert.deepEqual([question.goal, question.done, question.total, question.age], ['Answer the question', 1, 2, { unit: 'minutes', value: 12 }])
  assert.equal(model.machine.working[0].goal, 'Orca title')

  const html = renderPanel(model)
  assert.ok(html.includes('このマシンの Claude'))
  assert.ok(html.includes('入力待ち 12分'))
  assert.ok(html.includes('未確認 3分'))
  assert.ok(html.includes('Orca title'))
  assert.equal(renderPanel(model), html)
})
