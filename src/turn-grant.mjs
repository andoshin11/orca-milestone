// "Allow the rest of this turn": what the user allowed for the calls still to come in one turn of a
// Claude session, kept in a file that the Milestone panel and agent-status-panel both write and the
// PermissionRequest hook reads (permission-hook.mjs). Claude Code shows the calls of one turn one
// at a time, so they cannot all be listed before the first answer: the rest are allowed up to a
// kind of call, and listed afterwards. A grant lasts for the turn it was given in, found by its
// prompt, and never covers a dangerous command or one that reaches past this machine.
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudePaths, findTranscript } from './claude-sessions.mjs'
import { isDangerous } from './dangerous.mjs'
import { riskOf } from './risk.mjs'

const TAIL_BYTES = 1024 * 1024
// Longer than any turn worth trusting unattended.
const GRANT_MS = 60 * 60_000
const SUMMARY_MAX = 120
const ALLOWED_MAX = 50
// What the rest of a turn may do, from least to most: a grant covers its kind and those before it.
const RANKS = ['read', 'write']
// Calls that are not permissions to run something, though they ask.
const NOT_CALLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
export const GRANT_UP_TO = 'write'

export function grantsDir(home) {
  return join(home, '.local', 'state', 'orca-milestone', 'grants')
}

function grantPath(home, sessionId) {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new TypeError('not a session id')
  return join(grantsDir(home), `${sessionId}.json`)
}

async function readTail(path) {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, size - length)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

/** The id of the prompt that started the last turn: a message the user typed, not a tool result. */
export function lastPromptId(text) {
  for (const line of text.split('\n').toReversed()) {
    if (!line.includes('"user"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'user' || entry.isMeta || typeof entry.uuid !== 'string') continue
    const content = entry.message?.content
    if (typeof content === 'string' && content.trim()) return entry.uuid
    if (Array.isArray(content) && !content.some((part) => part?.type === 'tool_result') && content.some((part) => part?.type === 'text')) return entry.uuid
  }
  return null
}

export async function readGrant(home, sessionId) {
  try {
    return JSON.parse(await readFile(grantPath(home, sessionId), 'utf8'))
  } catch {
    return null
  }
}

async function saveGrant(home, grant) {
  const path = grantPath(home, grant.sessionId)
  await mkdir(grantsDir(home), { recursive: true, mode: 0o700 })
  await writeFile(`${path}.tmp`, JSON.stringify(grant), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

/** Allows the rest of the turn the session is in now. @returns the grant, or null with no turn. */
export async function grantRestOfTurn({ home, sessionId, transcriptPath, now = Date.now() }) {
  const promptId = lastPromptId(await readTail(transcriptPath))
  if (!promptId) return null
  const grant = { sessionId, promptId, upTo: GRANT_UP_TO, until: now + GRANT_MS, allowed: [] }
  await saveGrant(home, grant)
  return grant
}

/** The grant of the turn the session is in now, or null once that turn is over. */
export async function currentGrant({ home, sessionId, transcriptPath, now = Date.now() }) {
  const grant = await readGrant(home, sessionId)
  if (!grant) return null
  if (grant.until < now || grant.promptId !== lastPromptId(await readTail(transcriptPath).catch(() => ''))) {
    await rm(grantPath(home, sessionId), { force: true })
    return null
  }
  return grant
}

function summaryOf(name, input) {
  const what = typeof input?.command === 'string' ? input.command : typeof input?.file_path === 'string' ? `${name} ${input.file_path}` : name
  const line = what.replace(/\s+/g, ' ').trim()
  return [...line].length > SUMMARY_MAX ? `${[...line].slice(0, SUMMARY_MAX - 1).join('')}…` : line
}

/** Whether a grant covers a call: of a kind it allows, and not a dangerous command. */
export function covers(grant, call) {
  if (NOT_CALLS.has(call.name) || isDangerous(call)) return false
  const rank = RANKS.indexOf(riskOf(call))
  return rank >= 0 && rank <= RANKS.indexOf(grant.upTo)
}

/**
 * Decides a permission the session asks for, from the hook's input: true when the grant of this
 * turn covers it, which is then written down to be listed afterwards. False leaves it to the user.
 */
export async function allowFromGrant({ home, input, now = Date.now() }) {
  const { session_id: sessionId, transcript_path: transcriptPath, tool_name: name, tool_input: toolInput } = input ?? {}
  if (typeof sessionId !== 'string' || typeof transcriptPath !== 'string' || typeof name !== 'string') return false
  const grant = await currentGrant({ home, sessionId, transcriptPath, now }).catch(() => null)
  const call = { name, input: toolInput ?? {} }
  if (!grant || !covers(grant, call)) return false
  grant.allowed = [...grant.allowed, summaryOf(name, call.input)].slice(-ALLOWED_MAX)
  await saveGrant(home, grant)
  return true
}

/** Whether a session was started with the hook that reads the grants, by its command line. */
export function hasGrantHook(args) {
  return typeof args === 'string' && args.includes('permission-hook.mjs')
}

/** Grants by session id, for the cards: what was allowed this turn, and allowing the rest of it. */
export function createGrantAccess(home) {
  const { projectsRoot } = claudePaths(home)
  return {
    async allowed(sessionId) {
      const transcriptPath = await findTranscript(projectsRoot, sessionId)
      return transcriptPath ? ((await currentGrant({ home, sessionId, transcriptPath }))?.allowed ?? []) : []
    },
    async grant(sessionId) {
      const transcriptPath = await findTranscript(projectsRoot, sessionId)
      if (!transcriptPath || !(await grantRestOfTurn({ home, sessionId, transcriptPath }))) throw new Error('no turn to allow the rest of')
    }
  }
}
