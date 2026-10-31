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

test('other workspaces list those needing the user first, then unfinished and finished lists', () => {
  const agent = (name, state, since, extra = {}) => ({ workspace: name, repo: 'repo-x', path: `/work/${name}`, focused: false, state, since, ...extra })
  const list = (name, done, total, updatedAt, running = false) => ({
    listId: name,
    cwd: `/work/${name}/pkg`,
    goal: `Goal ${name}`,
    updatedAt,
    tasks: Array.from({ length: total }, (_, i) => task(i + 1, `t${i}`, i < done ? 'completed' : running && i === done ? 'in_progress' : 'pending'))
  })
  const lists = [list('question', 1, 2, 50), list('older', 0, 1, 10), list('newer', 2, 3, 40, true), list('finished', 1, 1, 60)]
  const model = buildModel(workspace, lists, [
    agent('question', 'waiting', 1),
    agent('question', 'working', 2),
    agent('allow', 'blocked', 5),
    agent('older', 'done', 9),
    agent('newer', 'working', 8),
    agent('finished', 'done', 8),
    agent('busy', 'working', 7),
    agent('app', 'waiting', 6, { focused: true })
  ])
  assert.equal(model.others.attention, 3)
  assert.deepEqual(
    model.others.rows.map((row) => [row.workspace, row.kind, row.done, row.total]),
    [
      ['question', 'attention', 1, 2],
      ['allow', 'attention', 0, 0],
      ['newer', 'idle', 2, 3],
      ['older', 'idle', 0, 1],
      ['finished', 'idle', 1, 1]
    ]
  )

  const html = renderPanel(model)
  assert.ok(html.includes('ほかのワークスペース'))
  assert.ok(html.includes('要確認 3'))
  assert.equal(html.match(/class="badge"/g).length, 2)
  assert.ok(html.includes('width:67%'))
  assert.ok(!html.includes('busy'))
  // Only the finished row gets a check; the others keep a dot.
  assert.equal(html.match(/<span class="check">✓<\/span><span class="name">finished/g).length, 1)
  assert.equal(html.match(/class="check"/g).length, 1)
  // Only the row with a task in progress gets the orange dot.
  assert.equal(html.match(/<span class="dot running"><\/span><span class="name">newer/g).length, 1)
  assert.equal(html.match(/class="dot running"/g).length, 1)
  assert.ok(html.includes('<span class="name">question<span class="repo">repo-x</span></span>'))
  // Rows with tasks show their goal and tasks on hover; rows without have none.
  assert.equal(html.match(/<div class="detail">/g).length, 4)
  assert.ok(html.includes('<div class="detail"><div class="title"><b>question</b><span class="repo">repo-x</span><span class="of">1 / 2</span></div>'))
  assert.ok(html.includes('<p class="goal">Goal question</p>'))
  assert.ok(!html.includes('CLAUDE_CODE_ENABLE_TODO_TOOLS'))
  assert.equal(renderPanel(model), html)
})
