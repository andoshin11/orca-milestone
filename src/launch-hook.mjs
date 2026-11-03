// Claude Code leaves its task tools off on newer models. This turns them on for the agents Orca
// starts, so the panel has tasks to show without the user editing their settings.

export function enableTaskTools(event, next) {
  if (event.agent !== 'claude') return undefined
  return next({ ...event, env: { ...event.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } })
}
