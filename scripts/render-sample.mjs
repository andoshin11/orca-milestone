// Renders the panel with made-up workspaces and tasks, for the screenshots in the README.
//
//   node scripts/render-sample.mjs <out.html> [--hover | --next]
//
// The page wraps the panel in a sandboxed frame, with the design tokens of Orca's dark theme. --hover expands one other workspace, as a hover would.
// --next shows the focused workspace after its agent finished, with the next steps it offers as cards.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildModel } from '../src/model.mjs'
import { renderBody } from '../src/render.mjs'

const [out, flag] = process.argv.slice(2)
if (!out) {
  console.error('usage: node scripts/render-sample.mjs <out.html> [--hover | --next]')
  process.exit(1)
}
const next = flag === '--next'

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
    ['フィルターの UI を作る', next ? 'completed' : 'in_progress'],
    ['テストを書く', next ? 'completed' : 'pending'],
    ['PR を作る', next ? 'completed' : 'pending'],
    ['CI の成功を確かめる', next ? 'completed' : 'pending']
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
    ['ステージングで動作を確かめる', 'in_progress'],
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

// The cards the agent offers once it has finished, read from the next block of its last answer.
const offers = next
  ? [{
      kind: 'next',
      id: 'sample',
      path: '/work/search-filters',
      suggestions: [
        { label: 'E2E テストを足す', prompt: '価格と在庫の絞り込みについて、条件の組み合わせごとに一覧が変わることを確かめる E2E テストを足して、PR に push してください', reason: '単体テストだけで、画面での組み合わせを確かめていないため' },
        { label: 'ステージングで確かめる', prompt: 'PR をステージングに出し、在庫 0 の商品が絞り込みで消えることをブラウザで確かめてください', reason: 'CI は通ったが実データで見ていないため' },
        { label: 'README に使い方を書く', prompt: '絞り込みのクエリパラメータを README の API の節に追記してください', reason: '新しいパラメータがドキュメントにないため' }
      ]
    }]
  : []
const focusedState = next ? 'done' : 'working'

const model = buildModel(
  { path: '/work/search-filters', displayName: 'search-filters', agentStates: [focusedState] },
  sessions,
  [
    agent('search-filters', 'web-app', focusedState, 9),
    agent('login-redirect', 'auth-service', 'waiting', 4),
    agent('upgrade-node', 'web-app', 'working', 7),
    agent('csv-export', 'admin-console', 'done', 6),
    agent('flaky-tests', 'api-server', 'done', 5)
  ],
  offers
)

// Which row to open for --hover: the second one, a workspace with unfinished tasks.
const hover = flag === '--hover'
  ? '<style>.row.has-detail:nth-child(2) .detail{grid-template-rows:1fr;visibility:visible}' +
    '.row.has-detail:nth-child(2){background:color-mix(in oklch,#fafafa 7%,transparent)}</style>'
  : ''
const style = await readFile(join(import.meta.dirname, '..', 'panel', 'style.css'), 'utf8')
const panel =
  `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>:root{${ORCA_DARK_TOKENS}}</style>` +
  `<style>${style}</style>${hover}</head><body>${renderBody(model)}</body></html>`
const srcdoc = panel.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

await writeFile(
  out,
  '<!doctype html><html><body style="margin:0;background:#0a0a0a">' +
    `<iframe sandbox="allow-scripts" style="display:block;width:300px;height:${next ? 900 : 640}px;border:0" srcdoc="${srcdoc}"></iframe>` +
    '</body></html>\n'
)
