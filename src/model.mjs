// Turns the focused workspace and the Claude sessions found on disk into what the panel shows.

const MAX_SESSIONS = 3

export function isInside(path, root) {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

function progress(tasks) {
  const visible = tasks.filter((task) => task.status !== 'deleted')
  const done = visible.filter((task) => task.status === 'completed').length
  return { done, total: visible.length, tasks: visible }
}

/**
 * @param workspace { path, displayName, claudeStates } of the focused workspace, or null
 * @param sessions  [{ sessionId, cwd, goal, tasks, updatedAt }], newest first
 */
export function buildModel(workspace, sessions) {
  if (!workspace) return { kind: 'no-workspace' }
  const mine = sessions
    .filter((session) => session.cwd && isInside(session.cwd, workspace.path))
    .filter((session) => session.tasks.length > 0)
    .slice(0, MAX_SESSIONS)
    .map((session) => ({ sessionId: session.sessionId, goal: session.goal, ...progress(session.tasks) }))
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
    sessions: mine
  }
}
