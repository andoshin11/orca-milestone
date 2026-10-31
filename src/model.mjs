// Turns the focused workspace and the Claude sessions found on disk into what the panel shows.

const MAX_SESSIONS = 3
const MAX_ROWS = 8

export function isInside(path, root) {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

function progress(tasks) {
  const visible = tasks.filter((task) => task.status !== 'deleted')
  const done = visible.filter((task) => task.status === 'completed').length
  return { done, total: visible.length, tasks: visible }
}

// An agent needs the user when it asks for input or for a permission.
const NEEDS_USER = new Set(['waiting', 'blocked', 'permission'])

/**
 * The other workspaces where Claude needs the user or has a task list, each with the progress
 * of its newest list. Lists only reach here while their session runs. The focused workspace is shown in full above. Whether Claude
 * is at work flips every turn, so it is left out: each change would rebuild the panel.
 */
function buildOthers(agents, sessions) {
  const byWorkspace = new Map()
  for (const agent of agents) {
    const entry = byWorkspace.get(agent.path) ?? { ...agent, needsUser: false, since: 0 }
    if (NEEDS_USER.has(agent.state)) {
      entry.needsUser = true
      entry.since = Math.max(entry.since, agent.since ?? 0)
    }
    byWorkspace.set(agent.path, entry)
  }
  const rows = [...byWorkspace.values()].map((entry) => {
    const session = sessions.find((s) => s.cwd && s.tasks.length > 0 && isInside(s.cwd, entry.path))
    const counts = session ? progress(session.tasks) : { done: 0, total: 0, tasks: [] }
    return {
      workspace: entry.workspace,
      focused: entry.focused,
      kind: entry.needsUser ? 'attention' : 'idle',
      since: entry.since,
      updatedAt: session?.updatedAt ?? 0,
      goal: session?.goal ?? null,
      ...counts
    }
  })
  const rank = (row) =>
    row.kind === 'attention' ? 0 : row.done < row.total ? 1 : 2
  return {
    attention: rows.filter((row) => row.kind === 'attention').length,
    // Those needing the user first, longest waiting first; then unfinished and then finished
    // lists, most recently updated first.
    rows: rows
      .filter(
        (row) =>
          !row.focused &&
          (row.kind === 'attention' || row.total > 0)
      )
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          (a.kind === 'attention' ? a.since - b.since : b.updatedAt - a.updatedAt)
      )
      .slice(0, MAX_ROWS)
  }
}

/**
 * @param workspace { path, displayName, claudeStates } of the focused workspace, or null
 * @param sessions  [{ listId, cwd, goal, tasks, updatedAt }] of every workspace, newest first
 * @param agents    [{ workspace, path, focused, state, since }] Orca runs, one per Claude agent
 */
export function buildModel(workspace, sessions, agents = []) {
  const others = buildOthers(agents, sessions)
  if (!workspace) return { kind: 'no-workspace', others }
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
    others
  }
}
