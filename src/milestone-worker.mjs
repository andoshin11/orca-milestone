// Keeps the panel document in step with the focused workspace and Claude's task lists.
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
  findTranscript,
  listRecentTaskLists,
  readTaskList,
  readTranscriptHead
} from './claude-sessions.mjs'
import { buildModel, isInside } from './model.mjs'
import { readActiveWorkspace } from './orca-cli.mjs'
import { renderPanel } from './render.mjs'

const TASK_LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const FOCUS_POLL_MS = 1000
const DEBOUNCE_MS = 150

export function createMilestoneWorker({
  orca,
  home,
  panelPath,
  cli,
  readActive = readActiveWorkspace,
  watchDir = (dir, onChange) => watch(dir, { recursive: true }, onChange)
}) {
  const { tasksRoot, projectsRoot } = claudePaths(home)
  // Transcript heads never change once written; null entries are retried on the next refresh.
  const heads = new Map()
  // Claude deletes a list's task files once every task is completed. The last tasks seen per
  // session keep a finished goal on screen as done instead of letting it vanish.
  const lastTasks = new Map()
  let workspace = null
  let focusKey
  let lastHtml = null
  let started = null
  let timer = null
  let pendingFocus = false
  let running = null
  let rerun = false

  async function headOf(sessionId) {
    if (heads.has(sessionId)) return heads.get(sessionId)
    const transcript = await findTranscript(projectsRoot, sessionId)
    const head = transcript ? await readTranscriptHead(transcript).catch(() => null) : null
    if (head) heads.set(sessionId, head)
    return head
  }

  async function sessionsIn(root) {
    const lists = await listRecentTaskLists(tasksRoot, { maxAgeMs: TASK_LIST_MAX_AGE_MS })
    const sessions = []
    for (const list of lists) {
      const head = await headOf(list.sessionId)
      if (!head?.cwd || !isInside(head.cwd, root)) continue
      sessions.push({ ...list, ...head, tasks: currentTasks(list.sessionId, await readTaskList(list.dir)) })
    }
    return sessions
  }

  function currentTasks(sessionId, tasks) {
    if (tasks.length > 0) {
      lastTasks.set(sessionId, tasks)
      return tasks
    }
    const previous = lastTasks.get(sessionId) ?? []
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

  async function refreshOnce(focusChanged) {
    if (focusChanged || !workspace) {
      try {
        workspace = await readActive(cli)
      } catch (error) {
        orca.log(`milestone: could not read the focused workspace: ${error.message}`)
      }
    }
    const sessions = workspace ? await sessionsIn(workspace.path) : []
    await writePanel(renderPanel(buildModel(workspace, sessions)))
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
      await pollFocus()
      await refresh(true)
    })()
    return started
  }

  return { start, refresh, schedule }
}
