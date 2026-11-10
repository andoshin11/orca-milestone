import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createNextSender, offersOf } from '../src/next-actions.mjs'
import { buildModel } from '../src/model.mjs'
import { renderBody } from '../src/render.mjs'
import { allowFromGrant, covers, currentGrant, grantRestOfTurn, lastPromptId } from '../src/turn-grant.mjs'

const SESSION = '5f67451a-058b-4e44-98fa-349658ba37bf'
const line = (value) => `${JSON.stringify(value)}\n`
const prompt = (uuid, text = 'do it') => line({ type: 'user', uuid, message: { content: text } })
const result = (uuid) => line({ type: 'user', uuid, message: { content: [{ type: 'tool_result', tool_use_id: 't' }] } })

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'grant-'))
  const transcriptPath = join(home, 'transcript.jsonl')
  await writeFile(transcriptPath, prompt('p1') + result('r1'))
  const ask = (name, input) => ({ session_id: SESSION, transcript_path: transcriptPath, tool_name: name, tool_input: input })
  return { home, transcriptPath, ask }
}

test('the prompt that started the turn is what the user typed, not a tool result or a meta line', () => {
  assert.equal(lastPromptId(prompt('p1') + result('r1') + line({ type: 'user', uuid: 'm', isMeta: true, message: { content: 'x' } })), 'p1')
  assert.equal(lastPromptId(prompt('p1') + line({ type: 'user', uuid: 'p2', message: { content: [{ type: 'text', text: 'next' }] } })), 'p2')
  assert.equal(lastPromptId(result('r1')), null)
})

test('a grant covers reading and writing here, never a dangerous command or one that reaches out', () => {
  const grant = { upTo: 'write' }
  const bash = (command) => ({ name: 'Bash', input: { command } })
  assert.equal(covers(grant, bash('touch a')), true)
  assert.equal(covers(grant, bash('git status')), true)
  assert.equal(covers(grant, { name: 'Edit', input: { file_path: '/w/a' } }), true)
  assert.equal(covers(grant, bash('rm -rf build')), false)
  assert.equal(covers(grant, bash('git push origin main')), false)
  assert.equal(covers(grant, { name: 'mcp__claude_ai_Slack__slack_send_message', input: {} }), false)
  assert.equal(covers(grant, { name: 'AskUserQuestion', input: {} }), false)
  assert.equal(covers({ upTo: 'read' }, bash('touch a')), false)
})

test('the rest of a turn is allowed and listed, and the grant ends with the turn', async () => {
  const { home, transcriptPath, ask } = await setup()
  assert.equal(await allowFromGrant({ home, input: ask('Bash', { command: 'touch b' }) }), false, 'nothing without a grant')
  await grantRestOfTurn({ home, sessionId: SESSION, transcriptPath })
  assert.equal(await allowFromGrant({ home, input: ask('Bash', { command: 'touch b' }) }), true)
  assert.equal(await allowFromGrant({ home, input: ask('Bash', { command: 'git push' }) }), false)
  assert.equal(await allowFromGrant({ home, input: ask('Write', { file_path: '/w/c.txt' }) }), true)
  assert.deepEqual((await currentGrant({ home, sessionId: SESSION, transcriptPath })).allowed, ['touch b', 'Write /w/c.txt'])
  await appendFile(transcriptPath, prompt('p2', 'next request'))
  assert.equal(await currentGrant({ home, sessionId: SESSION, transcriptPath }), null, 'a new prompt is a new turn')
  assert.equal(await allowFromGrant({ home, input: ask('Bash', { command: 'touch d' }) }), false)
  await grantRestOfTurn({ home, sessionId: SESSION, transcriptPath, now: 0 })
  assert.equal(await allowFromGrant({ home, input: ask('Bash', { command: 'touch e' }), now: 2 * 60 * 60_000 }), false, 'nor after an hour')
})

test('the hook script answers allow only for a covered call, and says nothing otherwise', async () => {
  const { home, transcriptPath, ask } = await setup()
  const hook = (input) => execFileSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'permission-hook.mjs')], { input: JSON.stringify(input), env: { ...process.env, HOME: home } }).toString()
  assert.equal(hook(ask('Bash', { command: 'touch b' })), '')
  await grantRestOfTurn({ home, sessionId: SESSION, transcriptPath })
  assert.deepEqual(JSON.parse(hook(ask('Bash', { command: 'touch b' }))), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } })
  assert.equal(hook(ask('Bash', { command: 'rm -rf x' })), '')
  assert.equal(execFileSync(process.execPath, [join(import.meta.dirname, '..', 'src', 'permission-hook.mjs')], { input: 'not json' }).toString(), '', 'a bad input leaves it to the user')
})

const waiting = (extra = {}) => ({ agentType: 'claude', state: 'waiting', toolName: 'Bash', paneKey: 'tab:leaf', hasLivePty: true, stateStartedAt: 5, ...extra })
const HOOKED = { sessionId: SESSION, pid: 1, args: 'claude --settings {"command":"node /m/src/permission-hook.mjs"}' }
const MENU = (command) => `Bash command\n ${command}\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and always allow\n   4. No\n Esc to cancel · Tab to amend`

test('a permission in a hooked session offers the rest of the turn, and lists what it allowed', async () => {
  const worktree = { path: '/w', isActive: true, agents: [waiting()] }
  const readCall = async () => ({ toolUseId: 't1', name: 'Bash', input: { command: 'touch a' } })
  const readers = { readCall, readLaunchInfo: async () => HOOKED, readAllowed: async () => ['touch b'] }
  const [offer] = await offersOf([worktree], readers)
  assert.deepEqual(offer.suggestions.map((s) => s.action), ['allow', 'deny', 'allow-rest'])
  assert.equal(offer.sessionId, SESSION)
  assert.deepEqual(offer.allowed, ['touch b'])
  const html = renderBody(buildModel({ path: '/w', displayName: 'w', agentStates: ['waiting'] }, [], [], [offer]))
  assert.ok(html.includes('<span class="label">このターンの残りも許可</span>'))
  assert.ok(html.includes('このターンでまとめて許可したもの</p><ul><li>touch b</li></ul>'))
  const [plain] = await offersOf([worktree], { ...readers, readLaunchInfo: async () => ({ ...HOOKED, args: 'claude' }) })
  assert.deepEqual(plain.suggestions.map((s) => s.action), ['allow', 'deny'], 'not without the hook')
  const [risky] = await offersOf([worktree], { ...readers, readCall: async () => ({ toolUseId: 't2', name: 'Bash', input: { command: 'rm -rf x' } }) })
  assert.deepEqual(risky.suggestions.map((s) => s.action), ['allow', 'deny'], 'not for a dangerous command')

  const calls = []
  const send = createNextSender({
    readOffers: async () => [offer],
    run: async (args) => {
      calls.push(args)
      if (args[1] === 'list') return { result: { terminals: [{ handle: 'h1', tabId: 'tab', leafId: 'leaf', writable: true }] } }
      if (args[1] === 'read') return { result: { terminal: { tail: MENU('touch a').split('\n') } } }
      return { result: { send: { accepted: true } } }
    },
    grantRest: async (sessionId) => calls.push(['grant', sessionId])
  })
  assert.deepEqual(await send({ offer: offer.id, index: 2 }), { sent: true })
  assert.deepEqual(calls.filter((c) => c[0] === 'grant' || c[1] === 'send').map((c) => (c[0] === 'grant' ? c : c[5])), [['grant', SESSION], '1'], 'the grant, then the key')
})
