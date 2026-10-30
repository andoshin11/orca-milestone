// Reads Claude Code's task lists (~/.claude/tasks/<session-id>/<n>.json) and the session
// transcripts (~/.claude/projects/<project>/<session-id>.jsonl) they belong to.
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// The first user prompt sits near the top; big transcripts are never read whole.
const TRANSCRIPT_HEAD_BYTES = 512 * 1024

export function claudePaths(home) {
  return {
    tasksRoot: join(home, '.claude', 'tasks'),
    projectsRoot: join(home, '.claude', 'projects')
  }
}

export function isSessionId(name) {
  return SESSION_ID.test(name)
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/** Tasks of one list, ordered by their numeric id. Unreadable files are skipped. */
export async function readTaskList(dir) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const tasks = await Promise.all(
    names.filter((name) => name.endsWith('.json')).map((name) => readJson(join(dir, name)))
  )
  return tasks
    .filter((task) => task && typeof task.subject === 'string' && typeof task.status === 'string')
    .sort((a, b) => Number(a.id) - Number(b.id))
}

/** Task lists named by a session id that changed within maxAgeMs, newest first. */
export async function listRecentTaskLists(tasksRoot, { now = Date.now(), maxAgeMs }) {
  let entries
  try {
    entries = await readdir(tasksRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const lists = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isSessionId(entry.name))
      .map(async (entry) => {
        const dir = join(tasksRoot, entry.name)
        try {
          // Claude replaces task files by rename, which bumps the directory's mtime.
          const { mtimeMs } = await stat(dir)
          return { sessionId: entry.name, dir, updatedAt: mtimeMs }
        } catch {
          return null
        }
      })
  )
  return lists
    .filter((list) => list && now - list.updatedAt <= maxAgeMs)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function findTranscript(projectsRoot, sessionId) {
  let projects
  try {
    projects = await readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const path = join(projectsRoot, project.name, `${sessionId}.jsonl`)
    try {
      await stat(path)
      return path
    } catch {}
  }
  return null
}

function promptText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content.find((part) => part?.type === 'text' && typeof part.text === 'string')
    return text?.text ?? null
  }
  return null
}

/** The working directory, branch and first user prompt recorded at the top of a transcript. */
export async function readTranscriptHead(path) {
  let text
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(TRANSCRIPT_HEAD_BYTES)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    text = buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
  const head = { cwd: null, gitBranch: null, goal: null }
  for (const line of text.split('\n')) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    head.cwd ??= typeof entry.cwd === 'string' ? entry.cwd : null
    head.gitBranch ??= typeof entry.gitBranch === 'string' ? entry.gitBranch : null
    if (!head.goal && entry.type === 'user' && !entry.isMeta && entry.message?.role === 'user') {
      const prompt = promptText(entry.message)?.trim()
      // Command wrappers, caveats and system reminders start with a tag, not with the ask.
      if (prompt && !prompt.startsWith('<')) head.goal = prompt
    }
    if (head.cwd && head.goal) break
  }
  return head
}
