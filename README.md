# orca-milestone

[Orca](https://github.com/stablyai/orca) の plugin です。フォーカス中のワークスペースで Claude Code が進めているタスクを、ゴールまでのマイルストーンとして右サイドバーに表示します。タスクが進むと、すぐに表示が変わります。

> [!WARNING]
> Orca の plugin 機能は Alpha です。この plugin は Orca 1.4.248 以上を対象にしています。

<p>
  <img src="docs/images/panel.png" width="300" alt="Milestones パネル。上部にフォーカス中のワークスペースのゴールとタスク、下端にほかのワークスペースの進捗が並ぶ">
  <img src="docs/images/panel-hover.png" width="300" alt="ほかのワークスペースの行にマウスを乗せると、そのワークスペースのゴールとタスクが重なって表示される">
</p>

左が通常の表示、右がほかのワークスペースの行にマウスを乗せたときです（ワークスペース名やタスクはすべてダミーデータです）。

## できること

- 右サイドバーの旗アイコン（**Milestones**）に、フォーカス中のワークスペースの Claude セッションごとに次を表示します（新しい順に最大 3 件）。
  - 今のゴール。次の順で決めます。
    1. Claude がタスクに書いたゴール（`metadata.goal`）。いちばん新しいタスクのものを使い、ほかのゴールのタスクは表示しません。
    2. 一覧の最初のタスクを作る直前に送った依頼文
    3. セッションの最初の依頼文
  - 完了したタスク数と進捗バー
  - タスクの一覧（✓ 完了・● 進行中・○ 未着手）
- ワークスペースを切り替えると、表示もそのワークスペースのものに変わります。
- Orca のステータスバーに、フォーカス中のワークスペースのいちばん新しいタスク一覧の進捗を出します（例: `2/5 PR を作る`）。パネルを閉じていても進み具合が見えます。
  - 完了すると緑のチェックと「完了」に、Claude が入力や許可を待っている間は警告の色になります。マウスを乗せるとゴールが出ます。タスク一覧がなければ隠れます。
  - Orca の起動直後やワーカーが止まっている間は、次にイベントが届くかパネルを開くまで旗アイコンだけ、または最後の表示のままです。
- パネルの下端に「ほかのワークスペース」として、Orca で動いているほかの Claude を並べます（最大 8 件）。
  - 要確認（入力待ち・許可待ち）のものを先頭に、オレンジの「要確認」を付けて出します。次に、タスクが残っているもの、すべて完了したものの順に、それぞれタスクが新しく動いた順で出します。
  - 各行は、印（要確認と、実行中のタスクがあるものはオレンジの点、タスクがすべて完了したものは緑のチェック、ほかはグレーの点）、ワークスペース名（横に小さくプロジェクト名）、Claude が動いているときの「作業中」と、いちばん新しいタスク一覧の進捗バー・完了数です。「作業中」はターンごとに変わるので、行の並びや表示する行には影響しません。行にマウスを乗せると、ワークスペース名・ゴール・タスクの一覧が行の上に重なって出ます。
  - 行をクリックしてそのワークスペースへ移ることはできません（パネルから Orca を操作する API がないため）。
- タスク一覧は、その Claude セッションが動いている間だけ表示します。セッションを終了したり、ワークスペースを削除したりすると消えます。動いているセッションは、Claude が `~/.claude/sessions/<pid>.json` に書く情報で判断します。
- Claude はすべてのタスクを完了するとタスク一覧のファイルを消しますが、この plugin はセッションが動いている間、完了した状態のまま表示を残します。plugin を再起動した後も、transcript に残る TaskCreate / TaskUpdate の記録から組み立て直します。
- 対象は Claude Code だけです。Orca の Agent Teams で起動した Claude（`claude --teammate-mode`）にも対応しています。

## 必要なもの

- Orca 1.4.248 以上（macOS のデスクトップアプリで確認）
- Claude Code がタスクを作ること。Opus 4.7・Sonnet 4.6 より新しいモデルでは、Claude Code はタスク用のツールを既定で使いません。`~/.claude/settings.json` に次を加えると、新しく起動するセッションから使います。

  ```json
  { "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
  ```

## インストール

1. clone します。

   ```sh
   git clone https://github.com/andoshin11/orca-milestone.git
   ```

2. Orca の **Settings → Plugins → ⋯ → Development folders…** で、clone したフォルダーを追加します。
3. 一覧の「Milestone」で **確認** を押し、有効にします。Node のワーカーを動かすため、フルアクセスの plugin として承認を求められます。host API で使う権限は、ワークスペースの名前・ブランチの読み取りと Agent ステータスの通知です。
4. 右サイドバーの旗アイコンを開きます。パネルを開くとワーカーが起動します。

## Claude にゴールを書かせる

同じセッションでゴールが変わっても見出しが追従するよう、`~/.claude/CLAUDE.md` などで、タスクにゴールを付けるよう Claude に指示しておくのがおすすめです。

```markdown
- 作業を始めるときは TaskCreate で手順をタスクにし、どのタスクにも `metadata: {"goal": "<今の依頼で目指していることを 1 行で>"}` を付ける。
- ゴールが変わったら、前のゴールの未完了タスクを completed か deleted にしてから、新しいゴールを付けたタスクを作る。
```

## 表示されないとき

- パネルに「このワークスペースの Claude はまだタスクを作っていません」と出る場合、Claude がタスクを作っていません。タスクを作るかどうかは Claude が作業の大きさで決めるため、短い作業では作らないこともあります。進捗を出したいときは「タスクに分けて進めて」と頼むと作ります。
- 設定を加える前から動いている Claude セッションでは、タスク用のツールが使えないことがあります。新しく起動し直してください。

## 仕組み

```mermaid
flowchart LR
  claude["Claude Code"] -- "タスクを書き込む" --> tasks["~/.claude/tasks/&lt;session-id&gt;/*.json<br/>（Agent Teams では session-&lt;先頭8桁&gt;）"]
  claude -- "会話を記録" --> transcript["~/.claude/projects/*/&lt;session-id&gt;.jsonl<br/>（cwd・依頼文）"]
  worker["ワーカー（main.mjs）"] -- "fs.watch" --> tasks
  worker -- "先頭だけ読む" --> transcript
  orca["Orca"] -- "workspace.changed<br/>agent.status.changed" --> worker
  worker -- "orca worktree ps（イベントのあと・30 秒ごと）" --> orca
  panel["パネル（panel/）"] -- "view.get（開いたとき）" --> worker
  worker -- "view.changed（変わったとき）" --> panel
  worker -- "statusBar.update（変わったとき）" --> orca
```

- パネルの HTML・CSS・スクリプトは `panel/` に置いた固定のファイルです。表示する本文はワーカーが作り、パネルは Orca の通信路（`orca.plugin.request` / `orca.plugin.on`）で受け取ります。
- パネルは受け取った本文との差分だけを DOM に反映します。更新してもパネルは作り直されないので、ちらつかず、スクロール位置やマウスを乗せた行の詳細も保たれます。
- タスクが完了すると、進捗バーが伸び、色が変わり、取り消し線が左から右へ引かれます。ワークスペースやゴールが変わったときは、別の一覧として動きなしで切り替えます。OS の視差効果を減らす設定では動きません。
- ワーカーは内容が変わったときだけ本文を送ります。パネルを開いたとき（サイドバーのタブを切り替えて戻ったときを含む）は、その時点の本文を取りに行きます。
- Agent Teams を率いる Claude は、タスク一覧をチーム名（`session-<セッション ID の先頭 8 桁>`）のフォルダーに書きます。どのセッションのものかは、`~/.claude/teams/<チーム名>/config.json` のリーダーのセッション ID か、なければ先頭 8 桁が一致する transcript で決めます。
- フォーカス中のワークスペースのパスは、`workspace.readContext` が返さないため、Orca に同梱の CLI（`orca worktree ps`）で調べます。セッションは、transcript に記録された作業ディレクトリがそのパスの中にあるものを表示します。
- フォーカスの移動は `workspace.changed`、どのワークスペースの Agent の変化も `agent.status.changed` で知り、そのときだけ `orca worktree ps` で取り直します（1 回 0.1〜0.2 秒）。イベントで分からない変化（イベントなしに終わったセッションなど）のために、30 秒ごとにも取り直します。
- Orca は 5 分間やりとりのないワーカーを止めるため、パネルは開いている間、1 分ごとに本文を取りに行きます。パネルを閉じているとワーカーは止まることがあり、次にパネルを開いたときかイベントが届いたときに起動します。

## 開発

```sh
npm ci
npm test

# Orca 本体の parser で orca-plugin.json を検証する（stablyai/orca の checkout が必要）
ORCA_SOURCE_DIR=/path/to/orca npm run check:manifest
```

README のスクリーンショットは、ダミーデータでパネルを描いたページから撮っています。

```sh
node scripts/render-sample.mjs /tmp/sample.html          # 通常の表示
node scripts/render-sample.mjs /tmp/sample-hover.html --hover   # 行にマウスを乗せたとき
```

ワーカーのコードを変えたら、Settings → Plugins で Milestone をいったんオフにしてからオンに戻すと、新しいコードで起動します。CI では `engines.orca` に対応する Orca のソースを取得して、manifest を検証します。

## ライセンス

[MIT](LICENSE)
