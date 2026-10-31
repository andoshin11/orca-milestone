// Renders the panel model to a static HTML document. Orca remounts the panel whenever this
// document changes, so it carries no script state and no clock: the same model, the same bytes.

const GOAL_MAX = 160
const SUBJECT_MAX = 200

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
  none: ''
}

// Panels only get Orca's neutral tokens, so the status hues are Orca's own Tailwind v4 values
// copied from its sources: green is the emerald of the sidebar's status dot (progress, done),
// orange is --agent-question (the task in progress, waiting), yellow is --agent-working. Orca puts `dark`
// or `light` on the panel's <html>, which picks the shade for each theme.
const STYLE = `
:root { color-scheme: light dark;
  --ms-done: oklch(59.6% 0.145 163.225); --ms-todo: oklch(64.6% 0.222 41.116);
  --ms-working: oklch(68.1% 0.162 75.834); --ms-track: color-mix(in oklch, var(--orca-foreground) 12%, transparent); }
html.dark { --ms-done: oklch(69.6% 0.17 162.48); --ms-todo: oklch(70.5% 0.213 47.604);
  --ms-working: oklch(79.5% 0.184 86.047); --ms-track: color-mix(in oklch, var(--orca-foreground) 16%, transparent); }
body { margin: 0; padding: 12px; font: 13px/1.5 system-ui, sans-serif;
  color: var(--orca-foreground); background: var(--orca-background); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
h1 { margin: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent { flex: none; font-size: 11px; font-weight: 600; color: var(--orca-muted-foreground); }
.agent.working { color: var(--ms-working); }
.agent.waiting { color: var(--ms-todo); }
section { padding: 10px; margin-bottom: 10px; border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius, 6px); background: var(--orca-card); color: var(--orca-card-foreground); }
.goal { margin: 0 0 8px; font-weight: 600; }
.count { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; color: var(--orca-muted-foreground); }
.count strong { font-size: 12px; color: var(--ms-done); }
.bar { height: 6px; margin: 4px 0 10px; border-radius: 3px; background: var(--ms-track); overflow: hidden; }
.bar > div { height: 100%; border-radius: 3px; background: var(--ms-done); }
ol { margin: 0; padding: 0; list-style: none; }
li { display: flex; gap: 8px; padding: 2px 0; }
li .mark { flex: none; width: 1em; text-align: center; font-weight: 700; color: var(--ms-todo); }
li.completed { color: var(--orca-muted-foreground); }
li.completed .mark { color: var(--ms-done); }
li.pending .mark { color: var(--orca-muted-foreground); }
li.completed .subject { text-decoration: line-through; }
li.in_progress { font-weight: 600; }
.empty { color: var(--orca-muted-foreground); }
code { font-size: 12px; }
.machine { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--orca-border); }
.machine h2 { margin: 0 0 4px; font-size: 12px; font-weight: 600; }
.tally { display: flex; gap: 10px; margin: 0 0 10px; font-size: 11px; color: var(--orca-muted-foreground); }
.tally b { font-size: 13px; }
.tally .attention b { color: var(--ms-todo); }
.tally .working b { color: var(--ms-working); }
.machine h3 { margin: 10px 0 4px; font-size: 11px; font-weight: 600; color: var(--orca-muted-foreground); }
.rows { margin: 0; padding: 0; list-style: none; }
.row { display: flex; gap: 8px; padding: 5px 0; }
.row + .row { border-top: 1px solid color-mix(in oklch, var(--orca-border) 60%, transparent); }
.row .dot { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; }
.row.attention .dot { background: var(--ms-todo); }
.row.attention.review .dot { background: var(--ms-done); }
.row.working .dot { border: 2px solid var(--ms-working); width: 4px; height: 4px; }
.row .main { min-width: 0; flex: 1; }
.row .top, .row .bottom { display: flex; justify-content: space-between; gap: 8px; }
.row .name { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .meta { flex: none; font-size: 11px; color: var(--orca-muted-foreground); }
.row.attention .meta { color: var(--ms-todo); }
.row.attention.review .meta { color: var(--ms-done); }
.row .bottom { font-size: 11px; color: var(--orca-muted-foreground); }
.row .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .of { flex: none; color: var(--ms-done); }
`

const MARKS = { completed: '✓', in_progress: '●', pending: '○' }

function renderTask(task) {
  const subject = task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject
  const status = MARKS[task.status] ? task.status : 'pending'
  return `<li class="${status}"><span class="mark">${MARKS[status]}</span><span class="subject">${escape(clip(subject, SUBJECT_MAX))}</span></li>`
}

function renderSession(session) {
  const percent = session.total === 0 ? 0 : Math.round((session.done / session.total) * 100)
  const goal = session.goal ? `<p class="goal">${escape(clip(session.goal, GOAL_MAX))}</p>` : ''
  return `<section>${goal}<div class="count"><span>マイルストーン</span><strong>${session.done} / ${session.total}</strong></div>
<div class="bar"><div style="width:${percent}%"></div></div>
<ol>${session.tasks.map(renderTask).join('')}</ol></section>`
}

const REASON_LABELS = { input: '入力待ち', permission: '許可待ち', review: '未確認' }

function ageLabel(age) {
  if (!age) return ''
  if (age.unit === 'now') return '今'
  return `${age.value}${{ minutes: '分', hours: '時間', days: '日' }[age.unit]}`
}

function renderRow(row) {
  // How long the agent has been in its state: waiting for the user, or at work.
  const meta = [REASON_LABELS[row.reason], ageLabel(row.age)].filter(Boolean).join(' ')
  const what = row.goal ? `<span class="what">${escape(clip(row.goal, GOAL_MAX))}</span>` : '<span class="what"></span>'
  const of = row.total > 0 ? `<span class="of">${row.done} / ${row.total}</span>` : ''
  return `<li class="row ${row.kind}${row.reason ? ` ${row.reason}` : ''}"><span class="dot"></span><div class="main">
<div class="top"><span class="name">${escape(row.workspace)}</span><span class="meta">${meta}</span></div>
<div class="bottom">${what}${of}</div></div></li>`
}

function renderMachine(machine) {
  if (!machine) return ''
  const { counts } = machine
  if (counts.attention + counts.working + counts.idle === 0) return ''
  const list = (title, rows) => (rows.length > 0 ? `<h3>${title}</h3><ol class="rows">${rows.map(renderRow).join('')}</ol>` : '')
  return `<div class="machine"><h2>このマシンの Claude</h2>
<p class="tally"><span class="attention">確認待ち <b>${counts.attention}</b></span><span class="working">作業中 <b>${counts.working}</b></span><span>待機 <b>${counts.idle}</b></span></p>
${list('確認待ち', machine.attention)}${list('作業中', machine.working)}</div>`
}

function renderBody(model) {
  return renderFocused(model) + renderMachine(model.machine)
}

function renderFocused(model) {
  if (model.kind === 'no-workspace') {
    return '<p class="empty">ワークスペースを開くと、Claude の進捗をここに表示します。</p>'
  }
  const agent = AGENT_LABELS[model.agent] ?? ''
  const header = `<header><h1>${escape(model.workspace)}</h1><span class="agent ${model.agent}">${agent}</span></header>`
  if (model.kind === 'no-tasks') {
    return `${header}<p class="empty">このワークスペースの Claude はまだタスクを作っていません。</p>
<p class="empty">Claude がタスクを作るには、<code>CLAUDE_CODE_ENABLE_TODO_TOOLS=1</code> を設定して起動します。</p>`
  }
  return header + model.sessions.map(renderSession).join('')
}

export function renderPanel(model) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>${renderBody(model)}</body></html>
`
}
