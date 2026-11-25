// Renders the panel model to the HTML of the panel's body. It carries no clock, so the same model
// gives the same bytes and the worker posts only real changes. The styles are in panel/style.css.

const GOAL_MAX = 160
const SUBJECT_MAX = 200
// A row with more tasks than this may need scrolling, so the pointer can enter its expansion.
const ROW_TASKS_SHORT = 8
const PROMPT_LINES_MAX = 300
// What a call waiting for permission would do, as src/risk.mjs tells it.
const RISK_LABELS = { read: '読むだけ', write: '書き換える', outside: '外に出る' }

function escape(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

function clip(text, max) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

const AGENT_LABELS = {
  working: '作業中',
  waiting: '入力待ち',
  idle: '待機中',
  // Waiting for the user while shells it started in the background run.
  background: '待機中（裏で実行中）',
  none: ''
}

const BOT_MARK = '<span class="bot">bot</span>'

const MARKS = { completed: '✓', in_progress: '●', pending: '○' }

function renderTask(task) {
  const subject = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject
  const status = MARKS[task.status] ? task.status : 'pending'
  return `<li class="${status}"><span class="mark">${MARKS[status]}</span><span class="subject"><span class="strike">${escape(clip(subject, SUBJECT_MAX))}</span></span></li>`
}

function renderSession(session) {
  const percent = session.total === 0 ? 0 : Math.round((session.done / session.total) * 100)
  const goal = session.goal ? `<p class="goal">${escape(clip(session.goal, GOAL_MAX))}</p>` : ''
  // The key tells the panel this is another list, which it shows at once instead of animating.
  const key = escape(`${session.listId}\n${clip(session.goal ?? '', GOAL_MAX)}`)
  return `<section data-key="${key}">${goal}<div class="count"><span>マイルストーン</span><strong>${session.done} / ${session.total}</strong></div>
<div class="bar"><div style="width:${percent}%"></div></div>
<ol>${session.tasks.map(renderTask).join('')}</ol></section>`
}

/** A card of an agent in an Orca chat: the same look, but nothing to press, see next-actions.mjs. */
function shownCard(label, body) {
  return `<li><div class="action shown"><span class="label">${escape(label)}</span>${body}</div></li>`
}

function card(offer, index, label, lines, extra = '') {
  const body = lines.filter(([, text]) => text).map(([kind, text]) => `<span class="${kind}">${escape(text)}</span>`).join('')
  if (offer.chat) return shownCard(label, body)
  return `<li><button type="button" class="action" data-next="${escape(offer.id)}" data-index="${index}"${extra}><span class="label">${escape(label)}</span>${body}</button></li>`
}

function renderForm(offer) {
  const questions = offer.questions.map((question, position) => {
    const options = question.options.map((option, index) => {
      const detail = option.detail ? `<span class="detail">${escape(option.detail)}</span>` : ''
      return offer.chat
        ? shownCard(option.label, detail)
        : `<li><button type="button" class="action option" data-form="${escape(offer.id)}" data-question="${position}" data-option="${index}" data-multi="${question.multiSelect ? '1' : '0'}"><span class="label">${escape(option.label)}</span>${detail}</button></li>`
    })
    const hint = question.multiSelect ? '<p class="hint">複数選択できます</p>' : ''
    return `<div class="question"><p class="ask">${escape(question.question)}</p>${hint}<ol class="actions">${options.join('')}</ol></div>`
  })
  if (offer.chat) return questions.join('')
  return `${questions.join('')}<button type="button" class="submit" data-submit="${escape(offer.id)}" data-count="${offer.questions.length}" disabled>回答を送信</button>`
}

const CHAT_NOTE = '<p class="chat-note">このエージェントは Orca のチャットで動いています。ここからは送れないので、チャットで答えてください。</p>'

/**
 * What the agent offers to choose from, one card under another: its next steps, its question or a
 * tool waiting for permission. A card says which offer and which card; the worker reads the agent
 * again when it is pressed.
 */
function renderNext(offer) {
  if (!offer) return ''
  let heading
  let body
  if (offer.kind === 'form') {
    heading = '<h2>質問に答える</h2>'
    body = renderForm(offer)
  } else if (offer.kind === 'question') {
    heading = '<h2>質問に答える</h2>'
    const cards = offer.suggestions.map((s, index) => card(offer, index, s.label, [['detail', s.detail]]))
    body = `<p class="ask">${escape(offer.question)}</p><ol class="actions">${cards.join('')}</ol>`
  } else if (offer.kind === 'permission') {
    const risk = offer.dangerous ? '<span class="danger">危険なコマンド</span>' : RISK_LABELS[offer.risk] ? `<span class="risk ${escape(offer.risk)}">${RISK_LABELS[offer.risk]}</span>` : ''
    heading = `<h2>許可の確認${risk}</h2>`
    const cards = offer.suggestions.map((s, index) =>
      card(offer, index, s.label, [['detail', s.detail]], s.action === 'allow' && offer.dangerous ? ' data-dangerous="1"' : '')
    )
    const where = offer.where ? `<p class="where">場所: ${escape(offer.where)}</p>` : ''
    body = `<p class="ask">${escape(offer.question)}</p>${where}<ol class="actions">${cards.join('')}</ol>`
  } else {
    heading = '<h2>次の作業<span>選ばなくても構いません</span></h2>'
    const cards = offer.suggestions.map((s, index) =>
      card(offer, index, s.label, s.action === 'restart' ? [['detail', s.detail]] : [['reason', s.reason], ['prompt', clip(s.prompt, PROMPT_LINES_MAX)]])
    )
    // Another Mac's daemon sends what the agent said at the end of its turn with the proposal.
    const summary = offer.summary ? `<p class="summary">${escape(clip(offer.summary, GOAL_MAX))}</p>` : ''
    body = `${summary}<ol class="actions">${cards.join('')}</ol>`
  }
  // What the rest of this turn allowed without a card, to be read afterwards.
  if (offer.allowed?.length > 0) {
    body += `<div class="allowed"><p>このターンでまとめて許可したもの</p><ul>${offer.allowed.map((line) => `<li>${escape(line)}</li>`).join('')}</ul></div>`
  }
  if (offer.chat) body += CHAT_NOTE
  // Another offer is another set of cards: it replaces the old one without a transition.
  return `<div class="next ${offer.kind}${offer.chat ? ' chat' : ''}" data-key="${escape(`next\n${offer.id}`)}">${heading}${body}</div>`
}

function renderRow(row) {
  const percent = row.total === 0 ? 0 : Math.round((row.done / row.total) * 100)
  const badge = row.kind === 'attention'
    ? '<span class="badge">要確認</span>'
    : row.working
      ? `<span class="working">${AGENT_LABELS.working}</span>`
      : row.background
        ? '<span class="background">裏で実行中</span>'
        : ''
  const of = row.total > 0 ? `<span class="of">${row.done} / ${row.total}</span>` : ''
  const bar = row.total > 0 ? `<div class="bar"><div style="width:${percent}%"></div></div>` : ''
  const repo = row.bot ? BOT_MARK : row.repo ? `<span class="repo">${escape(row.repo)}</span>` : ''
  // Every task done, nothing asked of the user: a check instead of the dot. A task in
  // progress turns the dot orange, like its mark in the list.
  const finished = row.kind !== 'attention' && row.total > 0 && row.done === row.total
  const running = row.kind !== 'attention' && row.tasks.some((task) => task.status === 'in_progress')
  const mark = finished
    ? '<span class="check">✓</span>'
    : running
      ? '<span class="dot running"></span>'
      : '<span class="dot"></span>'
  const head = `<div class="top">${mark}<span class="name">${escape(row.workspace)}${repo}</span>${badge}${of}</div>${bar}`
  const key = escape(`${row.workspace}\n${row.repo ?? ''}\n${clip(row.goal ?? '', GOAL_MAX)}`)
  // A session of another Mac has no path here to open; hovering still shows its tasks.
  const button = row.path === null
    ? `<div class="head" tabindex="0">${head}</div>`
    : `<div class="head" role="button" tabindex="0" data-open="${escape(row.path)}">${head}</div>`
  if (row.total === 0) return `<li class="row ${row.kind}" data-key="${key}">${button}</li>`
  // Hovering a row's head expands its goal and tasks; plain CSS, so it needs no script.
  const goal = row.goal ? `<p class="goal">${escape(clip(row.goal, GOAL_MAX))}</p>` : ''
  const long = row.tasks.length > ROW_TASKS_SHORT ? ' long' : ''
  return `<li class="row ${row.kind} has-detail${long}" data-key="${key}">${button}
<div class="detail"><div class="inner">${goal}<ol>${row.tasks.map(renderTask).join('')}</ol></div></div></li>`
}

function renderOthers(others) {
  if (!others || others.rows.length === 0) return ''
  const attention = others.attention > 0 ? `<span class="attention">要確認 ${others.attention}</span>` : ''
  return `<div class="others"><h2><span>ほかのワークスペース</span>${attention}</h2>
<ol class="rows">${others.rows.map(renderRow).join('')}</ol></div>`
}

const REMOTE_ERRORS = {
  unreachable: 'つながりません。Tailscale と接続先の設定を確かめてください。',
  loading: '読み込み中です。',
  unreadable: '読めない形式です。agent-status-panel の版を確かめてください。'
}

/** A session of another Mac: a row like the other workspaces, with its cards always shown under it. */
function renderRemoteSession(session) {
  const row = renderRow({
    workspace: session.workspace || session.agent,
    repo: null,
    path: null,
    kind: session.attention ? 'attention' : 'idle',
    working: false,
    background: false,
    goal: session.goal,
    done: session.done,
    total: session.total,
    tasks: session.tasks
  })
  // In an item of its own: a row stacks its expansion above its head.
  return session.offer ? `${row}<li class="remote-next">${renderNext(session.offer)}</li>` : row
}

/**
 * The sessions of the Mac whose daemon the settings name. Its buttons press there, so they need
 * the person's own Tailscale login, as on the iPhone.
 */
function renderRemote(remote) {
  if (!remote) return ''
  const attention = remote.sessions?.filter((session) => session.attention).length ?? 0
  const badge = attention > 0 ? `<span class="attention">要確認 ${attention}</span>` : ''
  const heading = `<h2><span>${escape(remote.label)}</span>${badge}</h2>`
  if (remote.error) {
    const text = REMOTE_ERRORS[remote.error] ?? `読めませんでした（${remote.error}）。`
    return `<div class="remote">${heading}<p class="empty">${escape(text)}</p></div>`
  }
  if (remote.sessions.length === 0) {
    return `<div class="remote">${heading}<p class="empty">実行中のセッションはありません。</p></div>`
  }
  return `<div class="remote">${heading}<ol class="rows">${remote.sessions.map(renderRemoteSession).join('')}</ol></div>`
}

export function renderBody(model) {
  // The focused workspace sits at the top and the others at the bottom edge, apart.
  // A workspace of another Mac in focus keeps the height it needs, as a focused one here does.
  const main = model.host ? '<main class="paired">' : '<main>'
  return `${main}${renderFocused(model)}</main>${renderOthers(model.others)}${renderRemote(model.remote)}`
}

function renderFocused(model) {
  if (model.kind === 'no-workspace') {
    return '<p class="empty">ワークスペースを開くと、エージェントの進捗をここに表示します。</p>'
  }
  const agent = AGENT_LABELS[model.agent] ?? ''
  const host = model.host ? `<span class="host">${escape(model.host)}</span>` : ''
  const header = `<header><h1>${escape(model.workspace)}${model.bot ? BOT_MARK : ''}${host}</h1><span class="agent ${model.agent}">${agent}</span></header>`
  if (model.kind === 'no-tasks') {
    return `${header}<p class="empty">このワークスペースのエージェントはまだタスクを作っていません。</p>${renderNext(model.next)}`
  }
  return header + model.sessions.map(renderSession).join('') + renderNext(model.next)
}
