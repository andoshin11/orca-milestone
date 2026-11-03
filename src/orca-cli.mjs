// Asks the Orca CLI which workspace is focused and what every agent is doing. The host
// API's workspace.readContext gives only a branch and a display name, which several repositories
// can share, and it says nothing about other workspaces, so both come from here.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The CLI bundled with the Orca app that runs this worker, else `orca` on PATH. */
export function resolveOrcaCli(execPath = process.execPath) {
  // The worker runs Orca's own binary as Node: Orca.app/Contents/MacOS/Orca.
  const bundled = join(dirname(execPath), '..', 'Resources', 'bin', 'orca')
  return existsSync(bundled) ? bundled : 'orca'
}

function run(cli, args) {
  return new Promise((resolve, reject) => {
    execFile(cli, args, { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(error)
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
}

const TRACKED_AGENTS = new Set(['claude', 'codex'])

function mainAgents(worktree) {
  return (worktree.agents ?? []).filter((agent) => TRACKED_AGENTS.has(agent.agentType) && !agent.parentPaneKey)
}

/**
 * The focused workspace ({ path, displayName, agentStates }, or null) and the main agents
 * of every workspace that is not archived. Prompts and replies are left out on purpose.
 */
export async function readWorkspaces(cli) {
  const response = await run(cli, ['worktree', 'ps', '--limit', '1000', '--json'])
  if (!response?.ok) {
    throw new Error(response?.error?.message ?? 'orca worktree ps failed')
  }
  const worktrees = response.result.worktrees.filter((worktree) => !worktree.isArchived)
  const active = worktrees.find((worktree) => worktree.isActive)
  return {
    active: active
      ? {
          path: active.path,
          displayName: active.displayName,
          agentStates: mainAgents(active).map((agent) => agent.state)
        }
      : null,
    agents: worktrees.flatMap((worktree) =>
      mainAgents(worktree).map((agent) => ({
        workspace: worktree.displayName,
        repo: typeof worktree.repo === 'string' ? worktree.repo : null,
        path: worktree.path,
        focused: Boolean(worktree.isActive),
        state: agent.state,
        since: agent.stateStartedAt ?? null
      }))
    )
  }
}
