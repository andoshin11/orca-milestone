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
body { box-sizing: border-box; display: flex; flex-direction: column; min-height: 100vh;
  margin: 0; padding: 12px; font: 13px/1.5 system-ui, sans-serif;
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
.others { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--orca-border); }
.others h2 { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 6px;
  font-size: 11px; font-weight: 600; color: var(--orca-muted-foreground); }
.others h2 .attention { color: var(--ms-todo); }
.rows { margin: 0; padding: 0; list-style: none; }
.row { display: block; padding: 0; }
.row .head { display: block; padding: 4px 6px; margin: 0 -6px; border-radius: 4px; }
.row summary { cursor: pointer; list-style: none; }
.row summary::-webkit-details-marker { display: none; }
.row summary:hover { background: color-mix(in oklch, var(--orca-foreground) 7%, transparent); }
.row details[open] > summary { background: color-mix(in oklch, var(--orca-foreground) 5%, transparent); }
.row .detail { margin: 4px 0 8px 14px; font-size: 12px; }
.row .detail .goal { margin: 0 0 4px; }
.row .top { display: flex; align-items: center; gap: 6px; }
.row .dot { flex: none; box-sizing: border-box; width: 8px; height: 8px; border-radius: 50%; background: var(--orca-muted-foreground); }
.row.attention .dot { background: var(--ms-todo); }
.row .name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .repo { margin-left: 6px; font-size: 11px; color: var(--orca-muted-foreground); }
.row .badge { flex: none; padding: 0 6px; border-radius: 4px; font-size: 10px; font-weight: 700; line-height: 16px;
  color: var(--ms-todo); background: color-mix(in oklch, var(--ms-todo) 18%, transparent); }
.row .of { flex: none; font-size: 11px; color: var(--ms-done); }
.row .bar { height: 4px; margin: 4px 0 0 14px; }
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

function renderRow(row) {
  const percent = row.total === 0 ? 0 : Math.round((row.done / row.total) * 100)
  const badge = row.kind === 'attention' ? '<span class="badge">要確認</span>' : ''
  const of = row.total > 0 ? `<span class="of">${row.done} / ${row.total}</span>` : ''
  const bar = row.total > 0 ? `<div class="bar"><div style="width:${percent}%"></div></div>` : ''
  const repo = row.repo ? `<span class="repo">${escape(row.repo)}</span>` : ''
  const head = `<div class="top"><span class="dot"></span><span class="name">${escape(row.workspace)}${repo}</span>${badge}${of}</div>${bar}`
  if (row.total === 0) return `<li class="row ${row.kind}"><div class="head">${head}</div></li>`
  // A click opens the goal and the tasks. No script: the panel is rebuilt whenever its content
  // changes, which closes the row again.
  const goal = row.goal ? `<p class="goal">${escape(clip(row.goal, GOAL_MAX))}</p>` : ''
  return `<li class="row ${row.kind}"><details><summary class="head">${head}</summary>
<div class="detail">${goal}<ol>${row.tasks.map(renderTask).join('')}</ol></div></details></li>`
}

function renderOthers(others) {
  if (!others || others.rows.length === 0) return ''
  const attention = others.attention > 0 ? `<span class="attention">要確認 ${others.attention}</span>` : ''
  return `<div class="others"><h2><span>ほかのワークスペース</span>${attention}</h2>
<ol class="rows">${others.rows.map(renderRow).join('')}</ol></div>`
}

function renderBody(model) {
  // The focused workspace sits at the top and the others at the bottom edge, apart.
  return `<main>${renderFocused(model)}</main>${renderOthers(model.others)}`
}

function renderFocused(model) {
  if (model.kind === 'no-workspace') {
    return '<p class="empty">ワークスペースを開くと、Claude の進捗をここに表示します。</p>'
  }
  const agent = AGENT_LABELS[model.agent] ?? ''
  const header = `<header><h1>${escape(model.workspace)}</h1><span class="agent ${model.agent}">${agent}</span></header>`
  if (model.kind === 'no-tasks') {
    return `${header}<p class="empty">このワークスペースの Claude はまだタスクを作っていません。</p>`
  }
  return header + model.sessions.map(renderSession).join('')
}

export function renderPanel(model) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${STYLE}</style></head>
<body>${renderBody(model)}</body></html>
`
}
