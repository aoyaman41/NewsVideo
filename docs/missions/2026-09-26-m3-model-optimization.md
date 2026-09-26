# 指示書 M3: 最新モデルへの最適化(設定の既定値・プロンプト・画質・TTS・キャッシュ・原価計上)

- 作成日: 2026-09-26
- ベース: `feature/ux-speed-export-models`(この指示書をコミットした時点)
- 上位の提案書: `docs/missions/2026-09-26-review-ux-speed-export-models.md`(§1.5)
- 並行して進むミッション: M1(緊急修正、`docs/missions/2026-09-26-m1-urgent-fixes.md`)。衝突を避けるため §0-5 の区画ルールを守ること
- 統合: メインループがユーザー同席でマージ → 実 API での生成・品質比較 → PR

## 0. 共通ルール

1. **最初に worktree のベースを確認する。** `git log --oneline -1` がこの指示書のコミットでなければ、未変更の状態のまま `git reset --hard feature/ux-speed-export-models` を実行し、そのあと `npm ci` を実行する
2. **コミット・push・デプロイはしない。** 納品物は「未コミットの worktree + 完了報告」
3. **指示書外の設計判断が必要になった場合、または解決できない問題に直面した場合は、勝手に進めず停止してメインループへ報告する。** 公式ドキュメントとこの指示書の記述が食い違う場合も同じ
4. **実 API を叩かない**(SDK はモックする)。API キーやシークレットを print・ログ出力しない。ユーザーデータ(`~/Library/Application Support/newsvideo`)は読み取りのみ可
5. **区画ルール**: M1 が同時に、Gemini 画像モデルの ID(`GEMINI_IMAGE_MODELS`)、`DEFAULT_IMAGE_MODEL`、画像モデル ID の読み替え、`electron/ipc/video.ts`、`electron/jobs/engine.ts`、`src/pages/VideoManagePage.tsx`、`src/pages/ArticleInputPage.tsx`、`electron/project/repository.ts` を変更する。M3 はこれらに触れない。`shared/constants/models.ts` と `src/utils/cost.ts` の**画像モデル ID と画像の料金行**も M1 の区画
6. ロジック実装・レビュー・テストは Codex(codex プラグイン)に委譲してよい。Claude 部分は、Skill ツールで `claude-api` スキルが使えるなら読み込んで従う
7. 完了条件: `npm run typecheck` / `npm run lint` / `npm test` / `npm run audit:licenses` がすべて通ること
8. 完了報告に含めるもの: 変更ファイル一覧、主要な設計判断とその理由、**プロンプトの変更前後の差分の要約**、テスト結果、未解決事項、統合時に実 API で確認すべき項目、worktree のパスとブランチ名、reset 後の HEAD

## 1. ユーザー決定事項(2026-09-26)

- 既定のテキストモデル(台本・画像プロンプト)を **`claude-opus-5-5`** にする
- 解像度 FHD のときの画質を上げる(コスト増を許容)
- Opus 5.5 の拒否時は、引き続きエラー表示のみ(`fallbacks` は使わない)

メインループ判断:
- Claude の effort は用途別の 2 つの設定に分ける。既定値は**台本・画像プロンプトとも `medium`**(当初は画像プロンプトを `low` としていたが、2026-09-26 にユーザーが medium に変更)。統合時に 2〜3 記事で品質を確認する
- 旧モデルは選択肢から外すが、保存済みの設定値は引き続き読めるようにする
- 3.8 TTS では、台本中の半角の `<` `>` を全角の `＜` `＞` に変換する(タグとして誤解釈されるのを防ぐ)

## 2. 実装範囲

### 2.1 テキスト生成の設定
- 既定のテキストモデル: `DEFAULT_SCRIPT_TEXT_MODEL` と `DEFAULT_IMAGE_PROMPT_TEXT_MODEL` を `claude-opus-5-5` にする。既存ユーザーが保存済みの値は変えない
- Claude の effort を用途別にする。例: 既存の `claudeEffort` を台本用とし、画像プロンプト用に `claudeImagePromptEffort` を新設する(名前は既存の命名に合わせてよい)。既定値は台本・画像プロンプトとも `medium`。設定の正規化・プロジェクトの `generationConfig`・変更検知(integrity)・設定画面の選択欄を対応させる。設定画面で台本用と画像プロンプト用の 2 つの選択欄が同じ値を書き換える問題(SettingsPage の Claude 部分)を解消する
- OpenAI と Gemini も同じく 2 つの選択欄が 1 つの値を共有しているが、M4b で設定画面を「品質プリセット」に作り直すので、M3 では Claude だけを直す
- Gemini 3.1 Pro に送っている `temperature`(`electron/ipc/ai.ts` の 761 / 1885 / 2234 行付近と `generateGeminiTextContent`)を送らないようにする。公式は既定値 1.0 のままを強く推奨している(https://ai.google.dev/gemini-api/docs/gemini-3)
- OpenAI の推論強度で、どのモデルも対応していない `minimal` を選択肢から外す(保存済みの値は正規化で対応する)

### 2.2 構造化出力と JSON 指示の整理
- 画像プロンプトの抽出(`ai.ts` の 1723-1777 行付近の system、1839 / 1870 / 1880 行付近の呼び出し)を、3 社とも構造化出力にする。Claude は `output_config.format`、OpenAI は `response_format`(zod)、Gemini は `responseJsonSchema`
- 構造化出力にした経路では、プロンプト内の JSON の例と「JSON のみを出力」の指示を削除し、各項目の意味はスキーマの説明に移す
- 抽出結果のうち、画像プロンプトの組み立てで使われていない項目(調査では topic / entities / locations / quantFacts がフォールバック経路でのみ使用)は、フォールバックへの影響を確認したうえで出力から外す。影響が読み切れなければ残して報告する
- 台本生成(620-650 行付近)とコメント反映(2105-2141 行付近)も同様に、Gemini にスキーマを付けたうえで重複した JSON 指示を削除する。役割の宣言が system と user で重複している箇所は user 側を消す
- 台本生成のプロンプトに「この文章は音声合成でそのまま読み上げる」という文脈を 1 文加え、括弧・記号・英略語を避けさせる

### 2.3 画像内の文字と画質
- 画像に描く文字のルールが 3 か所(`electron/ipc/image.ts` の 118-129 / 256-269 行付近、`ai.ts` の 1551-1555 行付近)に分かれ、用語もずれている(「画面テキスト」と「画面コピー」)。1 か所に統合する。形は公式の推奨どおり、描く文字列を「」で囲んで列挙し、「この文字列以外は描かない」を 1 回だけ書く(https://developers.openai.com/api/docs/guides/image-prompting 、 https://deepmind.google/models/gemini-image/prompt-guide/)
- 抽出の layoutPlan の説明に「画面に出す文字は visualCopy のみ。objects.content は描き方の説明で、新しい文字列は入れない」を明記する
- styleNotes はプリセットの配色と衝突するので、削除するか配色以外の内容に限定する
- `shared/project/imageStylePresets.ts` の禁止語の列挙(infographic は 33 語)を、公式の推奨どおり肯定形の記述に寄せて絞る。禁止として残すのは、人物・顔、ロゴ・透かし・QR、指定外の文字程度にする
- 解像度と品質の対応付け(`image.ts` の `getImageSize` と `getOpenAiImageQuality`):
  - Gemini: fhd を 1K → **2K** に変更する
  - GPT Image: fhd を `low` → **`medium`** に変更する(2k は `medium`、4k は `high` のまま)
- Gemini 画像のメタデータに記録する幅・高さを、要求値ではなく実際の画像の寸法にする(調査では 3840x2160 と記録されたが、実寸は 5504x3072)

### 2.4 Gemini 3.8 TTS
- 3.8 用に、プリセットごとの短いスタイル記述子を別に定義する(例: news は `calm, clear news narration`)。公式は短い記述子を推奨し、長い指示は声のぶれの原因になるとしている(https://ai.google.dev/gemini-api/docs/speech-generation)。3.1 / 2.5 は、現行の日本語の命令文を本文の前に付ける方式のままにする
- 自由記述の補足(`narrationStyleNote`)は、3.8 では短く切り詰めるか、style の末尾に付けるかを決める。判断に迷えば報告する
- 3.8 のときは、台本中の半角の `<` `>` を全角に変換してから送る
- 旧 TTS モデル(`gemini-3.1-flash-tts-preview`、`gemini-2.5-pro-preview-tts`、`gemini-2.5-flash-preview-tts`)を選択肢から外す(保存済みの値は読める)。公式の後継は 3.8 Flash / Flash-Lite
- Gemini TTS で効いていない設定(話速など)が画面に表示されているなら、その扱いを報告する(変更は M4b)

### 2.5 モデルの選択肢の整理
- 選択肢から外すモデル: テキストの `gpt-5.2` / `gpt-5.4` / `gpt-5.5`、画像の `gpt-image-2`、TTS の §2.4 の 3 モデル
- 実装方針: `shared/constants/models.ts` に「選択可能な一覧」を別に持ち、設定画面の選択肢はそれを使う。検証(`is*Model`)・正規化・料金表・既存データの読み込みは、外したモデルも有効なまま残す

### 2.6 プロンプトキャッシュ
- 自動生成ジョブの経路(`ai:generateImagePromptForTarget`、2056-2060 行付近)で Claude のキャッシュ指定が一度も付かないのが、キャッシュが効かない原因。全経路で付ける
- 共通部分の大半は記事本文なので、記事本文を user の最初のブロックに置いて `cache_control` を付け、パートごとの情報は 2 番目のブロックに回す。記事は ID 付きのタグで囲み、ID はプロジェクト単位で固定する(リクエストごとに変えるとキャッシュが壊れる)
- 1967 行付近の「パートが 2 件以上のときだけ付ける」条件をやめる
- 一括生成で最大 10 並列で同時に送ると、最初の応答が始まる前のリクエストはキャッシュを読めない。1 本目の応答が始まってから残りを送る。ジョブ側の並列化は M2 で行うので、M3 ではこの方針をコードコメントに残すだけでよい
- OpenAI: 記事を別の content part にしてキャッシュのブレークポイントを置けるかを、インストール済みの SDK の型で確認する。対応できるなら実装し、できなければ報告する

### 2.7 原価計上の漏れ
- Gemini の `thoughtsTokenCount` を出力トークンとして計上する(`ai.ts` の `mapGeminiUsage`、131-161 行付近)
- OpenAI のキャッシュ書き込みの割増が `src/utils/cost.ts`(500-509 行付近)で計上されていないので、公式の料金に合わせて計上する(テキストの区画のみ。画像の料金行は M1 の区画)

## 3. 非スコープ

- Gemini 画像モデルの ID の置き換えと既定の画像モデル(M1)
- ジョブの並列化(M2)
- 設定画面の品質プリセット化・画面構成の変更(M4b)
- 新しいモデル(GPT-6 Sol、Gemini 3.8 Flash のテキストなど)の追加

## 4. 統合時の確認項目(メインループ + ユーザー)

- 2〜3 本の記事で、Claude の effort の既定値(台本・画像プロンプトとも medium)と以前の high を比べ、台本と画像プロンプトの品質を確認する
- 画像に指定外の文字が描かれていないこと。FHD で文字が読めること
- 3.8 TTS の短いスタイルで、ニュース調の読み上げになっていること。`<` `>` を含む台本で試す
- 画像プロンプトの一括生成と自動生成の両方で、2 回目以降の `cache_read_input_tokens` が 0 より大きいこと
- Gemini 3.1 Pro を選んだときも台本と画像プロンプトが生成できること

## 5. 進捗ログ

| 日付 | 内容 |
|---|---|
| 2026-09-26 | 指示書作成。Opus サブエージェントに worktree 分離で発注 |
| 2026-09-26 | 発注後にユーザーが変更: 画像プロンプトの effort の既定も medium(担当に伝達済み) |
| 2026-09-26 | M3 完了(worktree `agent-ae774aaa921f2d15c`、e65fa1d に reset して作業、未コミット、21 ファイル +1391/−1221)。メインループで typecheck / lint / test(296 件)/ audit:licenses を確認し、送信するプロンプトのサンプルも確認した。構造化出力への統一に伴い、旧来の「ゆるく読み取る」予備処理(約 400 行)を削除 → 実 API での確認が必須。未反映の docs(README などに GPT-5.2・思考の深さ「高」の記述が残る)は M4b で更新。ユーザーの手元の設定は台本の effort が high のまま(数時間前の既定値の名残)→ 統合時に設定画面で medium にしてもらう提案をした |
