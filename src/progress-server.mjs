// A small MCP server that gives Codex a tool to record its plan. Codex offers no task list of its
// own, so this file is what the panel reads. Codex starts one per session as a child process, so
// the parent is the session: its id names the file and tells the worker when the session ended.
// It speaks newline-delimited JSON-RPC over stdio and needs no dependencies.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

export const TOOL_NAME = 'update_progress'
const STATUSES = ['pending', 'in_progress', 'completed']
const GOAL_MAX = 500
const SUBJECT_MAX = 500
const TASKS_MAX = 200

export function progressDir(home = homedir()) {
  return join(home, '.orca-milestone', 'progress')
}

const TOOL = {
  name: TOOL_NAME,
  description:
    'Shows the user your plan and progress in the Orca sidebar. For any work of more than two steps, call it before you start with every step, then again each time a step starts or finishes, always sending the whole list. Keep exactly one step in_progress. Write the goal and steps in the language the user writes in.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'What the user asked for, in one short line.' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'The step, in a few words.' },
            status: { type: 'string', enum: STATUSES }
          },
          required: ['subject', 'status']
        }
      }
    },
    required: ['goal', 'tasks']
  }
}

function validate({ goal, tasks } = {}) {
  if (typeof goal !== 'string' || !goal.trim()) return 'goal must be a non-empty string'
  if (!Array.isArray(tasks) || tasks.length > TASKS_MAX) return `tasks must be a list of at most ${TASKS_MAX}`
  const valid = tasks.every(
    (task) => typeof task?.subject === 'string' && task.subject.trim() && STATUSES.includes(task.status)
  )
  return valid ? null : `every task needs a subject and a status of ${STATUSES.join(', ')}`
}

function record(args, { dir, pid, cwd, now }) {
  const tasks = args.tasks.map((task, index) => ({
    id: String(index + 1),
    subject: task.subject.slice(0, SUBJECT_MAX),
    status: task.status
  }))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `codex-${pid}.json`)
  const body = { pid, cwd, goal: args.goal.slice(0, GOAL_MAX), updatedAt: now(), tasks }
  // Replaced by rename, so the worker never reads half a file.
  writeFileSync(`${file}.tmp`, JSON.stringify(body))
  renameSync(`${file}.tmp`, file)
}

/** The reply to one JSON-RPC message, or null for a notification. */
export function handleMessage(message, context) {
  const { id, method, params } = message
  if (id === undefined) return null
  const reply = (result) => ({ jsonrpc: '2.0', id, result })
  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'milestone', version: '1' }
    })
  }
  if (method === 'ping') return reply({})
  if (method === 'tools/list') return reply({ tools: [TOOL] })
  if (method === 'tools/call' && params?.name === TOOL_NAME) {
    const answer = (text, isError = false) => reply({ content: [{ type: 'text', text }], isError })
    const problem = validate(params.arguments)
    if (problem) return answer(problem, true)
    try {
      record(params.arguments, context)
      return answer('Recorded.')
    } catch (error) {
      return answer(`Could not record the progress: ${error.message}`, true)
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } }
}

function serve() {
  const context = { dir: progressDir(), pid: process.ppid, cwd: process.cwd(), now: Date.now }
  createInterface({ input: process.stdin }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const answer = handleMessage(message, context)
    if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve()
