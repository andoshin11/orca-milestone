import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SESSION_A = '11111111-1111-4111-8111-111111111111'
export const SESSION_B = '22222222-2222-4222-8222-222222222222'

export async function makeHome() {
  return mkdtemp(join(tmpdir(), 'orca-milestone-'))
}

export async function writeTasks(home, sessionId, tasks) {
  const dir = join(home, '.claude', 'tasks', sessionId)
  await mkdir(dir, { recursive: true })
  for (const task of tasks) {
    await writeFile(join(dir, `${task.id}.json`), JSON.stringify(task))
  }
  return dir
}

export async function writeTranscript(home, sessionId, { cwd, gitBranch = 'main', prompt }) {
  const dir = join(home, '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(dir, { recursive: true })
  const lines = [
    { type: 'mode', sessionId },
    { type: 'user', cwd, gitBranch, sessionId, isMeta: true, message: { role: 'user', content: '<local-command-caveat>x</local-command-caveat>' } },
    { type: 'user', cwd, gitBranch, sessionId, message: { role: 'user', content: prompt } },
    { type: 'assistant', cwd, gitBranch, sessionId, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }
  ]
  await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

export function task(id, subject, status, extra = {}) {
  return { id: String(id), subject, description: subject, status, blocks: [], blockedBy: [], ...extra }
}
