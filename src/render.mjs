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

function renderBody(model) {
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
