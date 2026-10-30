# orca-milestone

[Orca](https://github.com/stablyai/orca) の plugin です。現在は雛形で、動作確認用のコマンドを 1 つだけ持っています。

> [!WARNING]
> Orca の plugin 機能は experimental です（pluginApi v1、互換性の保証なし）。この plugin は Orca 1.4.223 以上を対象にしています。

## できること

- コマンド **「Milestone: Hello」** を実行すると、plugin のログに `milestone: hello` を出します。

## 必要なもの

- Orca 1.4.223 以上
- Settings → Plugins で plugin 機能を有効にしていること（既定では無効）

## インストール

Orca の **Settings → Plugins** で、Git URL を指定してインストールします。

1. plugin 機能のトグルを ON にします。
2. **プラグインをインストール** を押し、**Git URL** を選んで次の URL を入力します。

   ```text
   https://github.com/andoshin11/orca-milestone#v0.1.0
   ```

   `#` の後ろは使うバージョンのタグです。[Tags](https://github.com/andoshin11/orca-milestone/tags) から選んでください。
3. 一覧の「Milestone」で **Review** を押し、承認します（要求する権限はありません）。

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

CI では `engines.orca` と同じ Orca のタグ（v1.4.223）を取得して、manifest を検証します。

## ライセンス

[MIT](LICENSE)
