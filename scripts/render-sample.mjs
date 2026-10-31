// Renders the panel with made-up workspaces and tasks, for the screenshots in the README.
//
//   node scripts/render-sample.mjs <out.html> [--hover]
//
// The page wraps the panel in the same sandboxed frame Orca uses, with the design tokens of
// Orca's dark theme. --hover shows the detail of one other workspace, as a hover would.
import { writeFile } from 'node:fs/promises'
import { buildModel } from '../src/model.mjs'
import { renderPanel } from '../src/render.mjs'

const [out, flag] = process.argv.slice(2)
if (!out) {
  console.error('usage: node scripts/render-sample.mjs <out.html> [--hover]')
  process.exit(1)
}

const ORCA_DARK_TOKENS =
  '--orca-background:#0a0a0a;--orca-foreground:#fafafa;--orca-card:#171717;' +
  '--orca-card-foreground:#fafafa;--orca-primary:#e5e5e5;--orca-muted:#262626;' +
  '--orca-muted-foreground:#a1a1a1;--orca-border:rgb(255 255 255 / 0.07);--orca-radius:6px'

function tasks(goal, items) {
  return items.map(([subject, status], index) => ({
    id: String(index + 1),
    subject,
    status,
    metadata: { goal }
  }))
}

function list(listId, workspace, goal, items, updatedAt) {
  return { listId, cwd: `/work/${workspace}`, goal, tasks: tasks(goal, items), updatedAt }
}

const sessions = [
  list('focused', 'search-filters', '商品一覧に価格と在庫の絞り込みを追加する', [
    ['今の検索 API を調べる', 'completed'],
    ['絞り込みの条件をクエリに足す', 'completed'],
    ['フィルターの UI を作る', 'in_progress'],
    ['テストを書く', 'pending'],
    ['PR を作る', 'pending'],
    ['CI の成功を確かめる', 'pending']
  ], 9),
  list('a', 'login-redirect', 'ログイン後に元のページへ戻す', [
    ['リダイレクト先の保存方法を決める', 'completed'],
    ['ログイン処理を直す', 'in_progress'],
    ['E2E テストを足す', 'pending']
  ], 8),
  list('b', 'upgrade-node', 'Node.js 24 に上げる', [
    ['依存関係の対応状況を調べる', 'completed'],
    ['CI のイメージを更新する', 'completed'],
    ['ビルドを通す', 'completed'],
    ['ステージングで動作を確かめる', 'pending'],
    ['本番に出す', 'pending']
  ], 7),
  list('c', 'csv-export', '注文一覧を CSV で書き出せるようにする', [
    ['書き出す項目を決める', 'completed'],
    ['エクスポート API を作る', 'completed'],
    ['ダウンロードボタンを置く', 'completed'],
    ['PR を作る', 'completed']
  ], 6),
  list('d', 'flaky-tests', '不安定なテストを直す', [
    ['失敗の記録を集める', 'completed'],
    ['待ち時間の扱いを直す', 'pending'],
    ['100 回流して確かめる', 'pending']
  ], 5)
]

const agent = (workspace, repo, state, since) => ({
  workspace,
  repo,
  path: `/work/${workspace}`,
  focused: workspace === 'search-filters',
  state,
  since
})

const model = buildModel(
  { path: '/work/search-filters', displayName: 'search-filters', claudeStates: ['working'] },
  sessions,
  [
    agent('search-filters', 'web-app', 'working', 9),
    agent('login-redirect', 'auth-service', 'waiting', 4),
    agent('upgrade-node', 'web-app', 'working', 7),
    agent('csv-export', 'admin-console', 'done', 6),
    agent('flaky-tests', 'api-server', 'done', 5)
  ]
)

// Which row to open for --hover: the second one, a workspace with unfinished tasks.
const hover = flag === '--hover'
  ? '<style>.row.has-detail:nth-child(2) .detail{display:block}' +
    '.row.has-detail:nth-child(2) .head{background:color-mix(in oklch,#fafafa 7%,transparent)}</style>'
  : ''
const panel = renderPanel(model)
  .replace('<html>', '<html class="dark">')
  .replace('<head>', `<head><style>:root{${ORCA_DARK_TOKENS}}</style>`)
  .replace('</head>', `${hover}</head>`)
const srcdoc = panel.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

await writeFile(
  out,
  '<!doctype html><html><body style="margin:0;background:#0a0a0a">' +
    `<iframe sandbox="allow-scripts" style="display:block;width:300px;height:640px;border:0" srcdoc="${srcdoc}"></iframe>` +
    '</body></html>\n'
)
