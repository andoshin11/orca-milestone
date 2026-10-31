// Keeps the panel document in step with the focused workspace, Claude's task lists and the state
// of every Claude agent Orca runs.
//
// Panels cannot receive data from a worker (their CSP is connect-src 'none' and there is no
// channel), so the worker rewrites the panel's HTML file instead. Orca rereads a panel's HTML on
// every plugin change and remounts the frame when it differs, and it watches development folders,
// so the rewrite reaches the sidebar within a second. That holds only for a development folder.
import { watch } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  claudePaths,
  findListTranscript,
  currentGoal,
  listRecentTaskLists,
  readPromptBeforeTask,
  readTaskList,
  readTranscriptHead
} from './claude-sessions.mjs'
import { buildModel } from './model.mjs'
import { readWorkspaces } from './orca-cli.mjs'
import { renderPanel } from './render.mjs'

const TASK_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const FOCUS_POLL_MS = 1000
// Other workspaces change state without any event the worker sees, so Orca is asked again.
const AGENTS_POLL_MS = 3000
const DEBOUNCE_MS = 150
const REQUEST_RETRY_MS = 30_000

export function createMilestoneWorker({
  orca,
  home,
  panelPath,
  cli,
  readOrca = readWorkspaces,
  now = Date.now,
  watchDir = (dir, onChange) => watch(dir, { recursive: true }, onChange)
}) {
  const paths = claudePaths(home)
  const { tasksRoot } = paths
  // Transcript heads never change once written; null entries are retried on the next refresh.
  const heads = new Map()
  // The request a list was made for, keyed by list and the subject of its first task.
  const requests = new Map()
  // Claude deletes a list's task files once every task is completed. The last tasks seen per
  // list keep a finished goal on screen as done instead of letting it vanish.
  const lastTasks = new Map()
  let workspace = null
  let agents = []
  let focusKey
  let lastHtml = null
  let started = null
  let timer = null
  let pendingFocus = false
  let running = null
  let rerun = false

  async function headOf(listId) {
    if (heads.has(listId)) return heads.get(listId)
    const transcript = await findListTranscript(paths, listId)
    const head = transcript ? await readTranscriptHead(transcript).catch(() => null) : null
    if (head) heads.set(listId, { ...head, transcript })
    return heads.get(listId) ?? null
  }

  /**
   * What a list is for right now. A session moves on to new goals, so its first prompt is only
   * a last resort: the goal Claude wrote on the tasks comes first, then the request the first
   * task was created for.
   */
  async function goalOf(listId, head, tasks) {
    const current = currentGoal(tasks)
    if (current.goal) return current
    const key = `${listId}\n${tasks[0].subject}`
    let request = requests.get(key)
    // A miss is retried later: the transcript can trail the task files, and a teammate's tasks
    // are not in the lead's transcript at all, so a whole read is not repeated every refresh.
    if (!request || (request.prompt === null && now() - request.at > REQUEST_RETRY_MS)) {
      const prompt = await readPromptBeforeTask(head.transcript, tasks[0].subject).catch(() => null)
      request = { prompt, at: now() }
      requests.set(key, request)
    }
    return { goal: request.prompt ?? head.goal, tasks }
  }

  async function allSessions() {
    const lists = await listRecentTaskLists(tasksRoot, { maxAgeMs: TASK_LIST_MAX_AGE_MS })
    const sessions = []
    for (const list of lists) {
      const tasks = currentTasks(list.listId, await readTaskList(list.dir))
      // A team creates its list when it starts, and most stay empty; they are not looked up.
      if (tasks.length === 0) continue
      const head = await headOf(list.listId)
      if (!head?.cwd) continue
      sessions.push({ ...list, cwd: head.cwd, ...(await goalOf(list.listId, head, tasks)) })
    }
    return sessions
  }

  function currentTasks(listId, tasks) {
    if (tasks.length > 0) {
      lastTasks.set(listId, tasks)
      return tasks
    }
    const previous = lastTasks.get(listId) ?? []
    // A list emptied before it was finished was cleared on purpose; show nothing for it.
    return previous.every((task) => task.status === 'completed') ? previous : []
  }

  async function writePanel(html) {
    if (html === lastHtml) return
    await mkdir(dirname(panelPath), { recursive: true })
    const temporary = `${panelPath}.tmp`
    await writeFile(temporary, html)
    await rename(temporary, panelPath)
    lastHtml = html
  }

  async function refreshOnce(askOrca) {
    if (askOrca || !workspace) {
      try {
        ;({ active: workspace, agents } = await readOrca(cli))
      } catch (error) {
        orca.log(`milestone: could not read the workspaces: ${error.message}`)
      }
    }
    const sessions = await allSessions()
    await writePanel(renderPanel(buildModel(workspace, sessions, agents, now())))
  }

  /** Runs refreshes one at a time; a request during a run starts one more afterwards. */
  async function refresh(focusChanged = false) {
    pendingFocus ||= focusChanged
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      do {
        rerun = false
        const focus = pendingFocus
        pendingFocus = false
        try {
          await refreshOnce(focus)
        } catch (error) {
          orca.log(`milestone: refresh failed: ${error.message}`)
        }
      } while (rerun)
    })()
    try {
      await running
    } finally {
      running = null
    }
  }

  function schedule(focusChanged = false) {
    pendingFocus ||= focusChanged
    clearTimeout(timer)
    timer = setTimeout(() => void refresh(), DEBOUNCE_MS)
  }

  async function pollFocus() {
    let context = null
    try {
      context = await orca.host.call('workspace.readContext', {})
    } catch (error) {
      orca.log(`milestone: workspace.readContext failed: ${error.code ?? error.message}`)
      return
    }
    const key = context ? `${context.branch}\n${context.displayName}` : ''
    if (key !== focusKey) {
      focusKey = key
      schedule(true)
    }
  }

  function start() {
    started ??= (async () => {
      await mkdir(tasksRoot, { recursive: true })
      watchDir(tasksRoot, (_event, name) => {
        if (name && !String(name).endsWith('.lock')) schedule()
      })
      setInterval(() => void pollFocus(), FOCUS_POLL_MS)
      setInterval(() => schedule(true), AGENTS_POLL_MS)
      await pollFocus()
      await refresh(true)
    })()
    return started
  }

  return { start, refresh, schedule }
}
