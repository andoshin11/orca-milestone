import assert from 'node:assert/strict'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  claudePaths,
  findListTranscript,
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

test('listRecentTaskLists keeps session and team lists changed within the window, newest first', async () => {
  const home = await makeHome()
  const { tasksRoot } = claudePaths(home)
  const now = Date.now()
  await utimes(await writeTasks(home, SESSION_A, [task(1, 'A', 'pending')]), now / 1000, (now - 5000) / 1000)
  await utimes(await writeTasks(home, SESSION_B, [task(1, 'B', 'pending')]), now / 1000, (now - 1000) / 1000)
  await utimes(await writeTasks(home, 'session-1234abcd', []), now / 1000, (now - 3000) / 1000)
  await mkdir(join(tasksRoot, 'not-a-list'), { recursive: true })
  const lists = await listRecentTaskLists(tasksRoot, { now, maxAgeMs: 60_000 })
  assert.deepEqual(lists.map((list) => list.listId), [SESSION_B, 'session-1234abcd', SESSION_A])
  assert.deepEqual(await listRecentTaskLists(tasksRoot, { now, maxAgeMs: 2000 }).then((l) => l.map((x) => x.listId)), [SESSION_B])
})

test('findListTranscript finds a team lead by the team config, or by the id prefix once it is gone', async () => {
  const home = await makeHome()
  const paths = claudePaths(home)
  await writeTranscript(home, SESSION_A, { cwd: '/work/app', prompt: 'Lead the team' })
  const teamDir = join(paths.teamsRoot, 'session-11111111')
  await mkdir(teamDir, { recursive: true })
  await writeFile(join(teamDir, 'config.json'), JSON.stringify({ leadSessionId: SESSION_A }))
  const expected = await findTranscript(paths.projectsRoot, SESSION_A)
  assert.equal(await findListTranscript(paths, 'session-11111111'), expected)
  assert.equal(await findListTranscript(paths, SESSION_A), expected)
  assert.equal(await findListTranscript({ ...paths, teamsRoot: join(home, 'no-teams') }, 'session-11111111'), expected)
  assert.equal(await findListTranscript(paths, 'session-22222222'), null)
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
