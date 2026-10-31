// Turns the focused workspace and the Claude sessions found on disk into what the panel shows.

const MAX_SESSIONS = 3
const MAX_ROWS = 8
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function isInside(path, root) {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

function progress(tasks) {
  const visible = tasks.filter((task) => task.status !== 'deleted')
  const done = visible.filter((task) => task.status === 'completed').length
  return { done, total: visible.length, tasks: visible }
}

// Why an agent needs the user: it asks for input or a permission, or it finished a turn the user
// has not looked at yet (Orca marks that workspace unread).
const ATTENTION = { waiting: 'input', blocked: 'permission', permission: 'permission' }

/** How long ago, coarse enough that the panel is not rebuilt every few seconds. */
function age(since, now) {
  if (!since) return null
  const elapsed = Math.max(0, now - since)
  if (elapsed < MINUTE) return { unit: 'now', value: 0 }
  if (elapsed < HOUR) return { unit: 'minutes', value: Math.floor(elapsed / MINUTE) }
  if (elapsed < DAY) return { unit: 'hours', value: Math.floor(elapsed / HOUR) }
  return { unit: 'days', value: Math.floor(elapsed / DAY) }
}

/**
 * Every Claude agent Orca runs on this machine, sorted into those that need the user and those
 * at work. Each row carries the goal and progress of the newest task list under its workspace.
 */
function buildMachine(agents, sessions, now) {
  const rows = agents.map((agent) => {
    const session = sessions.find((s) => s.cwd && s.tasks.length > 0 && isInside(s.cwd, agent.path))
    const reason = ATTENTION[agent.state] ?? (agent.state === 'done' && agent.unread ? 'review' : null)
    return {
      workspace: agent.workspace,
      focused: agent.focused,
      kind: reason ? 'attention' : agent.state === 'working' ? 'working' : 'idle',
      reason,
      since: agent.since ?? 0,
      age: age(agent.since, now),
      goal: session?.goal ?? agent.title ?? null,
      ...(session ? progress(session.tasks) : { done: 0, total: 0 })
    }
  })
  const count = (kind) => rows.filter((row) => row.kind === kind).length
  // The focused workspace is already shown in full above; it only counts here.
  const listed = (kind, order) =>
    rows.filter((row) => row.kind === kind && !row.focused).sort(order).slice(0, MAX_ROWS)
  return {
    counts: { attention: count('attention'), working: count('working'), idle: count('idle') },
    // Waiting longest first; most recently started work first.
    attention: listed('attention', (a, b) => a.since - b.since),
    working: listed('working', (a, b) => b.since - a.since)
  }
}

/**
 * @param workspace { path, displayName, claudeStates } of the focused workspace, or null
 * @param sessions  [{ listId, cwd, goal, tasks, updatedAt }] of every workspace, newest first
 * @param agents    [{ workspace, path, focused, unread, state, since, title }] Orca runs
 * @param now       the time ages are measured to
 */
export function buildModel(workspace, sessions, agents = [], now = Date.now()) {
  const machine = buildMachine(agents, sessions, now)
  if (!workspace) return { kind: 'no-workspace', machine }
  const mine = sessions
    .filter((session) => session.cwd && isInside(session.cwd, workspace.path))
    .filter((session) => session.tasks.length > 0)
    .slice(0, MAX_SESSIONS)
    .map((session) => ({ listId: session.listId, goal: session.goal, ...progress(session.tasks) }))
  const states = workspace.claudeStates ?? []
  return {
    kind: mine.length > 0 ? 'sessions' : 'no-tasks',
    workspace: workspace.displayName,
    agent: states.includes('working')
      ? 'working'
      : states.includes('blocked') || states.includes('waiting')
        ? 'waiting'
        : states.length > 0
          ? 'idle'
          : 'none',
    sessions: mine,
    machine
  }
}
