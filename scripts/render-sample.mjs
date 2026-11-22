// Renders the panel with made-up workspaces and tasks, for the screenshots in the README.
//
//   node scripts/render-sample.mjs <out.html> [--hover | --next | --remote [status.json]]
//
// The page wraps the panel in a sandboxed frame, with the design tokens of Orca's dark theme. --hover expands one other workspace, as a hover would.
// --next shows the focused workspace after its agent finished, with the next steps it offers as cards.
// --remote adds the sessions of another Mac below the others, made up or read from a saved status.json.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildModel } from '../src/model.mjs'
import { readSnapshot } from '../src/remote.mjs'
import { renderBody } from '../src/render.mjs'

const [out, flag, remoteFile] = process.argv.slice(2)
if (!out) {
  console.error('usage: node scripts/render-sample.mjs <out.html> [--hover | --next | --remote [status.json]]')
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

const json = (value) => JSON.stringify(value)
const SAMPLE_REMOTE = {
  v: '1',
  at: '0',
  sessions: [
    { id: 'r1', agent: 'claude', state: 'active', live: '1', attention: 'permission', workspace: 'rate-limit', goal: 'API にレート制限を入れる',
      tasks: json([['c', '今のトラフィックを調べる'], ['i', '負荷試験を流しています'], ['p', 'PR を作る']]), done: '1', total: '3',
      offer: 'o-r1', suggestions: json(['許可', '拒否']), details: json(['', '']), question: '［実行する］Bash を許可しますか？ npm run load-test' },
    { id: 'r2', agent: 'claude', state: 'finished', live: '1', attention: '', workspace: 'invoice-pdf', goal: '請求書を PDF で送れるようにする',
      tasks: json([['c', 'テンプレートを作る'], ['c', 'PDF 生成を組み込む'], ['c', 'PR を作る']]), done: '3', total: '3',
      offer: 'o-r2', suggestions: json(['PR をマージする']), details: json(['PR #212 をマージし、デプロイが成功するまで確かめてください']), reasons: json(['CI が成功しレビューも済んだため']) },
    { id: 'r3', agent: 'codex', state: 'active', live: '1', attention: '', workspace: 'dark-mode', goal: 'ダークモードの配色を整える',
      tasks: json([['c', '色のトークンを洗い出す'], ['i', 'コンポーネントに当てています'], ['p', 'スクリーンショットで確かめる']]), done: '1', total: '3' }
  ]
}
if (flag === '--remote') {
  const body = remoteFile ? JSON.parse(await readFile(remoteFile, 'utf8')) : SAMPLE_REMOTE
  model.remote = { label: 'Mac mini', ...readSnapshot(body) }
}

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
    `<iframe sandbox="allow-scripts" style="display:block;width:300px;height:${next || flag === '--remote' ? 900 : 640}px;border:0" srcdoc="${srcdoc}"></iframe>` +
    '</body></html>\n'
)
