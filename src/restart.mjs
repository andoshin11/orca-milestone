// Starts a Claude session again under what the plugin tells a session now, in the same conversation.
// A session keeps the instructions it was started with, so one started before the plugin changed, or
// outside Orca, goes on without the newer ones until it is started again. The panel offers this only
// to a session that waits for the user with nothing in its input box and no shells in the background:
// `/exit` would stop those shells and lose what is typed.
import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { claudePaths, readRunningSessions } from './claude-sessions.mjs'
import { launchSignature, withTaskInstructions } from './launch-hook.mjs'

const TAIL_BYTES = 256 * 1024
// Claude Code paints its next-prompt suggestion in gray in the input box: start of the input row,
// dim on, the text, dim off, and the cursor back to that row. A screen read cannot tell it from text.
const SUGGESTION = /\x1b\[H\r\x1b\[2C\x1b\[(\d+)B\x1b\[2m([^\x1b]{1,1200})\x1b\[22m\x1b\[\d+;1H\x1b\[(\d+);3H/g
const RULE = /^─{10,}\s*$/
const PROMPT = /^❯\s?/
const SHELLS = /(^|\/|-)(fish|zsh|bash|sh)$/
// Values the resumed session keeps. Others are left out rather than taken apart from a command line
// that has lost its quotes.
const KEPT_VALUE = /^[\w.:/@=-]+$/
const EXIT_WAIT_MS = 20_000
const START_WAIT_MS = 30_000
const POLL_MS = 500
const SHELL_WAIT_MS = 1_000

/** The command line a process was started with, or null once it is gone. */
export function readArgs(pid) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'args=', '-p', String(pid)], (error, stdout) => resolve(error ? null : stdout.trim() || null))
  })
}

/** The command line of the process that started it: a shell when the user typed `claude`. */
async function readParentArgs(pid) {
  const ppid = await new Promise((resolve) => {
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], (error, stdout) => resolve(error ? null : stdout.trim()))
  })
  return ppid ? readArgs(ppid) : null
}

/** Whether a Claude command line lacks what the plugin gives a session now. */
export function isStale(args, signature = launchSignature()) {
  return !signature.every((part) => args.includes(part))
}

/**
 * The one running Claude session in a workspace with its command line, or null.
 * @returns { sessionId, pid, args }
 */
export function createLaunchInfoReader(home, { readArgsOf = readArgs } = {}) {
  const { sessionsRoot } = claudePaths(home)
  // A process keeps its command line, so it is read once.
  const known = new Map()
  return async function readLaunchInfo(path) {
    const inside = (await readRunningSessions(sessionsRoot)).filter((entry) => entry.cwd === path || entry.cwd.startsWith(`${path}/`))
    if (inside.length !== 1) return null
    const [{ sessionId, pid }] = inside
    if (!known.has(pid)) known.set(pid, await readArgsOf(pid))
    const args = known.get(pid)
    return args ? { sessionId, pid, args } : null
  }
}

/** The one running Claude session in a workspace when it was told something older, or null. */
export function createLaunchReader(home, { readArgsOf = readArgs, readLaunchInfo = createLaunchInfoReader(home, { readArgsOf }) } = {}) {
  return async function readLaunch(path) {
    const info = await readLaunchInfo(path)
    return info && isStale(info.args) ? info : null
  }
}

/**
 * The command that starts the session again: `orca claude-teams` for Agent Teams, which adds its
 * own flags, else `claude`. Permissions, the model and a plugin folder carry over.
 */
export function resumeCommand(args, sessionId) {
  const teams = /\s--teammate-mode\s/.test(args)
  const kept = []
  if (/\s--dangerously-skip-permissions(\s|$)/.test(args)) kept.push('--dangerously-skip-permissions')
  for (const flag of ['--permission-mode', '--model']) {
    const value = new RegExp(`\\s${flag}[ =](\\S+)`).exec(args)?.[1]
    if (value && KEPT_VALUE.test(value)) kept.push(`${flag} ${value}`)
  }
  // Orca's own plugin for its agent view. The folder has a space, and no option comes inside it.
  const pluginDir = /\s--plugin-dir (.+?)(?= --|$)/.exec(args)?.[1]?.trim()
  if (!teams && pluginDir && !pluginDir.includes("'")) kept.push(`--plugin-dir '${pluginDir}'`)
  const command = `${teams ? 'orca claude-teams' : 'claude'} ${[...kept, '--resume', sessionId].join(' ')}`
  return `env CLAUDE_CODE_ENABLE_TODO_TOOLS=1 ${withTaskInstructions(command)}`
}

/** What is typed in Claude Code's input box on a screen, '' when nothing, or null when no box shows. */
export function inputText(screen) {
  const lines = screen.split('\n')
  const start = lines.findLastIndex((line) => PROMPT.test(line))
  if (start < 1 || !RULE.test(lines[start - 1])) return null
  const end = lines.findIndex((line, index) => index > start && RULE.test(line))
  if (end < 0) return null
  return lines.slice(start, end).map((line, index) => (index === 0 ? line.replace(PROMPT, '') : line).trim()).join(' ').trim()
}

/** The suggestion on screen at the end of a terminal's output, or null. */
export function suggestionFrom(output) {
  let last = null
  for (const match of output.matchAll(SUGGESTION)) {
    if (Number(match[3]) === Number(match[1]) + 1) last = match
  }
  if (!last) return null
  const after = output.slice(last.index + last[0].length)
  // Anything drawn on that row afterwards, such as a typed letter, means it is gone.
  if (new RegExp(`\\x1b\\[H\\r(?:\\x1b\\[\\d+C)?\\x1b\\[${last[1]}B`).test(after)) return null
  return Buffer.from(last[2], 'latin1').toString('utf8').trim() || null
}

export async function readOutputTail(home, ptyId) {
  const path = join(home, 'Library', 'Application Support', 'orca', 'terminal-history', encodeURIComponent(ptyId), 'output.log')
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, size - length)
    return buffer.subarray(0, bytesRead).toString('latin1')
  } finally {
    await file.close()
  }
}

/** Whether the input box holds only Claude Code's gray suggestion, or nothing. */
export function isInputEmpty(typed, suggestion) {
  if (typed === '') return true
  const flat = (text) => text.replace(/\s+/g, '')
  return Boolean(suggestion) && flat(suggestion).startsWith(flat(typed))
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * @param run        runs the Orca CLI with arguments and resolves to its JSON reply
 * @param readLaunch resolves a workspace path to its session told something older, see createLaunchReader
 * @param readScreen resolves a terminal handle to what it shows now
 * @returns a function that takes the offer and the terminal of its pane, and resolves to
 *   `{ sent: true }` once the session runs again, `{ sent: false, reason: 'stale' }` when there is
 *   nothing to restart, or `'draft'` when the input box has text. It throws when a step fails.
 */
export function createRestarter({ home, run, readLaunch, readScreen, readOutput = readOutputTail, parentArgs = readParentArgs, running = isRunning, sessions = () => readRunningSessions(claudePaths(home).sessionsRoot), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  async function until(check, ms) {
    const end = now() + ms
    while (now() < end) {
      if (await check()) return true
      await wait(POLL_MS)
    }
    return check()
  }

  async function send(handle, text, enter) {
    const args = ['terminal', 'send', '--terminal', handle, '--text', text, ...(enter ? ['--enter'] : []), '--json']
    if (!(await run(args)).result?.send?.accepted) throw new Error('the terminal did not accept the text')
  }

  return async function restart(found, terminal) {
    const launch = await readLaunch(found.path)
    if (!launch || launch.sessionId !== found.sessionId) return { sent: false, reason: 'stale' }
    const typed = inputText(await readScreen(terminal.handle))
    if (typed === null) return { sent: false, reason: 'stale' }
    const suggestion = typed && terminal.ptyId ? suggestionFrom(await readOutput(home, terminal.ptyId).catch(() => '')) : null
    if (!isInputEmpty(typed, suggestion)) return { sent: false, reason: 'draft' }
    const inShell = SHELLS.test(((await parentArgs(launch.pid)) ?? '').split(/\s/)[0])
    const command = resumeCommand(launch.args, launch.sessionId)

    await send(terminal.handle, '/exit', true)
    if (!(await until(() => !running(launch.pid), EXIT_WAIT_MS))) {
      // A dialog, such as the one for work in the background, keeps it open: leave it as it was.
      await send(terminal.handle, '\u001b', false).catch(() => {})
      throw new Error('the session did not exit')
    }
    if (inShell) {
      await wait(SHELL_WAIT_MS)
      await send(terminal.handle, command, true)
    } else {
      // Orca closes the pane of an agent it started once the agent exits, so it gets a new one.
      const title = typeof terminal.title === 'string' && terminal.title.trim() ? terminal.title.trim() : 'Claude'
      const reply = await run(['terminal', 'create', '--worktree', `path:${found.path}`, '--title', title, '--command', command, '--json'])
      if (!reply?.ok) throw new Error('could not open a terminal for the session')
    }
    const back = await until(async () => (await sessions()).some((entry) => entry.sessionId === launch.sessionId && entry.pid !== launch.pid), START_WAIT_MS)
    if (!back) throw new Error('the session did not start again')
    return { sent: true }
  }
}
