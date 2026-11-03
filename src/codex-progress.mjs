// Reads what Codex sessions recorded through the MCP tool in progress-server.mjs. A list shows only
// while its session runs, like a Claude list; a finished session's file is removed.
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return error.code === 'EPERM'
  }
}

export async function readCodexProgress(dir, { running = isRunning } = {}) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const lists = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const file = join(dir, name)
        try {
          const { pid, cwd, goal, updatedAt, tasks } = JSON.parse(await readFile(file, 'utf8'))
          if (!running(pid)) {
            await rm(file, { force: true })
            return null
          }
          return { listId: name.slice(0, -'.json'.length), cwd, goal, updatedAt, tasks }
        } catch {
          return null
        }
      })
  )
  return lists.filter(Boolean)
}
