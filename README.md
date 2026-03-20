# NewsVideo

NewsVideo は、ニュース記事からナレーション付き動画を作るための macOS 向けデスクトップアプリです。1つのプロジェクトの中で、記事入力、台本生成、画像生成、音声生成、動画書き出しまでを順番に進められます。

現在は `Public Beta` としての公開を前提に整備中です。サポートは `best effort`、API 利用料はユーザー自身の契約に紐づきます。

## できること

- 記事テキストから複数パートの台本を生成する
- パートごとに画像プロンプトを作り、画像生成まで進める
- ナレーション音声を生成する
- 動画プレビューを確認し、最終動画を書き出す
- プロジェクト単位で途中経過を保存し、あとから再開する
- 進捗と概算コストを画面上で確認する

## 想定ユーザー

- ニュース解説動画を短時間で組み立てたい個人制作者
- 記事ベースの動画試作を高速に回したい編集者や小規模チーム
- SaaS に素材を預けるより、ローカルアプリで制作フローを持ちたい人

## ワークフロー

1. プロジェクトを作成する
2. 記事を貼り付ける、または `.txt` / `.md` / `.docx` を読み込む
3. 台本を生成する
4. 画像プロンプトと画像を生成する
5. 音声を生成する
6. 動画をプレビューして書き出す

記事入力画面からは「記事から動画まで自動生成」を実行できます。段階ごとに調整したい場合は、`記事 -> スクリプト -> 画像 -> 音声 -> 動画` の各画面を個別に進められます。

## 使い始める

### 配布版を使う

- 最新版は [GitHub Releases](https://github.com/aoyaman41/NewsVideo/releases/latest) から取得できます
- 現時点の公開配布は macOS 前提です

### 初回設定

1. アプリを起動して `設定` を開く
2. 既定設定のまま使う場合は `OpenAI` と `Google AI` の両方の API キーを登録する
3. 1つのキーで始めたい場合は、文章生成モデルを両方とも `Gemini 3.1 Pro` に切り替えたうえで `Google AI` キーのみ登録する
4. 必要に応じて動画解像度、画像解像度、音声設定を調整する

補足:

- 既定の文章生成モデルは `GPT-5.2`、画像生成と既定の音声生成は Google 側の API を使います
- API 利用料は NewsVideo ではなく、各プロバイダの契約に対して直接発生します

### 最初の1本を作る

1. `プロジェクト` 画面で新規プロジェクトを作成する
2. 記事タイトル、出典、本文を入力する
3. サンプルで試す場合は [docs/サンプル記事.md](docs/サンプル記事.md) をそのまま使う
4. 自動生成を使うか、Workflow に沿って各ステップを進める
5. 動画画面でプレビューと書き出しを行う

## 開発者向けセットアップ

必要環境:

- Node.js `^20.19.0` または `>=22.12.0`
- macOS

起動:

```bash
npm install
npm run dev
```

ビルド:

```bash
npm run build
```

確認用コマンド:

```bash
npm run lint
npm run typecheck
npm test
```

## プレビューとサンプル

- 最新の配布物: [GitHub Releases](https://github.com/aoyaman41/NewsVideo/releases/latest)
- 検証用の入力例: [docs/サンプル記事.md](docs/サンプル記事.md)
- README に載せるスクリーンショットとデモ素材の整備: [Issue #5](https://github.com/aoyaman41/NewsVideo/issues/5)

## 対応環境と制約

- 現時点では macOS 前提で検証と配布を進めています
- AI 生成機能を使うにはインターネット接続とユーザー自身の API キーが必要です
- 画像スタイルは現在 `infographic` 固定です
- Public Beta のため、設定項目や出力挙動は今後変更される可能性があります

## データ取り扱いの概要

- プロジェクトデータはローカルのアプリ用ディレクトリに保存されます
- API キーは Electron の `safeStorage` を使ってローカル暗号化保存します
- 記事本文、生成プロンプト、音声生成用テキストは、生成時に選択した外部 API に送信されます

詳細な公開向け整理は [Issue #10](https://github.com/aoyaman41/NewsVideo/issues/10) で進めています。

## ドキュメントとサポート

- 現行実装ガイド: [docs/現行実装ガイド.md](docs/現行実装ガイド.md)
- バグ報告 / 要望: [GitHub Issues](https://github.com/aoyaman41/NewsVideo/issues)
- 公開向けクイックスタート整備: [Issue #4](https://github.com/aoyaman41/NewsVideo/issues/4)

## License

現時点のライセンス表記は [package.json](package.json) にある `ISC` です。正式な `LICENSE` ファイルの追加は [Issue #3](https://github.com/aoyaman41/NewsVideo/issues/3) で進めています。
