import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claudeInstructions, launchSignature } from '../src/launch-hook.mjs'
import { createNextSender, nextOffer, offersOf } from '../src/next-actions.mjs'
import { buildModel } from '../src/model.mjs'
import { renderBody } from '../src/render.mjs'
import { createRestarter, inputText, isInputEmpty, isStale, resumeCommand, suggestionFrom } from '../src/restart.mjs'

const SESSION = '5f67451a-058b-4e44-98fa-349658ba37bf'
const PLUGIN = '/Users/u/Library/Application Support/orca/claude-agent-view/d533/orca-agent-view'
const OLD_ARGS = `claude --append-system-prompt Record your work as tasks. --plugin-dir ${PLUGIN} --dangerously-skip-permissions --resume ${SESSION}`
const TEAMS_ARGS = `claude --teammate-mode auto --append-system-prompt Old words --dangerously-skip-permissions --model opus --resume ${SESSION}`
const RULE = '─'.repeat(40)
const screen = (typed = '') => `● できました\n${RULE}\n❯ ${typed}\n${RULE}\n  ⏵⏵ bypass permissions on`

test('a session is stale unless it was told what the plugin says now', () => {
  assert.equal(isStale(OLD_ARGS), true)
  assert.equal(isStale(`claude --append-system-prompt ${claudeInstructions()} --resume ${SESSION}`), true, 'without the permission hook')
  assert.equal(isStale(`claude --append-system-prompt ${launchSignature().join(' --settings ')} --resume ${SESSION}`), false)
})

test('the resumed command keeps the permissions, the model and the plugin folder, and gets the new words', () => {
  const shell = resumeCommand(OLD_ARGS, SESSION)
  assert.ok(shell.startsWith(`env CLAUDE_CODE_ENABLE_TODO_TOOLS=1 claude --append-system-prompt '${claudeInstructions()}' `))
  assert.ok(shell.endsWith(` --dangerously-skip-permissions --plugin-dir '${PLUGIN}' --resume ${SESSION}`), shell)
  assert.ok(!shell.includes('Record your work'), 'the old words go')
  const teams = resumeCommand(TEAMS_ARGS, SESSION)
  assert.ok(teams.startsWith('env CLAUDE_CODE_ENABLE_TODO_TOOLS=1 orca claude-teams --append-system-prompt'))
  assert.ok(teams.endsWith(` --dangerously-skip-permissions --model opus --resume ${SESSION}`), teams)
  assert.ok(!teams.includes('--teammate-mode'), 'orca claude-teams adds it')
  assert.ok(!resumeCommand(`claude --model "x;y" --resume ${SESSION}`, SESSION).includes('--model'), 'an odd value is left out')
})

test('the input box is read from the screen, and its gray suggestion counts as empty', () => {
  assert.equal(inputText(screen()), '')
  assert.equal(inputText(screen('half a thought')), 'half a thought')
  assert.equal(inputText(`${RULE}\n❯ line one\n  line two\n${RULE}`), 'line one line two')
  assert.equal(inputText('no box here'), null)
  assert.equal(isInputEmpty('', null), true)
  assert.equal(isInputEmpty('PR を作って', 'PR を作ってください'), true)
  assert.equal(isInputEmpty('PR を作って', null), false)
  assert.equal(isInputEmpty('ほかのこと', 'PR を作ってください'), false)
  const latin1 = (text) => Buffer.from(text, 'utf8').toString('latin1')
  const painted = `\x1b[H\r\x1b[2C\x1b[69B\x1b[2m${latin1('PR を作ってください')}\x1b[22m\x1b[73;1H\x1b[70;3H`
  assert.equal(suggestionFrom(painted), 'PR を作ってください')
  assert.equal(suggestionFrom(`${painted}\x1b[H\r\x1b[2C\x1b[69Babc`), null)
})

const reply = 'できました\n```next\n[{"label":"A","prompt":"do a"}]\n```'
const claude = (extra = {}) => ({ agentType: 'claude', state: 'done', paneKey: 'tab:leaf', hasLivePty: true, stateStartedAt: 5, lastAssistantMessage: reply, ...extra })

test('a waiting session told something older gets a restart card after its proposals, on screen only', async () => {
  const launch = { sessionId: SESSION, pid: 1, args: OLD_ARGS }
  const offer = nextOffer({ path: '/w', agents: [claude()] }, launch)
  assert.deepEqual(offer.suggestions.map((s) => [s.label, s.action]), [['A', undefined], ['最新の指示で再開', 'restart']])
  assert.equal(offer.sessionId, SESSION)
  assert.notEqual(offer.id, nextOffer({ path: '/w', agents: [claude()] }).id)
  assert.deepEqual(nextOffer({ path: '/w', agents: [claude({ lastAssistantMessage: 'hi' })] }, launch).suggestions.map((s) => s.action), ['restart'])
  assert.equal(nextOffer({ path: '/w', agents: [claude({ lastAssistantMessage: 'hi', background: true })] }, launch), null, 'not with shells in the background')
  const readLaunch = async () => launch
  const shown = async (worktree) => (await offersOf([worktree], { readLaunch }))[0]?.suggestions.map((s) => s.label)
  assert.deepEqual(await shown({ path: '/w', isActive: true, agents: [claude()] }), ['A', '最新の指示で再開'])
  assert.deepEqual(await shown({ path: '/w', agents: [claude()] }), ['A'], 'a workspace off screen is not read')
  assert.deepEqual(await shown({ path: '/w', isActive: true, agents: [claude({ agentType: 'codex' })] }), ['A'])
  const html = renderBody(buildModel({ path: '/w', displayName: 'w', agentStates: ['done'] }, [], [], [offer]))
  assert.ok(html.includes('<span class="label">最新の指示で再開</span><span class="detail">同じ会話のまま、いまの plugin の指示で起動し直します</span>'))
})

function setup({ typed = '', parent = '-/opt/homebrew/bin/fish -l', exits = true, comesBack = true, launch = { sessionId: SESSION, pid: 41, args: OLD_ARGS }, suggestion = '' } = {}) {
  const calls = []
  let alive = true
  let time = 0
  const restart = createRestarter({
    home: '/h',
    run: async (args) => {
      calls.push(args)
      if (args[1] === 'send' && args.includes('/exit') && exits) alive = false
      return { ok: true, result: { send: { accepted: true } } }
    },
    readLaunch: async () => launch,
    readScreen: async () => screen(typed),
    readOutput: async () => suggestion,
    parentArgs: async () => parent,
    running: () => alive,
    sessions: async () => (comesBack && !alive ? [{ sessionId: SESSION, pid: 99 }] : [{ sessionId: SESSION, pid: 41 }]),
    wait: async (ms) => { time += ms },
    now: () => time
  })
  const found = { path: '/w', sessionId: SESSION }
  const terminal = { handle: 'h1', ptyId: 'p1', title: 'Claude Tag 相当機能' }
  return { calls, go: () => restart(found, terminal) }
}

test('a session started from a shell exits and starts again in the same terminal', async () => {
  const { calls, go } = setup()
  assert.deepEqual(await go(), { sent: true })
  assert.deepEqual(calls[0], ['terminal', 'send', '--terminal', 'h1', '--text', '/exit', '--enter', '--json'])
  assert.equal(calls[1][5], resumeCommand(OLD_ARGS, SESSION))
  assert.equal(calls.length, 2)
})

test('a session Orca started gets a new terminal with the same title', async () => {
  const { calls, go } = setup({ parent: '/Applications/Orca.app/Contents/MacOS/Orca' })
  assert.deepEqual(await go(), { sent: true })
  assert.deepEqual(calls[1].slice(0, 7), ['terminal', 'create', '--worktree', 'path:/w', '--title', 'Claude Tag 相当機能', '--command'])
})

test('nothing is sent over a draft, to another session, or once it is no longer stale', async () => {
  const draft = setup({ typed: 'half a thought' })
  assert.deepEqual(await draft.go(), { sent: false, reason: 'draft' })
  assert.deepEqual(draft.calls, [])
  const gray = setup({ typed: 'PR を作って', suggestion: '\x1b[H\r\x1b[2C\x1b[69B\x1b[2mPR \xe3\x82\x92\x1b[22m\x1b[73;1H\x1b[70;3H' })
  assert.deepEqual(await gray.go(), { sent: false, reason: 'draft' }, 'text beyond the suggestion is a draft')
  assert.deepEqual((await setup({ launch: null }).go()), { sent: false, reason: 'stale' })
  assert.deepEqual((await setup({ launch: { sessionId: 'other', pid: 41, args: OLD_ARGS } }).go()), { sent: false, reason: 'stale' })
})

test('a session that does not exit is left as it was, and one that does not come back is reported', async () => {
  const stuck = setup({ exits: false })
  await assert.rejects(stuck.go(), /did not exit/)
  assert.equal(stuck.calls.at(-1)[5], '\u001b', 'closes a dialog that kept it open')
  await assert.rejects(setup({ comesBack: false }).go(), /did not start again/)
})

test('the sender hands a restart card to the restarter once, and lets it be pressed again after a refusal', async () => {
  const offer = nextOffer({ path: '/w', agents: [claude()] }, { sessionId: SESSION })
  const answers = [{ sent: false, reason: 'draft' }, { sent: true }]
  const pressed = []
  const send = createNextSender({
    readOffers: async () => [offer],
    run: async () => ({ ok: true, result: { terminals: [{ handle: 'h1', tabId: 'tab', leafId: 'leaf', writable: true }] } }),
    restart: async (found, terminal) => (pressed.push([found.sessionId, terminal.handle]), answers.shift())
  })
  assert.deepEqual(await send({ offer: offer.id, index: 1 }), { sent: false, reason: 'draft' })
  assert.deepEqual(await send({ offer: offer.id, index: 1 }), { sent: true })
  assert.deepEqual(await send({ offer: offer.id, index: 1 }), { sent: false, reason: 'stale' })
  assert.deepEqual(pressed, [[SESSION, 'h1'], [SESSION, 'h1']])
})
