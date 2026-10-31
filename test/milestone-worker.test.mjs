import assert from 'node:assert/strict'
import { appendFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createMilestoneWorker } from '../src/milestone-worker.mjs'
import { SESSION_A, SESSION_B, makeHome, task, writeTasks, writeTranscript } from './helpers.mjs'

function fakeOrca(context = { branch: 'main', displayName: 'app', terminals: [] }) {
  return { host: { call: async () => context }, log: () => {} }
}

test('refresh writes the focused workspace tasks to the panel, and only when they change', async () => {
  const home = await makeHome()
  const panelPath = join(home, 'plugin', 'panel', 'index.html')
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', prompt: 'Build milestones' })
  await writeTasks(home, SESSION_A, [task(1, 'Read spec', 'completed'), task(2, 'Write code', 'in_progress')])
  await writeTranscript(home, SESSION_B, { cwd: '/work/other', prompt: 'Something else' })
  await writeTasks(home, SESSION_B, [task(1, 'Unrelated', 'pending')])

  let cliCalls = 0
  const worker = createMilestoneWorker({
    orca: fakeOrca(),
    home,
    panelPath,
    cli: 'orca',
    readActive: async () => {
      cliCalls += 1
      return { path: '/work/app', displayName: 'app', claudeStates: ['working'] }
    },
    watchDir: () => {}
  })

  await worker.refresh(true)
  const first = await readFile(panelPath, 'utf8')
  assert.ok(first.includes('Build milestones'))
  assert.ok(first.includes('1 / 2'))
  assert.ok(!first.includes('Unrelated'))

  await writeTasks(home, SESSION_A, [task(2, 'Write code', 'completed'), task(3, 'Run tests', 'in_progress')])
  await worker.refresh()
  const second = await readFile(panelPath, 'utf8')
  assert.ok(second.includes('2 / 3'))
  assert.equal(cliCalls, 1, 'a task change alone does not ask the CLI again')
})

test('a list Claude deletes after finishing stays on screen as done; a cleared unfinished one goes', async () => {
  const home = await makeHome()
  const panelPath = join(home, 'panel', 'index.html')
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', prompt: 'Finish me' })
  await writeTranscript(home, SESSION_B, { cwd: '/work/app', prompt: 'Abandon me' })
  const doneDir = await writeTasks(home, SESSION_A, [task(1, 'Only step', 'completed')])
  const clearedDir = await writeTasks(home, SESSION_B, [task(1, 'Half step', 'in_progress')])
  const worker = createMilestoneWorker({
    orca: fakeOrca(),
    home,
    panelPath,
    cli: 'orca',
    readActive: async () => ({ path: '/work/app', displayName: 'app', claudeStates: [] }),
    watchDir: () => {}
  })
  await worker.refresh(true)
  await rm(join(doneDir, '1.json'))
  await rm(join(clearedDir, '1.json'))
  await worker.refresh()
  const html = await readFile(panelPath, 'utf8')
  assert.ok(html.includes('Finish me'))
  assert.ok(html.includes('1 / 1'))
  assert.ok(!html.includes('Abandon me'))
})

test('a team lead\'s list, named session-<id prefix>, shows under its workspace', async () => {
  const home = await makeHome()
  const panelPath = join(home, 'panel', 'index.html')
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', prompt: 'Team goal' })
  await writeTasks(home, 'session-11111111', [task(1, 'Plan', 'completed'), task(2, 'Build', 'pending')])
  await writeTasks(home, 'session-22222222', [])
  const worker = createMilestoneWorker({
    orca: fakeOrca(),
    home,
    panelPath,
    cli: 'orca',
    readActive: async () => ({ path: '/work/app', displayName: 'app', claudeStates: [] }),
    watchDir: () => {}
  })
  await worker.refresh(true)
  const html = await readFile(panelPath, 'utf8')
  assert.ok(html.includes('Team goal'))
  assert.ok(html.includes('1 / 2'))
})

test('the heading follows the goal of the current tasks, not the first prompt of the session', async () => {
  const home = await makeHome()
  const panelPath = join(home, 'panel', 'index.html')
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', prompt: 'First goal' })
  const transcript = join(home, '.claude', 'projects', '-work-app', `${SESSION_A}.jsonl`)
  await appendFile(
    transcript,
    [
      { type: 'user', cwd: '/work/app', message: { role: 'user', content: 'Second goal' } },
      { type: 'assistant', cwd: '/work/app', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'TaskCreate', input: { subject: 'Step two' } }] } }
    ].map((line) => JSON.stringify(line)).join('\n') + '\n'
  )
  await writeTasks(home, SESSION_A, [task(1, 'Step two', 'pending')])
  const worker = createMilestoneWorker({
    orca: fakeOrca(),
    home,
    panelPath,
    cli: 'orca',
    readActive: async () => ({ path: '/work/app', displayName: 'app', claudeStates: [] }),
    watchDir: () => {}
  })
  await worker.refresh(true)
  let html = await readFile(panelPath, 'utf8')
  assert.ok(html.includes('Second goal'))
  assert.ok(!html.includes('First goal'))

  await writeTasks(home, SESSION_A, [
    task(1, 'Step two', 'completed'),
    task(2, 'Step three', 'pending', { metadata: { goal: 'Goal Claude wrote' } })
  ])
  await worker.refresh()
  html = await readFile(panelPath, 'utf8')
  assert.ok(html.includes('Goal Claude wrote'))
  assert.ok(html.includes('0 / 1'), 'tasks of the earlier goal are left out')
  assert.ok(!html.includes('Step two'))
})

test('a failing CLI leaves the panel showing that no workspace is known', async () => {
  const home = await makeHome()
  const panelPath = join(home, 'panel', 'index.html')
  const logs = []
  const worker = createMilestoneWorker({
    orca: { ...fakeOrca(), log: (line) => logs.push(line) },
    home,
    panelPath,
    cli: 'orca',
    readActive: async () => {
      throw new Error('runtime unavailable')
    },
    watchDir: () => {}
  })
  await worker.refresh(true)
  assert.ok((await readFile(panelPath, 'utf8')).includes('ワークスペースを開くと'))
  assert.match(logs.join('\n'), /runtime unavailable/)
})
