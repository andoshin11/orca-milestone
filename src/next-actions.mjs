// The next steps an agent proposed at the end of its reply, and sending the one pressed in the
// panel. The block is the one the launch hook asks for, and the rules match agent-status-panel,
// which turns the same block into buttons on a phone. The panel says only which button: the prompt
// is read again from the reply when it is pressed, so a button from an earlier turn does nothing.
import { createHash } from 'node:crypto'

const SUGGESTIONS_MAX = 3
const LABEL_MAX = 30
const PROMPT_MAX = 300
const REASON_MAX = 80
const NEXT_BLOCK = /```next[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/
const CONTROL = /[\u0000-\u001f\u007f]/
const TRACKED_AGENTS = new Set(['claude', 'codex'])
const USED_MAX = 256
const SUBMIT_WAIT_SECONDS = '8'
const SEND_TIMEOUT_MS = 20_000
// Claude Code's stash: it takes what is in the input box and puts it back after the next submit.
const STASH_KEY = '\u0013'
const STASH_WAIT_MS = 400
// Codex shows this while its input box is empty. Text in the box does not show on a screen read.
const CODEX_EMPTY_HINT = '? for shortcuts'

function shorten(text, max) {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

function isSuggestion(value) {
  if (typeof value?.label !== 'string' || typeof value?.prompt !== 'string') return false
  const label = value.label.trim()
  const prompt = value.prompt.trim()
  if (!label || !prompt || CONTROL.test(label) || CONTROL.test(prompt)) return false
  // The prompt goes on a command line as the value of an option.
  return [...label].length <= LABEL_MAX && [...prompt].length <= PROMPT_MAX && !prompt.startsWith('-')
}

/** Optional, and only shown: a bad one costs the reason, not the button. */
function reasonOf(reason) {
  if (typeof reason !== 'string' || !reason.trim() || CONTROL.test(reason)) return ''
  return shorten(reason, REASON_MAX)
}

/** The buttons of a reply, or none when its last thing is not a valid next block. */
export function parseSuggestions(message) {
  const block = NEXT_BLOCK.exec(message ?? '')
  if (!block) return []
  let list
  try {
    list = JSON.parse(block[1])
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  return list
    .filter(isSuggestion)
    .slice(0, SUGGESTIONS_MAX)
    .map(({ label, prompt, reason }) => ({ label: label.trim(), prompt: prompt.trim(), reason: reasonOf(reason) }))
}

/**
 * What a workspace's agent proposes now: only one that finished its turn, and only when the
 * workspace has one live main agent, so a button cannot reach another agent than the one shown.
 */
export function nextOffer(worktree) {
  if (worktree.isArchived) return null
  // Orca keeps the record of a pane that has closed, without hasLivePty.
  const agents = (worktree.agents ?? []).filter(
    (agent) => TRACKED_AGENTS.has(agent.agentType) && !agent.parentPaneKey && agent.hasLivePty === true
  )
  if (agents.length !== 1 || agents[0].state !== 'done') return null
  const [agent] = agents
  const suggestions = parseSuggestions(agent.lastAssistantMessage)
  if (suggestions.length === 0) return null
  // Changes with every turn, so a button shown for an earlier reply matches nothing.
  const id = createHash('sha256').update(`${agent.paneKey}\n${agent.stateStartedAt}`).digest('hex').slice(0, 16)
  return { id, path: worktree.path, agent: agent.agentType, paneKey: agent.paneKey, suggestions }
}

/** A workspace not on screen has no tab for its pane, and its terminal only records the key. */
function isPane(terminal, paneKey) {
  return terminal.recordedPaneKey === paneKey || `${terminal.tabId}:${terminal.leafId}` === paneKey
}

/**
 * @param readOffers resolves to the offers of every workspace, read from Orca now
 * @param run        runs the Orca CLI with arguments and resolves to its JSON reply
 * @returns a function that takes `{ offer, index }` and resolves to `{ sent: true }`, or to
 *   `{ sent: false, reason }` with `stale` when that button is no longer on offer and `typing` when
 *   Codex has a draft the prompt would join. It throws when sending fails.
 */
export function createNextSender({ readOffers, run, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const used = new Set()

  function take(offer) {
    used.add(offer)
    if (used.size > USED_MAX) used.delete(used.values().next().value)
  }

  return async function send({ offer, index } = {}) {
    if (typeof offer !== 'string' || !Number.isInteger(index) || used.has(offer)) return { sent: false, reason: 'stale' }
    const found = (await readOffers()).find((candidate) => candidate.id === offer)
    const suggestion = found?.suggestions[index]
    if (!suggestion) return { sent: false, reason: 'stale' }
    const { terminals } = (await run(['terminal', 'list', '--json'])).result
    const terminal = terminals.find((candidate) => isPane(candidate, found.paneKey) && candidate.writable)
    if (!terminal) return { sent: false, reason: 'stale' }
    if (found.agent === 'codex') {
      const screen = (await run(['terminal', 'read', '--terminal', terminal.handle, '--screen', '--limit', '60', '--json'])).result
      if (!screen.terminal.tail.join('\n').includes(CODEX_EMPTY_HINT)) return { sent: false, reason: 'typing' }
    }
    // Checked again here, right before the send: a second press may have arrived during the reads.
    if (used.has(offer)) return { sent: false, reason: 'stale' }
    take(offer)
    try {
      if (found.agent === 'claude') {
        await run(['terminal', 'send', '--terminal', terminal.handle, '--text', STASH_KEY, '--json'])
        await wait(STASH_WAIT_MS)
      }
      const reply = await run(
        ['terminal', 'send', '--terminal', terminal.handle, '--text', suggestion.prompt, '--enter', '--wait-submit', SUBMIT_WAIT_SECONDS, '--json'],
        SEND_TIMEOUT_MS
      )
      if (!reply.result?.send?.accepted) throw new Error('the terminal did not accept the prompt')
    } catch (error) {
      used.delete(offer)
      throw error
    }
    return { sent: true }
  }
}
