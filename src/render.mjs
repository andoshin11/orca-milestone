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

const STYLE = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 12px; font: 13px/1.5 system-ui, sans-serif;
  color: var(--orca-foreground); background: var(--orca-background); }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
h1 { margin: 0; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent { flex: none; font-size: 11px; color: var(--orca-muted-foreground); }
.agent.working { color: var(--orca-primary); }
section { padding: 10px; margin-bottom: 10px; border: 1px solid var(--orca-border);
  border-radius: var(--orca-radius, 6px); background: var(--orca-card); color: var(--orca-card-foreground); }
.goal { margin: 0 0 8px; font-weight: 600; }
.count { display: flex; justify-content: space-between; font-size: 11px; color: var(--orca-muted-foreground); }
.bar { height: 4px; margin: 4px 0 10px; border-radius: 2px; background: var(--orca-muted); overflow: hidden; }
.bar > div { height: 100%; background: var(--orca-primary); }
ol { margin: 0; padding: 0; list-style: none; }
li { display: flex; gap: 8px; padding: 2px 0; }
li .mark { flex: none; width: 1em; text-align: center; }
li.completed { color: var(--orca-muted-foreground); }
li.completed .subject { text-decoration: line-through; }
li.in_progress { font-weight: 600; }
li.in_progress .mark { color: var(--orca-primary); }
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
  return `<section>${goal}<div class="count"><span>マイルストーン</span><span>${session.done} / ${session.total}</span></div>
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
