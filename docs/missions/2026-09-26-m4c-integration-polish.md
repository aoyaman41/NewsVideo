# 指示書 M4-C: 統合後の調整(エラー表示の統一・残った不整合の解消)

- 作成日: 2026-09-26
- ベース: `feature/ux-speed-export-models` の 13f74f4(M1・M2・M3・M4-A・M4-B を統合済み)
- 関連: `docs/missions/2026-09-26-m4-ux.md`(M4 の共通ルール §0 はそのまま適用する)、`docs/missions/2026-09-26-m2-speed.md`
- 統合: メインループがユーザー同席でマージ → 操作して確認 → PR

## 0. 共通ルール

1. **最初に worktree のベースを確認する。** `git log --oneline -1` がこの指示書のコミットでなければ、未変更の状態のまま `git reset --hard feature/ux-speed-export-models` を実行し、そのあと `npm ci` を実行する
2. **コミット・push・デプロイはしない。** 納品物は「未コミットの worktree + 完了報告」
3. **指示書外の設計判断が必要になった場合、または解決できない問題に直面した場合は、勝手に進めず停止してメインループへ報告する**
4. 実 API を叩かない。シークレットを出力しない。ユーザーデータは読み取りのみ。アプリを `npm run dev` で起動しない(メインループが起動中)。スクリーンショットの撮影スクリプトも実行しない
5. M4 の指示書 §0 の規則(tokens.css 基準、保存データのスキーマを消さない、用語の統一)を守る
6. 実装・レビュー・テストは Codex(codex プラグイン)に委譲してよい
7. 完了条件: `npm run typecheck` / `npm run lint` / `npm test` / `npm run audit:licenses` がすべて通ること
8. 完了報告に含めるもの: 変更ファイル一覧、項目ごとの対応内容、主要な設計判断、テスト結果、未解決事項、統合時に操作して確認すべき項目、worktree のパスとブランチ名、reset 後の HEAD

## 1. 対応項目

1. **エラー表示の統一**
   - エラーの説明処理が 2 つある。M4-A の `src/components/errors/`(`explainError`、`FriendlyError`)と、M4-B の `src/components/common/friendlyError.ts`(`ErrorNotice`)。1 つにまとめ、全画面で同じ部品を使う
   - 作業画面(台本・画像・音声・動画)に、`ErrorDetailPanel` で生の文字列を出している箇所が残っていれば置き換える
   - 対象に加えるエラー:
     - M2 のウォッチドッグの中断(「…90秒以上進まなかったため中断しました…」)
     - M1 の書き出しの競合(`[RENDER_CONFLICT]`)
     - Claude の拒否
2. **動画画面の進捗の取り違え**: M2 で `progress:update` に `projectId`・`origin`(`'job' | 'manual'`)・`kind`(`'preview' | 'render'`)が付いた。今の動画画面は、別プロジェクトのジョブの書き出し進捗も表示してしまう。開いているプロジェクトのものだけを表示する
3. **効かなくなった設定の削除**: M2 で同時実行数が用途別の固定値(テキスト 4 / 画像 3 / 音声 4)になり、設定 `generationConcurrency` は使われなくなった。設定画面の「同時に処理する数」を外す(保存値の項目は残す)
4. **用語の不一致**
   - 台本画面の見出し「シーンと台本」を「台本」にする(工程ナビに合わせる)
   - `src/utils/projectHealth.ts` の「スクリプト」表記を直す(まだ使われていれば)
   - M2 で段階名が「画像と音声」になったので、進捗表示の文言が自然か確認する
5. **M4-A の区画に残った見た目の不統一**: gray の色(`src/components/article/ImageDropzone.tsx` など)、色指定のない枠線、素の `<details>` とチェックボックス(8 か所程度)を、M4-B が用意した `Details`・`Checkbox`・`.nv-details`・`.nv-table` などで置き換える
6. **進め方と予算の既定値の保存先**
   - M4-A は、`settings.json` のスキーマ(当時は M2 の区画)を避けて localStorage に保存した(`src/stores/generationPreferences.ts`)
   - AppSettings(`shared/settings/appSettings.ts`)に移し、設定の正規化とテストを追加する
   - localStorage に値があれば 1 回だけ AppSettings に移す
7. **残骸の片付け**
   - `vite.config.ts` の mammoth のチャンク設定を削除する
   - `package.json` の `overrides.underscore` が、mammoth の削除で不要になったかを確認する(依存ツリーに underscore が残っているか)。不要なら削除し、lockfile を更新する
8. **手順書の最終確認**
   - M4-B の画面の文言(「画像を作る」「N 枚目を作り直す」「指示を足して作り直す」「足りない画像を作る」「足りない音声を作る」「字幕を入れる」「締めの画面」「ひとこと」「動画を書き出す」「シーン N をプレビュー」)に合わせて、`docs/リリース前スモークテスト.md`(82 行目付近)と `docs/クイックスタート.md`(79・93・94 行目付近)を更新する
   - `docs/現行実装ガイド.md` に M2 の要点(並列化、用途別の同時実行数、30fps・1 回のエンコード、進捗、ウォッチドッグ)を反映する
   - 手順書全体で、既定のモデル(Claude Opus 5.5 / GPT Image 2.5 Sunburst / Gemini 3.8 Flash TTS)と「思考の深さ」の既定(medium)の記述が正しいか確認する
9. **スクリーンショットの撮影スクリプト**: `scripts/generate-public-beta-assets.mjs` の撮影対象に、ようこそ画面(`/welcome`)と進捗表示を加える。実行はしない(撮影は統合時にメインループが行う)

## 2. 非スコープ

- 新しい機能の追加、生成モデルやプロンプトの変更、ジョブエンジンの挙動の変更

## 3. 進捗ログ

| 日付 | 内容 |
|---|---|
| 2026-09-26 | 指示書作成。Opus サブエージェントに worktree 分離で発注 |
| 2026-09-26 | M4-C 完了(worktree `agent-a31961a580df7440b`、424330f に reset、44 ファイル +1500/−971)。メインループで typecheck / lint / test(485 件)/ audit:licenses を確認し、統合した。範囲を少し超えた判断: Main の `settings:get` / `settings:set` を 1 件ずつ順に処理するようにした(記事画面と設定画面の保存が重なって変更が消えるのを防ぐため。テストあり)→ メインループが妥当と判断。撮影スクリプトに `welcome.png` と `job-progress.png` を追加したが、撮影は未実施(README の画像表への追加は撮影後) |
