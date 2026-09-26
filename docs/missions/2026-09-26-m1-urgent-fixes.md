# 指示書 M1: 緊急修正(Gemini 画像の GA 化・既定の画像モデル・動画書き出しの競合・自動生成の既定・旧プロジェクトの読み込み)

- 作成日: 2026-09-26
- ベース: `feature/ux-speed-export-models`(この指示書をコミットした時点)
- 上位の提案書: `docs/missions/2026-09-26-review-ux-speed-export-models.md`(調査結果の詳細は §1)
- 並行して進むミッション: M3(モデル最適化、`docs/missions/2026-09-26-m3-model-optimization.md`)。衝突を避けるため §0-5 の区画ルールを守ること
- 統合: メインループがユーザー同席でマージ → 実 API での確認 → PR

## 0. 共通ルール

1. **最初に worktree のベースを確認する。** Agent の worktree は origin/main から作られる。`git log --oneline -1` がこの指示書のコミットでなければ、未変更の状態のまま `git reset --hard feature/ux-speed-export-models` を実行し、そのあと `npm ci` を実行する
2. **コミット・push・デプロイはしない。** 納品物は「未コミットの worktree + 完了報告」
3. **指示書外の設計判断が必要になった場合、または解決できない問題に直面した場合は、勝手に進めず停止してメインループへ報告する。** 公式ドキュメントとこの指示書の記述が食い違う場合も同じ
4. **実 API を叩かない**(SDK はモックする)。API キーやシークレットを print・ログ出力しない。ユーザーデータ(`~/Library/Application Support/newsvideo`)は読み取りのみ可
5. **区画ルール**: M3 が同時に `electron/ipc/ai.ts`、`electron/ipc/tts.ts`、画像プロンプトの組み立て(`electron/ipc/image.ts` の prompt 系関数と quality / サイズの対応付け)、テキストモデルと TTS の定数を変更する。M1 はこれらに触れない。`shared/constants/models.ts` と `src/utils/cost.ts` は**画像モデルの区画だけ**を編集する
6. ロジック実装・レビュー・テストは Codex(codex プラグイン)に委譲してよい
7. 完了条件: `npm run typecheck` / `npm run lint` / `npm test` / `npm run audit:licenses` がすべて通ること
8. 完了報告に含めるもの: 変更ファイル一覧、主要な設計判断とその理由、テスト結果、未解決事項、統合時に実 API で確認すべき項目、worktree のパスとブランチ名、reset 後の HEAD

## 1. ユーザー決定事項(2026-09-26)

- 既定の画像モデルを **`gpt-image-2.5-sunburst`** にする
- 提供終了した Gemini の preview 版画像モデルは GA 版に置き換え、保存済みの旧 ID は自動で読み替える
- 自動生成の既定を **全自動(確認のために止めない)** にする。「確認しながら」モードは選択肢として残す

## 2. 実装範囲

### 2.1 Gemini 画像モデルの GA 化
- 公式: `gemini-3.1-flash-image-preview` と `gemini-3-pro-image-preview` は 2026-06-25 に提供終了。後継は `gemini-3.1-flash-image` / `gemini-3-pro-image`(https://ai.google.dev/gemini-api/docs/deprecations)
- `GEMINI_IMAGE_MODELS` を GA 版の ID に置き換え、ラベルも更新する
- **旧 ID の読み替え**を 1 か所の関数にまとめる(例: `normalizeImageModelId`)。次の読み込み経路すべてで適用する
  - 設定の正規化(`shared/settings/appSettings.ts`)
  - プロジェクトの `generationConfig` の読み込み(`shared/project/schema.ts` の検証の前段)
  - 画像生成時に受け取るモデル ID
- 過去の画像メタデータと usage に記録された旧 ID は**書き換えない**。コスト計算用に、旧 ID の料金行を残す(または読み替えて同じ料金を適用する)
- GA 版で API のパラメータ(画像サイズの指定 `imageSize` など)が preview 版から変わっていないかを公式ドキュメントで確認する。変わっていれば報告する(M3 が解像度の対応付けを変更するので、M1 は ID の置き換えにとどめる)

### 2.2 既定の画像モデル
- `DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst'`
- `src/utils/cost.ts` の `DEFAULT_GEMINI_IMAGE_RATES[DEFAULT_IMAGE_MODEL]` のように、既定値が Gemini であることを前提にしている箇所を洗い出して直す(既定値が OpenAI になると `undefined` になる)
- `src/utils/usage.ts` の、モデル未記録の古いレコード用の代替値は、既定値ではなく旧来のモデルに固定する(過去のコスト表示を変えないため。ミッション B の TTS と同じ扱い)
- 既存ユーザーが保存済みの `imageModel` は変えない

### 2.3 動画書き出しの競合の修正(最重要)
提案書 §1.2 と、再現テスト `/private/tmp/claude-501/-Users-aoyaman-Documents-Development-NewsVideo/5a2b9934-29e7-41b9-a255-4caf506f96d1/scratchpad/video/render-stall.repro.test.ts`(実行方法は同じフォルダの `vitest.config.mjs`)を最初に読むこと。
1. **判定の変更**: `electron/ipc/video.ts` の `video:render` は、待ち行列の順番が来た後に保存済みの最新プロジェクトを読み、それに対して書き出す。リビジョンの完全一致は求めず、**画面が意図した書き出し内容**(パート構成・素材・音声・出力設定など、書き出しに影響する入力の fingerprint)が最新と一致すれば続行し、内容が本当に違うときだけ分かりやすいエラーで拒否する。`video:preview` と、自動生成ジョブからの呼び出し(`electron/jobs/engine.ts` の動画工程)も同じ規則にする
2. **通知漏れの修正**: メインプロセスがプロジェクトを更新するときは `project:changed` を送る(少なくとも `video.ts` のプレビュー時の metrics 更新と、書き出し開始時の出力設定の保存)。同じ種類の漏れがほかの IPC にもないか、`getProjectRepository().update(` の呼び出しを洗い出して確認する
3. **画面側の再試行**: 競合エラーを受けたとき、画面側に未保存の変更がなければ再読込して 1 回だけ自動で再試行する
4. **ジョブ実行中の手動操作**: 自動生成ジョブの実行中は、動画画面の「書き出し」と「プレビュー」を無効にし、理由(「自動生成の実行中です」など)を表示する
5. 再現テストをリポジトリ内のテスト(例: `electron/ipc/video.test.ts`)に移植し、期待を「成功」に反転する。内容が本当に変わったときは拒否されるテストも加える

### 2.4 自動生成の既定を全自動に
- `src/pages/ArticleInputPage.tsx` の `generationMode` の既定値を `'automatic'` にする。「確認しながら」は選択肢として残す
- 予算を指定しているときに、料金未確定の記録があるたびに「予算確認」で止まる問題(`electron/jobs/engine.ts:233-241` 付近、再開でも件数が引き継がれる)は、全自動の既定と矛盾する。停止条件を「見込み額が予算を超えるとき」に絞れるかを調べ、できるなら直す。設計判断が必要なら停止して報告する

### 2.5 旧プロジェクト(v1.1)の読み込み
- スキーマ v1.1 の古いプロジェクトは、`prompts.json` の `stylePreset` に廃止済みの値 `news_broadcast` を持っているため、`ProjectRepository.decode` の `projectSchema.parse` で失敗し、`CORRUPT` として扱われる(origin/main でも同じ。手元に 6 件ある)
- 読み込み時に、廃止済みのプリセット値を現行の値に読み替える移行処理を入れる。`git log -p -- shared/project/imageStylePresets.ts` で、廃止された値と当時の意図を確認する。対応する現行の値が一意に決まらなければ停止して報告する
- v1.1 のフィクスチャを使ったテストを追加する

## 3. 非スコープ

- 画像のサイズ・品質の対応付けや画像プロンプトの変更(M3)
- ジョブの並列化、fps、進捗表示の細分化(M2)
- 画面構成の変更(M4a / M4b)

## 4. 統合時の確認項目(メインループ + ユーザー)

- 新規設定で既定の画像モデルが GPT Image 2.5 Sunburst になっていること
- Gemini 3.1 Flash Image(GA)で画像を 1 枚生成できること。旧 ID が保存された設定が自動で読み替わること
- 自動生成を全自動で最後まで実行し、そのあと動画画面で「プレビュー → 書き出し」を 2 回続けて成功すること
- 自動生成の実行中に、動画画面の書き出しとプレビューが無効になっていること
- 手元の v1.1 プロジェクト 6 件が開けること(読み込みのみ。確認後に保存するかはユーザーが判断する)

## 5. 進捗ログ

| 日付 | 内容 |
|---|---|
| 2026-09-26 | 指示書作成。Opus サブエージェントに worktree 分離で発注 |
| 2026-09-26 | 実装完了(未コミット)。Gemini 画像の GA 化と旧 ID の読み替え、既定の画像モデル、書き出し・プレビューの判定を書き出し内容の指紋に変更(`shared/project/renderIntent.ts`)、通知漏れの修正、画面側の 1 回だけの再試行、ジョブ実行中の書き出し・プレビューの無効化、全自動の既定と予算停止条件の変更、v1.1 の旧プリセットの読み替え。Codex のレビュー指摘(再試行時の表示設定の上書き、ジョブの動画指紋の上書き、保存直前の再照合など)を反映。typecheck / lint / test / audit:licenses 通過。統合待ち |
