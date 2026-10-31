// Reads Claude Code's task lists (~/.claude/tasks/<list-id>/<n>.json) and the session
// transcripts (~/.claude/projects/<project>/<session-id>.jsonl) they belong to.
//
// A plain session names its list by its session id. A session that leads an agent team
// (`claude --teammate-mode`, which Orca's Agent Teams launch uses) names it after the team,
// `session-<first 8 hex of the session id>`.
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TEAM_LIST_ID = /^session-([0-9a-f]{8})$/
// The first user prompt sits near the top; big transcripts are never read whole.
const TRANSCRIPT_HEAD_BYTES = 512 * 1024
const TRANSCRIPT_CHUNK_BYTES = 1024 * 1024

export function claudePaths(home) {
  return {
    tasksRoot: join(home, '.claude', 'tasks'),
    projectsRoot: join(home, '.claude', 'projects'),
    teamsRoot: join(home, '.claude', 'teams')
  }
}

export function isSessionId(name) {
  return SESSION_ID.test(name)
}

export function isTaskListId(name) {
  return SESSION_ID.test(name) || TEAM_LIST_ID.test(name)
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

/** Task lists named by a session or a team that changed within maxAgeMs, newest first. */
export async function listRecentTaskLists(tasksRoot, { now = Date.now(), maxAgeMs }) {
  let entries
  try {
    entries = await readdir(tasksRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const lists = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isTaskListId(entry.name))
      .map(async (entry) => {
        const dir = join(tasksRoot, entry.name)
        try {
          // Claude replaces task files by rename, which bumps the directory's mtime.
          const { mtimeMs } = await stat(dir)
          return { listId: entry.name, dir, updatedAt: mtimeMs }
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

async function findTranscriptByPrefix(projectsRoot, prefix) {
  let projects
  try {
    projects = await readdir(projectsRoot, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let names
    try {
      names = await readdir(join(projectsRoot, project.name))
    } catch {
      continue
    }
    const name = names.find(
      (file) => file.startsWith(prefix) && file.endsWith('.jsonl') && isSessionId(file.slice(0, -'.jsonl'.length))
    )
    if (name) return join(projectsRoot, project.name, name)
  }
  return null
}

/** The transcript of the session that owns a task list, or null. */
export async function findListTranscript({ projectsRoot, teamsRoot }, listId) {
  if (isSessionId(listId)) return findTranscript(projectsRoot, listId)
  const prefix = TEAM_LIST_ID.exec(listId)?.[1]
  if (!prefix) return null
  // The team config names the lead session only while the team runs; afterwards only the
  // prefix in the list id is left to go on.
  const lead = (await readJson(join(teamsRoot, listId, 'config.json')))?.leadSessionId
  if (typeof lead === 'string' && isSessionId(lead) && lead.startsWith(prefix)) {
    const transcript = await findTranscript(projectsRoot, lead)
    if (transcript) return transcript
  }
  return findTranscriptByPrefix(projectsRoot, `${prefix}-`)
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

/** What the user typed in a transcript entry, or null for tool results, reminders and summaries. */
function userPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isCompactSummary || entry.message?.role !== 'user') {
    return null
  }
  const prompt = promptText(entry.message)?.trim()
  // Command wrappers, caveats and system reminders start with a tag, interruptions with a bracket.
  if (!prompt || prompt.startsWith('<') || prompt.startsWith('[Request interrupted')) return null
  return prompt
}

function writtenGoal(task) {
  const goal = task.metadata?.goal
  return typeof goal === 'string' && goal.trim() ? goal.trim() : null
}

/**
 * The goal Claude wrote on its tasks (metadata.goal) and the tasks that belong to it. The newest
 * task with a goal names the current one; tasks of earlier goals are left out, while tasks
 * without a goal stay once they come after the current goal's first task. Without any goal,
 * every task is kept.
 */
export function currentGoal(tasks) {
  const last = tasks.findLast((task) => writtenGoal(task))
  if (!last) return { goal: null, tasks }
  const goal = writtenGoal(last)
  const first = tasks.findIndex((task) => writtenGoal(task) === goal)
  return {
    goal,
    tasks: tasks.filter((task, index) => {
      const written = writtenGoal(task)
      return written ? written === goal : index > first
    })
  }
}

/** Lines of a file from the last to the first, read in chunks from the end. */
async function* linesFromEnd(path) {
  const file = await open(path, 'r')
  try {
    let position = (await file.stat()).size
    let carry = Buffer.alloc(0)
    while (position > 0) {
      const size = Math.min(TRANSCRIPT_CHUNK_BYTES, position)
      position -= size
      const chunk = Buffer.alloc(size)
      await file.read(chunk, 0, size, position)
      const buffer = Buffer.concat([chunk, carry])
      // Split on bytes so a multi-byte character cut by the chunk edge is joined first.
      let end = buffer.length
      for (let i = buffer.length - 1; i >= 0; i -= 1) {
        if (buffer[i] !== 0x0a) continue
        if (i + 1 < end) yield buffer.subarray(i + 1, end).toString('utf8')
        end = i
      }
      carry = buffer.subarray(0, end)
    }
    if (carry.length > 0) yield carry.toString('utf8')
  } finally {
    await file.close()
  }
}

/**
 * The prompt the user sent last before Claude created the task titled `subject`, read from the
 * end of the transcript: the request a list of tasks was made for. Null when not found.
 */
export async function readPromptBeforeTask(path, subject) {
  let created = false
  for await (const line of linesFromEnd(path)) {
    if (!created && !line.includes('"TaskCreate"')) continue
    if (created && !line.includes('"user"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!created) {
      const content = entry.type === 'assistant' ? entry.message?.content : null
      created = Array.isArray(content) && content.some(
        (part) => part?.type === 'tool_use' && part.name === 'TaskCreate' && part.input?.subject === subject
      )
      continue
    }
    const prompt = userPrompt(entry)
    if (prompt) return prompt
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
    head.goal ??= userPrompt(entry)
    if (head.cwd && head.goal) break
  }
  return head
}
