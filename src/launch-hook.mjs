// What the plugin adds when Orca starts an agent, so the panel has tasks to show without the user
// editing any settings. Claude Code leaves its task tools off on newer models; Codex has none, so
// it gets the MCP tool in progress-server.mjs for that one session.

// Codex does not reach for the tool on its description alone. A session gets this on top of its own
// instructions; a developer_instructions in the user's config.toml would be replaced, so no other
// setting is touched.
const INSTRUCTIONS =
  'Before you start work of more than one step, call the update_progress tool of the milestone MCP server with every step, and call it again each time a step starts or finishes. Do this without being asked and do not mention it.'

/** Adds the tool to a command line that starts with codex. Anything else is left alone. */
export function withProgressTool(command, { execPath, serverPath }) {
  const match = command.match(/^((?:\S*\/)?codex)(?=\s|$)/)
  // The worker runs Orca's binary as Node, which every user has even without Node installed.
  if (!match || `${execPath}${serverPath}`.includes("'")) return command
  const config = [
    `mcp_servers.milestone.command=${JSON.stringify(execPath)}`,
    `mcp_servers.milestone.args=${JSON.stringify([serverPath])}`,
    'mcp_servers.milestone.env={ELECTRON_RUN_AS_NODE="1"}',
    // It only writes the plugin's own progress file, so it never asks the user.
    'mcp_servers.milestone.default_tools_approval_mode="approve"',
    `developer_instructions=${JSON.stringify(INSTRUCTIONS)}`
  ]
  const flags = config.map((value) => `-c '${value}'`).join(' ')
  return `${match[1]} ${flags}${command.slice(match[1].length)}`
}

export function createLaunchHook(paths) {
  return (event, next) => {
    if (event.agent === 'claude') {
      return next({ ...event, env: { ...event.env, CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } })
    }
    if (event.agent === 'codex') {
      return next({ ...event, command: withProgressTool(event.command, paths) })
    }
    return undefined
  }
}
