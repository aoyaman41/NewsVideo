# Contributing

NewsVideo へのコントリビュートありがとうございます。このリポジトリは `main` を基準にした短命ブランチ運用を前提にしています。

## まず確認してほしいもの

- セットアップや使い方: [docs/クイックスタート.md](docs/クイックスタート.md)
- 対応環境と Public Beta の制約: [docs/対応環境と制約.md](docs/対応環境と制約.md)
- 現行実装の要点: [docs/現行実装ガイド.md](docs/現行実装ガイド.md)

GitHub Discussions は現在使っていません。質問、バグ報告、要望は GitHub Issues のテンプレートから起票してください。

## 開発環境

- `macOS`
- `Node.js ^20.19.0` または `>=22.12.0`

セットアップ:

```bash
npm install
npm run dev
```

提出前の確認:

```bash
npm run lint
npm run typecheck
npm test
```

## 開発フロー

1. `main` から最新を取得する
2. 1 Issue ごとに短命ブランチを切る
3. 変更範囲はその Issue に必要なものへ絞る
4. 実装変更がある場合は関連ドキュメントも同じ PR で更新する
5. `lint` / `typecheck` / `test` を通してから PR を作る
6. PR のマージはレビュー後にメンテナが行う

## Issue の使い分け

- `Bug report`: 再現する不具合
- `Feature request`: 新機能や改善要望
- `Usage question`: 使い方や初回セットアップの相談

不具合か質問か迷う場合は `Usage question` から始めてください。

## PR の書き方

- 変更内容を短くまとめる
- テスト内容を列挙する
- 関連 Issue を本文にリンクする
- UI や出力が変わる場合はスクリーンショットや補足を付ける

## サポート方針

- Public Beta のためサポートは `best effort` です
- 外部 API の仕様変更やクォータ制限の影響を受けます
- API 利用料は各プロバイダ契約に対して直接発生します
