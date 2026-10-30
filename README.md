# orca-milestone

[Orca](https://github.com/stablyai/orca) の plugin です。現在は雛形で、動作確認用のコマンドを 1 つだけ持っています。

> [!WARNING]
> Orca の plugin 機能は Alpha です。この plugin は manifest format 2（`execution: trusted-worker`）で書いており、Orca 1.4.245 以上を対象にしています。

## できること

- コマンド **「Milestone: Hello」** を実行すると、plugin のログに `milestone: hello` を出します。

## 必要なもの

- Orca 1.4.245 以上（plugin 機能は既定で有効です）

## インストール

Orca の **Settings → Plugins** で、Git URL を指定してインストールします。

1. **プラグインをインストール** を押し、**Git URL** を選んで次の URL を入力します。

   ```text
   https://github.com/andoshin11/orca-milestone#v0.1.0
   ```

   `#` の後ろは使うバージョンのタグです。[Tags](https://github.com/andoshin11/orca-milestone/tags) から選んでください。
2. 一覧の「Milestone」で **Review** を押し、承認します。Node のワーカーを動かすため、コードを実行する plugin として承認を求められます（host API の権限は要求しません）。

Orca はリポジトリの中身をそのままコピーし、ビルドや `npm install` は行いません。この plugin には実行時の依存パッケージがありません（`devDependencies` は manifest の検証用です）。

### 開発中のコードを試す

clone したフォルダを **ローカルフォルダー** として読み込むと、手元の変更をそのまま試せます。

## 開発

```sh
npm ci --ignore-scripts
npm test

# Orca 本体の parser で orca-plugin.json を検証する（stablyai/orca の checkout が必要）
ORCA_SOURCE_DIR=/path/to/orca npm run check:manifest
```

CI では `engines.orca` と同じ Orca のタグ（v1.4.245）を取得して、manifest を検証します。

## ライセンス

[MIT](LICENSE)
