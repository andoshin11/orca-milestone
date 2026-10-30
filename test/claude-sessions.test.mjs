import assert from 'node:assert/strict'
import { mkdir, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  claudePaths,
  findTranscript,
  listRecentTaskLists,
  readTaskList,
  readTranscriptHead
} from '../src/claude-sessions.mjs'
import { SESSION_A, SESSION_B, makeHome, task, writeTasks, writeTranscript } from './helpers.mjs'

test('readTaskList orders tasks by numeric id and skips other files', async () => {
  const home = await makeHome()
  const dir = await writeTasks(home, SESSION_A, [
    task(10, 'Ten', 'pending'),
    task(2, 'Two', 'completed'),
    task(1, 'One', 'in_progress')
  ])
  assert.deepEqual(
    (await readTaskList(dir)).map((t) => t.subject),
    ['One', 'Two', 'Ten']
  )
  assert.deepEqual(await readTaskList(join(home, 'missing')), [])
})

test('listRecentTaskLists keeps session-id lists changed within the window, newest first', async () => {
  const home = await makeHome()
  const { tasksRoot } = claudePaths(home)
  const now = Date.now()
  await utimes(await writeTasks(home, SESSION_A, [task(1, 'A', 'pending')]), now / 1000, (now - 5000) / 1000)
  await utimes(await writeTasks(home, SESSION_B, [task(1, 'B', 'pending')]), now / 1000, (now - 1000) / 1000)
  await mkdir(join(tasksRoot, 'session-1234abcd'), { recursive: true })
  const lists = await listRecentTaskLists(tasksRoot, { now, maxAgeMs: 60_000 })
  assert.deepEqual(lists.map((list) => list.sessionId), [SESSION_B, SESSION_A])
  assert.deepEqual(await listRecentTaskLists(tasksRoot, { now, maxAgeMs: 2000 }).then((l) => l.map((x) => x.sessionId)), [SESSION_B])
})

test('readTranscriptHead finds the cwd, branch and first real prompt', async () => {
  const home = await makeHome()
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', gitBranch: 'feat/x', prompt: '  Ship the milestone panel  ' })
  const path = await findTranscript(claudePaths(home).projectsRoot, SESSION_A)
  assert.ok(path)
  assert.deepEqual(await readTranscriptHead(path), {
    cwd: '/work/app',
    gitBranch: 'feat/x',
    goal: 'Ship the milestone panel'
  })
  assert.equal(await findTranscript(claudePaths(home).projectsRoot, SESSION_B), null)
})
