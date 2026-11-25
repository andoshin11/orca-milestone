// Reads the sessions of another Mac from its agent-status-panel daemon, the same `status.json` the
// iPhone reads, and presses its buttons with `POST /next`. This is how an Orca that only connects to
// the Mac running the agents shows them: their task files are not on this disk.
// The address comes from the plugin's settings and is never written into the repository.

import { createHash } from 'node:crypto'

const TIMEOUT_MS = 8_000
const MARKS = { c: 'completed', i: 'in_progress', p: 'pending' }

/**
 * The `status.json` URL for what the person typed: a bare host such as `mac-mini.example.ts.net`,
 * or an https URL with or without the path. Null when it is empty or not https.
 */
export function statusUrl(text) {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) return null
  let url
  try {
    url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/status.json'
  url.search = ''
  url.hash = ''
  return url
}

function parseList(text) {
  if (typeof text !== 'string' || !text) return []
  try {
    const value = JSON.parse(text)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/**
 * What an agent offers on a session of the daemon, in the shape the panel draws for the focused
 * workspace. The daemon names no kind, so it is told by the fields: a form has questions, a
 * permission is what the agent waits on, and a question has its text while the agent waits;
 * otherwise it proposes.
 */
function offerOf(session) {
  if (typeof session.offer !== 'string' || !session.offer) return null
  const labels = parseList(session.suggestions).map(String)
  const details = parseList(session.details).map((text) => (typeof text === 'string' ? text : ''))
  const reasons = parseList(session.reasons).map((text) => (typeof text === 'string' ? text : ''))
  const questions = parseList(session.questions).filter(
    (question) => question && typeof question.question === 'string' && Array.isArray(question.options)
  )
  if (questions.length > 0) {
    return {
      kind: 'form',
      id: session.offer,
      questions: questions.map((question) => ({
        question: question.question,
        multiSelect: question.multiSelect === true,
        options: question.options.map((option) => ({ label: String(option?.label ?? ''), detail: option?.detail ?? '' }))
      }))
    }
  }
  const question = typeof session.question === 'string' ? session.question : ''
  if (session.attention === 'permission') {
    return {
      kind: 'permission',
      id: session.offer,
      question,
      dangerous: session.dangerous === '1',
      // The daemon allows on the first card and denies on the others.
      suggestions: labels.map((label, index) => ({ label, detail: details[index] ?? '', action: index === 0 ? 'allow' : 'deny' }))
    }
  }
  // Only a question stops the agent; a proposal's text is the summary of the turn it finished.
  if (question && session.attention) {
    return { kind: 'question', id: session.offer, question, suggestions: labels.map((label, index) => ({ label, detail: details[index] ?? '' })) }
  }
  return {
    kind: 'proposal',
    id: session.offer,
    ...(question ? { summary: question } : {}),
    suggestions: labels.map((label, index) => ({ label, reason: reasons[index] ?? '', prompt: details[index] ?? '' }))
  }
}

function count(text) {
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** The sessions of a `status.json` body; those needing the user first, then in the daemon's order. */
export function readSnapshot(body) {
  if (!body || !Array.isArray(body.sessions)) throw new TypeError('not a status.json body')
  const sessions = body.sessions
    .filter((session) => session && typeof session.id === 'string')
    .map((session) => ({
      id: session.id,
      agent: session.agent ?? '',
      workspace: typeof session.workspace === 'string' ? session.workspace : '',
      place: typeof session.place === 'string' ? session.place : '',
      goal: typeof session.goal === 'string' && session.goal ? session.goal : null,
      attention: typeof session.attention === 'string' ? session.attention : '',
      finished: session.state === 'finished',
      live: session.live !== '0',
      done: count(session.done),
      total: count(session.total),
      tasks: parseList(session.tasks)
        .filter((row) => Array.isArray(row) && typeof row[1] === 'string')
        .map(([code, subject]) => ({ status: MARKS[code] ?? 'pending', subject })),
      offer: offerOf(session)
    }))
  const rank = (session) => (session.attention ? 0 : session.finished ? 2 : 1)
  return {
    at: Number(body.at) || 0,
    sessions: sessions.map((session, index) => ({ session, index }))
      .sort((a, b) => rank(a.session) - rank(b.session) || a.index - b.index)
      .map(({ session }) => session)
  }
}

/**
 * Talks to one daemon.
 * @param fetchImpl  `fetch`, replaced in tests
 */
export function createRemoteClient({ fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  /** The sessions there, or `{ error }` saying why they could not be read. */
  async function read(url) {
    let response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    } catch {
      return { error: 'unreachable' }
    }
    if (response.status === 503) return { error: 'loading' }
    if (!response.ok) return { error: `http ${response.status}` }
    try {
      return readSnapshot(await response.json())
    } catch {
      return { error: 'unreadable' }
    }
  }

  /**
   * Presses a button there. The request is what the panel sends for a local card, which is also
   * what the daemon takes; its answer becomes the reason the panel shows when nothing was sent.
   */
  async function press(url, request) {
    let response
    try {
      response = await fetchImpl(new URL('/next', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs * 4)
      })
    } catch {
      return { sent: false, reason: 'failed' }
    }
    if (response.status === 204 || response.status === 200) return { sent: true }
    const reasons = { 409: 'stale', 423: 'busy', 428: 'confirm', 403: 'forbidden' }
    return { sent: false, reason: reasons[response.status] ?? 'failed' }
  }

  return { read, press }
}

/**
 * The path, on the Mac it lives on, of a workspace this Orca shows from a paired Orca server. Orca
 * names such a workspace `<project id>::<path>` and gives its worker no other trace of the path.
 */
export function pairedPathOf(context) {
  const id = typeof context?.workspaceId === 'string' ? context.workspaceId : ''
  const at = id.lastIndexOf('::')
  const path = at >= 0 ? id.slice(at + 2) : ''
  return path.startsWith('/') ? path : null
}

/** Where a session runs as the daemon says it, a hash of its directory. */
export function placeOf(path) {
  return createHash('sha256').update(path).digest('hex').slice(0, 16)
}

/**
 * Splits the sessions of the daemon into those of the workspace at a path on that Mac and the
 * others. A daemon too old to say where its sessions run matches none.
 */
export function splitByPlace(sessions, path) {
  const place = placeOf(path)
  const mine = []
  const others = []
  for (const session of sessions) (session.place === place ? mine : others).push(session)
  return { mine, others }
}
