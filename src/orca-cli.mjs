// Asks the Orca CLI which workspace is focused. The host API's workspace.readContext gives only
// a branch and a display name, which several repositories can share, so the path comes from here.
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

/** { path, displayName, claudeStates } of the focused workspace, or null when none is focused. */
export async function readActiveWorkspace(cli) {
  const response = await run(cli, ['worktree', 'ps', '--limit', '1000', '--json'])
  if (!response?.ok) {
    throw new Error(response?.error?.message ?? 'orca worktree ps failed')
  }
  const active = response.result.worktrees.find((worktree) => worktree.isActive)
  if (!active) return null
  return {
    path: active.path,
    displayName: active.displayName,
    claudeStates: (active.agents ?? [])
      .filter((agent) => agent.agentType === 'claude' && !agent.parentPaneKey)
      .map((agent) => agent.state)
  }
}
