import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNextSender, nextOffer, offersOf } from '../src/next-actions.mjs'
import { isBotHome, readWorkspaces } from '../src/orca-cli.mjs'
import { buildModel } from '../src/model.mjs'
import { renderBody } from '../src/render.mjs'
import { createChatReplyReader, lastReply } from '../src/claude-sessions.mjs'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeHome } from './helpers.mjs'

const BOT = '/Users/me/.orca/bots/compass'
const block = (list) => `done\n\n\`\`\`next\n${JSON.stringify(list)}\n\`\`\`\n`
// What `orca worktree ps` says of an agent in an Orca chat: a pane key of its session, no pty.
const chat = (extra = {}) => ({
  agentType: 'claude',
  state: 'done',
  paneKey: 'structured-agent-session-24cd4041-94bf-4a5a-bdfc-78bfbe41bcf9:15b0040a',
  hasLivePty: null,
  stateStartedAt: 5,
  lastAssistantMessage: block([{ label: '仕様を書く', prompt: '仕様を書いてください', reason: '調査が済んだため' }]),
  ...extra
})
const home = (agents, extra = {}) => ({ path: BOT, displayName: 'Compass', isActive: true, agents, ...extra })

test('a bot’s home is the folder Orca keeps it in', () => {
  assert.equal(isBotHome(BOT), true)
  assert.equal(isBotHome(`${BOT}/`), true)
  assert.equal(isBotHome(`${BOT}/specs`), false)
  assert.equal(isBotHome('/Users/me/orca/workspaces/app'), false)
  assert.equal(isBotHome(undefined), false)
})

test('an agent in a chat offers its next steps to be shown, with no restart and nothing to press', async () => {
  const offer = nextOffer(home([chat()]))
  assert.equal(offer.chat, true)
  assert.deepEqual(offer.suggestions.map((s) => s.label), ['仕様を書く'])
  // Restarting needs a terminal, so a chat is never asked whether it was told something older.
  let asked = false
  const [found] = await offersOf([home([chat()])], { readLaunch: async () => { asked = true; return { sessionId: 's' } } })
  assert.equal(asked, false)
  assert.ok(!found.suggestions.some((s) => s.action === 'restart'))
  // Two chats, or a chat beside a terminal agent: the cards would name the wrong one.
  assert.equal(nextOffer(home([chat(), chat({ paneKey: 'structured-agent-session-other:1' })])), null)
  const terminal = { ...chat({ paneKey: 'tab:leaf', hasLivePty: true }) }
  assert.equal(nextOffer(home([chat(), terminal])).chat, undefined)
  // A closed terminal pane is still not a chat.
  assert.equal(nextOffer(home([chat({ paneKey: 'tab:leaf' })])), null)
})

test('a chat’s question and permission are shown too, without the rest of the turn', async () => {
  const question = chat({ state: 'waiting', toolName: 'AskUserQuestion' })
  const asked = { toolUseId: 'q1', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] }
  const [q] = await offersOf([home([question])], { readQuestion: async () => asked })
  assert.equal(q.kind, 'question')
  assert.equal(q.chat, true)

  const waiting = chat({ state: 'permission', toolName: 'Bash' })
  let launchRead = false
  const [p] = await offersOf([home([waiting])], {
    readCall: async () => ({ toolUseId: 't1', name: 'Bash', input: { command: 'ls' } }),
    readLaunchInfo: async () => { launchRead = true; return { sessionId: 's', args: [] } }
  })
  assert.equal(p.kind, 'permission')
  assert.equal(p.chat, true)
  assert.deepEqual(p.suggestions.map((s) => s.action), ['allow', 'deny'])
  assert.equal(launchRead, false)
})

test('pressing a chat’s card sends nothing and says to answer in the chat', async () => {
  const offer = nextOffer(home([chat()]))
  const calls = []
  const send = createNextSender({ readOffers: async () => [offer], run: async (args) => { calls.push(args); return { result: { terminals: [] } } } })
  assert.deepEqual(await send({ offer: offer.id, index: 0 }), { sent: false, reason: 'chat' })
  assert.deepEqual(calls, [])
})

test('the panel shows a bot’s page with its tasks and its cards to read, and marks bots among the others', async () => {
  const worktrees = [
    home([chat()]),
    { path: '/Users/me/.orca/bots/security-check', displayName: 'Security check', isActive: false, agents: [chat({ state: 'working' })] }
  ]
  const run = async (_cli, args) => (args[0] === 'worktree' ? { ok: true, result: { worktrees } } : { ok: true, result: { terminals: [] } })
  const { active, agents, offers } = await readWorkspaces('orca', run)
  assert.equal(active.bot, true)
  assert.deepEqual(agents.map((agent) => agent.bot), [true, true])
  const sessions = [
    { listId: 'a', cwd: BOT, goal: '仕様をまとめる', updatedAt: 2, tasks: [{ id: '1', subject: '調べる', status: 'completed' }, { id: '2', subject: '書く', status: 'in_progress' }] },
    { listId: 'b', cwd: '/Users/me/.orca/bots/security-check', goal: 'CVE を見る', updatedAt: 1, tasks: [{ id: '1', subject: '巡回', status: 'in_progress' }] }
  ]
  const html = renderBody(buildModel(active, sessions, agents, offers))
  assert.ok(html.includes('<h1>Compass<span class="bot">bot</span></h1>'))
  assert.ok(html.includes('1 / 2'))
  assert.ok(html.includes('<div class="action shown"><span class="label">仕様を書く</span>'))
  assert.ok(!html.includes('data-next='), 'a chat’s card has nothing to press')
  assert.ok(html.includes('class="chat-note"'))
  assert.ok(html.includes('Security check<span class="bot">bot</span>'))
})

test('a chat’s form shows its options without a send button', () => {
  const offer = { kind: 'form', id: 'f', chat: true, questions: [{ question: 'Which?', multiSelect: true, options: [{ label: 'A', detail: '' }, { label: 'B', detail: 'b' }] }] }
  const html = renderBody({ kind: 'no-tasks', workspace: 'Compass', bot: true, agent: 'waiting', sessions: [], next: offer, others: { attention: 0, rows: [] } })
  assert.ok(html.includes('<div class="action shown"><span class="label">B</span><span class="detail">b</span></div>'))
  assert.ok(!html.includes('data-form='))
  assert.ok(!html.includes('data-submit='))
})

const line = (entry) => JSON.stringify(entry)
const said = (text) => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

test('lastReply is the text of the last reply, and nothing once the user typed after it', () => {
  const reply = `調べました。\n\n${block([{ label: 'A', prompt: 'a' }]).trim()}`
  const turn = [
    line({ type: 'user', message: { content: 'CVE を見て' } }),
    line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '…' }] } }),
    line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
    line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't' }] } }),
    said(reply),
    line({ type: 'system', subtype: 'stop_hook_summary' }),
    line({ type: 'last-prompt' })
  ]
  assert.equal(lastReply(turn.join('\n')), reply)
  assert.equal(lastReply([...turn, line({ type: 'user', message: { content: [{ type: 'text', text: '次へ' }] } })].join('\n')), null)
  assert.equal(lastReply([...turn, line({ type: 'user', isMeta: true, message: { content: 'meta' } })].join('\n')), reply)
  assert.equal(lastReply(''), null)
})

test('a chat’s whole reply is found among its folder’s transcripts by the start Orca keeps', async () => {
  const userHome = await makeHome()
  const dir = join(userHome, '.claude', 'projects', BOT.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(dir, { recursive: true })
  const whole = `${'長い返答です。'.repeat(40)}\n\n${block([{ label: 'A', prompt: 'a' }]).trim()}`
  // The chat's transcript, and a newer one of an automation run in the same folder.
  await writeFile(join(dir, 'chat.jsonl'), said(whole))
  await writeFile(join(dir, 'run.jsonl'), said('定期実行の報告'))
  await utimes(join(dir, 'chat.jsonl'), 1, 1)
  const read = createChatReplyReader(userHome)
  // Orca's line: the start, its newlines as spaces.
  const start = whole.replace(/\s+/g, ' ').slice(0, 200)
  assert.equal(await read(BOT, start), whole)
  assert.equal(await read(BOT, '別の返答'), null, 'a line behind the transcript finds nothing')
  assert.equal(await read(BOT, ''), null)
  assert.equal(await read('/Users/me/.orca/bots/none', start), null)
  // Only for the workspace on screen.
  const off = { ...home([chat({ lastAssistantMessage: start })]), isActive: false }
  let asked = 0
  await offersOf([off], { readReply: async () => { asked += 1; return whole } })
  assert.equal(asked, 0)
  const [offer] = await offersOf([home([chat({ lastAssistantMessage: start })])], { readReply: async (path, start) => (path === BOT && start ? whole : null) })
  assert.equal(offer.chat, true)
  assert.deepEqual(offer.suggestions.map((s) => s.label), ['A'])
})
