# 指示書: Claude Opus 5.5 / Gemini 3.8 TTS の追加

- 作成日: 2026-09-26
- ベースブランチ: `codex/project-wide-improvements`(fd05878 時点)
- 構成: ミッション A(Claude プロバイダ + Opus 5.5)とミッション B(Gemini 3.8 TTS)を別 worktree で並行実装
- 統合: メインループがユーザー同席でマージ → E2E(実APIでの試聴・生成確認)→ 承認

## 0. 共通ルール(A・B 両方に適用)

1. **コミット・push・デプロイはしない。** 納品物は「未コミットの worktree + 完了報告」。
2. **指示書外の設計判断が必要になった場合、または解決できない問題に直面した場合は、勝手に進めず停止してメインループへ報告する。** 特に以下は必ず停止・報告:
   - SDK のメジャーバージョンアップが必要になった場合(例: `@google/genai` 1.x → 2.x)
   - 既存ユーザーの保存済み設定やプロジェクトデータのマイグレーションが必要になった場合
   - 公式ドキュメントとこの指示書の記述が食い違う場合
3. ロジック実装・レビュー・テストは Codex(codex プラグイン)に委譲してよい。
4. **実 API を叩かない**(ユーザーの API キーを使わない)。テストは SDK をモックする。API キーやシークレットを print・ログ出力しない。
5. 両ミッションは `shared/constants/models.ts`、`src/utils/cost.ts`、docs などを共有する。**自分のミッションの区画だけを編集**し、他方の領域(A はテキストモデル側、B は TTS 側)を触らない。無関係なリファクタや整形もしない(マージ時の衝突を避けるため)。
6. 完了条件: `npm run typecheck` / `npm run lint` / `npm test` がすべて通ること。
7. 完了報告に含めるもの: 変更ファイル一覧、主要な設計判断とその理由、テスト結果(コマンドと結果の要約)、未解決事項、統合時にメインループが実 API で確認すべき項目。

## 1. ユーザー決定事項(2026-09-26)

| 項目 | 決定 |
|---|---|
| テキストモデル | Claude Opus 5.5 を追加(新プロバイダ `anthropic`) |
| Opus 5.5 の拒否(refusal)時 | **エラー表示のみ**。サーバー側の自動フォールバック(`fallbacks`)は使わない |
| 追加する TTS モデル | `gemini-3.8-flash-tts` と `gemini-3.8-flash-lite-tts` の**両方** |
| TTS のデフォルトモデル | **`gemini-3.8-flash-tts` に変更**(新規設定時の初期値のみ。既存ユーザーが保存済みの選択は変えない) |

メインループ判断(ユーザーへ報告済み):
- Claude の effort の既定値は `high`(脚本品質を重視。設定画面で変更可)
- 3.8 TTS の料金は現行のキャンペーン価格で実装する。2027-01-01 の値上げはフォローアップで更新する(§3.6)

---

## 2. ミッション A: Claude プロバイダ + Opus 5.5

### 2.1 モデル仕様(Anthropic 公式情報、2026-09 時点)

- モデルID: `claude-opus-5-5`(日付サフィックスは付けない)/ 表示名: `Claude Opus 5.5`
- 料金(1M トークンあたり): 入力 $4.00 / 出力 $20.00 / キャッシュ読み取り $0.20 / キャッシュ書き込み(5分TTL) $5.00
- コンテキスト 1M、最大出力 128K
- **thinking は常にオン**: `thinking` パラメータは**送らない**(省略すれば adaptive で動く)。`{type: "disabled"}` や `budget_tokens` を送ると 400 エラーになる
- **`temperature` / `top_p` / `top_k` を送ると 400 エラー。** assistant prefill も 400
- 思考の深さは `output_config: { effort }` のみで制御: `low` / `medium` / `high` / `xhigh` / `max`(API 側の既定は `medium`)
- 強制 tool_choice(`any` / `tool`)は 400(本アプリでは tool use を使わない想定)
- レスポンスの `thinking` ブロックは既定で中身が空。**`text` ブロックだけを連結して使う**
- `stop_reason === "refusal"` の場合は `stop_details.category` / `explanation` が入る

### 2.2 SDK

- `@anthropic-ai/sdk`(npm latest は 0.128.0)を dependencies に追加する
- **公式 SDK 経由で呼ぶこと。** 生の `fetch` や OpenAI 互換レイヤーは使わない(接続テストを含む)
- 構造化出力は `client.messages.parse({ ..., output_config: { format: zodOutputFormat(schema) } })`(`@anthropic-ai/sdk/helpers/zod`)を第一候補にする。プロジェクトは zod v4 のため、互換性を最初に確認する。非互換なら `output_config.format` に JSON Schema を渡し、応答を既存の zod スキーマで検証する方式に切り替えてよい(判断理由を報告に書く)
- 出力が長くなり得る呼び出し(脚本生成)はストリーミング + `finalMessage()` を使い、`max_tokens` を十分に取る(目安 64000。thinking トークンも `max_tokens` に含まれる)。短い呼び出しは非ストリーミング + `max_tokens` 16000 程度でよい
- SDK の型(`Anthropic.MessageParam` 等)とエラークラス(`Anthropic.RateLimitError` 等)を使い、独自の型定義やエラーメッセージの文字列マッチは避ける

### 2.3 実装範囲

1. **モデル定数**(`shared/constants/models.ts`)
   - `ANTHROPIC_TEXT_COMPLETION_MODELS = ['claude-opus-5-5']` を追加し、`TEXT_COMPLETION_MODELS` に含める。ラベルと型ガード(`isAnthropicTextCompletionModel`)も追加
   - `TextCompletionProvider` に `'anthropic'` を追加。`getTextCompletionModelProvider` を3分岐にする
   - effort 定義を追加: `CLAUDE_EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max']`、モデル別の対応レベル表、既定値 `high`(OpenAI / Gemini と同じ設計)
   - テキストモデルの既定値(`DEFAULT_SCRIPT_TEXT_MODEL` 等)は**変えない**
2. **設定**(`shared/settings/appSettings.ts`、`electron/ipc/settings.ts`、プロジェクトの generationConfig スキーマと整合性チェック)
   - `claudeEffort` を追加。normalize / parse / DEFAULT_SETTINGS に反映し、`claudeEffort` がない既存の settings.json は既定値で補う
   - `electron/ipc/settings.ts` の `generationKeys` に `claudeEffort` を追加
   - `shared/project/schema.ts` / `integrity.ts` など、`openaiReasoningEffort` / `geminiThinkingLevel` を扱う箇所すべてに対応を追加
3. **API キー**
   - `ApiKeyService` に `'anthropic'` を追加。`settings:hasApiKey` / `settings:setApiKey` / `settings:testConnection` の許可リストも更新
   - 接続テストは SDK の `client.models.retrieve('claude-opus-5-5')` で行う(Opus 5.5 へのアクセス権も同時に確認できる)。失敗時のメッセージは既存の書式に合わせる
   - `src/types/electron.d.ts` と preload の型、`SettingsPage.tsx` に Anthropic API キーの入力欄・保存・接続テスト UI を追加(既存の OpenAI / Google AI 欄と同じ UI パターン、デザインシステムに準拠)
4. **生成処理**(`electron/ipc/ai.ts`)
   - `isOpenAITextCompletionModel ? OpenAI : Gemini` という2択の分岐(少なくとも脚本生成・スライド/画像プロンプト生成・テキスト生成の3箇所)を3分岐にする。共通の `generateClaudeTextContent` 相当の関数にまとめる
   - Claude クライアントは `new Anthropic({ apiKey, fetch: limitedAnthropicFetch })` とし、`electron/utils/generationPolicy.ts` に `withProviderSlot('anthropic', ...)` を使う `limitedAnthropicFetch` を追加して、同時実行数の制御に乗せる
   - リトライは SDK 標準(maxRetries 2)に任せ、二重リトライで試行回数が膨らまないようにする。`shared/project/jobs` の `classifyGenerationError` が Anthropic の 429 / 529(overloaded)/ 5xx を rate_limit / transient に分類できるか確認し、できなければ対応する
   - API キー未設定時は既存と同じ書式のエラーにする:「Anthropic APIキーが設定されていません。設定画面からAPIキーを入力してください。」
   - **拒否時**(`stop_reason === 'refusal'`)はフォールバックせずにエラーを投げる。例:「Claudeが安全上の理由で生成を拒否しました(カテゴリ: {category})。記事内容を確認するか、別のモデルで再実行してください。」
   - `stop_reason === 'max_tokens'` は「出力が上限で途切れた」旨のエラーにする(途切れた JSON を黙って使わない)
   - 同じシステムプロンプトを繰り返し使う呼び出し(シーンごとの画像プロンプト生成など)では、system ブロックに `cache_control: { type: 'ephemeral' }` を付ける(最小キャッシュ長は 512 トークン)。不要な呼び出しには付けない
   - 1832 行付近の `aggregatedUsage && isOpenAITextCompletionModel(...)` のように、OpenAI 限定の後処理が Claude でも必要かを確認する
5. **使用量・コスト**(`src/utils/usage.ts`、`src/utils/cost.ts`、`shared/project/generationEstimate.ts`)
   - usage の provider に `'anthropic'` を追加し、`provider === 'gemini' ? ... : 'openai'` のような2値前提をすべて修正する(`cost.ts` の `if (record.provider !== 'gemini') return 0;` だと Claude のコストが 0 円になる)
   - usage のマッピング(既存の OpenAI 規約「inputTokens はキャッシュ分を含む合計」に合わせる):
     - `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
     - `cachedInputTokens = cache_read_input_tokens`
     - `cacheWriteTokens = cache_creation_input_tokens`
     - `outputTokens = output_tokens`(thinking を含む)
     - `model = response.model`
   - 料金表に Opus 5.5 を追加(§2.1)。ユーザーが編集できるコスト設定(normalize)にも anthropic セクションを追加する。見積もり(generationEstimate)も対応する
6. **UI**
   - テキストモデルを選ぶ箇所(SettingsPage、ArticleInputPage / ScriptEditPage / ImageManagePage にあれば)に Opus 5.5 を表示する。Claude モデルを選択中は effort 選択を表示する
   - Anthropic キー未設定で Claude を選んだときの警告は、既存のプロバイダと同じ扱いにする
7. **ドキュメント**
   - `docs/データ取り扱い.md`: 送信先に Anthropic を追加(接続テスト URL `https://api.anthropic.com/v1/models/claude-opus-5-5`、テキスト生成の送信先)
   - `docs/現行実装ガイド.md` などでテキストモデル・プロバイダを列挙している箇所
   - `THIRD_PARTY_NOTICES.md`(`npm run audit:licenses` の運用に従う)
8. **テスト**(既存テストのパターンに合わせる)
   - models: プロバイダ判定、effort の対応表と既定値
   - appSettings / settings: `claudeEffort` の正規化と後方互換、`anthropic` キーの許可リスト
   - ai: Claude へのリクエストに `temperature` / `thinking` が含まれないこと、effort が `output_config.effort` に入ること、refusal と max_tokens でエラーになること、usage のマッピング
   - cost / usage: Opus 5.5 の料金計算(キャッシュ読み取り・書き込みを含む)、provider `anthropic` のレコード

### 2.4 非スコープ

- 画像生成・TTS の変更(TTS はミッション B)
- テキストモデルの既定値の変更
- サーバー側フォールバック、Batch API、fast mode

---

## 3. ミッション B: Gemini 3.8 TTS

### 3.1 モデル仕様(Google 公式ドキュメント、2026-09 時点)

| モデルID | 表示名 | 状態 | 料金(1M トークン、2026-12-31 まで) | 2027-01-01 以降 |
|---|---|---|---|---|
| `gemini-3.8-flash-tts` | Gemini 3.8 Flash TTS | Stable | 入力 $0.50 / 出力(音声) $9.00 | $1.00 / $18.00 |
| `gemini-3.8-flash-lite-tts` | Gemini 3.8 Flash-Lite TTS | Stable | 入力 $0.50 / 出力(音声) $6.00 | $1.00 / $12.00 |

- 入力上限 8,192 トークン / 出力上限 16,384 トークン
- 参照: https://ai.google.dev/gemini-api/docs/speech-generation 、 https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts 、 https://ai.google.dev/gemini-api/docs/pricing

### 3.2 3.1 Flash TTS Preview からの破壊的変更(そのまま追加すると壊れる点)

1. **入力テキストは一字一句そのまま読み上げ原稿として扱われる。** 現行の `synthesizeGeminiTts` はナレーション指示(`buildTtsNarrationInstruction`)を本文の前に連結しているため、**3.8 では指示文まで読み上げられる**。3.8 ではスタイル指示を構造化された `speech_metadata` の `style` に入れる(Interactions API と GenerateContent API の両方で対応していると公式に記載あり)
2. **非ストリーミング応答の既定形式が WAV(RIFF ヘッダ付き、24kHz / mono / 16bit)に変わった。** 以前のモデルはヘッダなしの PCM を返していた。現行コードは受け取ったデータを PCM とみなして `pcm16leToWavBuffer` でヘッダを付けているため、**ヘッダが二重になり、音声データも長さの計算も壊れる**
3. 山括弧のインラインタグ(`<laugh>` `<sigh>` など)は声の演出として解釈される

### 3.3 実装範囲

1. **モデル定数**(`shared/constants/models.ts` の TTS 区画のみ)
   - `GEMINI_TTS_MODELS` の先頭に `gemini-3.8-flash-tts`、次に `gemini-3.8-flash-lite-tts` を追加し、ラベルも追加
   - `DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts'` に変更
   - モデルごとの能力フラグを追加する(例: スタイルを `speech_metadata` で渡すか、応答が WAV で返るか)。モデルIDの文字列判定をコード中に散らばらせない
2. **TTS リクエスト**(`electron/ipc/tts.ts`)
   - 3.8 系では `contents` に**本文だけ**を入れ、ナレーション指示は `speech_metadata.style` で渡す。3.1 / 2.5 系は現行の挙動のまま
   - GenerateContent API で `speech_metadata` を渡す正確なリクエスト形を公式ドキュメントで確認する。現行の `@google/genai` 1.43.0 で渡せるか(型が未対応でもフィールドがそのまま送られるか)を検証する。**2.x へのメジャーアップが必要と判明したら、実装せずに停止して報告する**(画像生成・Gemini テキストにも影響するため)
   - `style` に長さの制約があるか確認し、現行のプリセット指示文が収まるかを確認する
   - 現行のボイス名(`Charon` 等のプリビルトボイス)が 3.8 でもそのまま使えるか確認する。使えないものがあれば報告する
3. **音声のデコード**
   - 応答データの先頭が `RIFF` なら WAV として解析し(fmt チャンクからサンプルレート・チャンネル数・ビット深度、data チャンクから長さ)、その WAV をそのまま保存する。先頭が `RIFF` でなければ現行どおり PCM とみなしてヘッダを付ける。モデル名ではなく実データで判定するので、どちらの形式でも壊れない
   - `durationSec` は解析した実際の形式から計算する。既存の WAV 解析ユーティリティ(`measurePcmWav` 等)があれば再利用する
4. **入力長**: 3.8 の入力上限は 8,192 トークン。現行の分割単位(パートごと)で上限を超え得るか確認し、超え得るなら報告する
5. **山括弧**: 脚本テキストに `<...>` が含まれ得るか確認する(読み辞書の置換結果を含む)。含まれ得て、3.8 でタグとして誤解釈される懸念があれば、対処案を添えて報告する(勝手にエスケープ仕様を決めない)
6. **コスト**(`src/utils/cost.ts` の TTS 区画のみ)
   - `DEFAULT_GEMINI_TTS_RATES` に 2 モデルの料金を追加する(§3.1 の 2026-12-31 までの価格)。コードコメントに「2027-01-01 から倍額」と明記する
   - `DEFAULT_GEMINI_TTS_MODEL` の変更が、既存の使用量レコードのコスト計算(model 未記録の古いレコードのフォールバック等)を変えてしまわないか確認する。変わるなら、過去レコードは旧既定値(`gemini-3.1-flash-tts-preview`)で計算されるように保つ
7. **既定値変更の影響**
   - 既存ユーザーの settings.json に保存済みの `ttsModel` が変わらないこと(normalize で有効な値は保持される)
   - 既定値 `DEFAULT_GEMINI_TTS_MODEL` を参照している箇所(設定、プロジェクトの generationConfig、見積もり、UI)をすべて洗い出し、意図しない挙動変化がないか確認する
8. **UI**: AudioManagePage / SettingsPage の TTS モデル選択に 2 モデルが表示されること(定数から自動生成されていれば変更不要)
9. **ドキュメント**: TTS モデルを列挙している docs を更新する(`grep -rn "3.1-flash-tts\|Flash TTS" docs` で洗い出す)
10. **テスト**
    - models: 新モデル・ラベル・既定値・能力フラグ
    - tts: 3.8 では `contents` に指示文が含まれず `speech_metadata.style` に入ること、3.1 では現行どおりであること(SDK をモック)
    - 音声デコード: RIFF 付き WAV と生 PCM の両方で、正しいファイルと `durationSec` になること
    - cost: 新 2 モデルの料金、古いレコードのフォールバックが変わらないこと

### 3.4 非スコープ

- Interactions API への移行(GenerateContent API で `speech_metadata` を渡せない場合は停止・報告)
- Voice design / Voice replication / Extended Voice Library
- ストリーミング TTS
- 既存ユーザーの `ttsModel` の書き換え

### 3.5 統合時の確認項目(メインループ + ユーザー)

- 3.8 Flash / Flash-Lite で実際に音声を生成して試聴し、指示文が読み上げられていないこと、ナレーションスタイルが反映されていること、音声の長さ・字幕の同期がずれていないことを確認する
- 3.1 Flash TTS Preview で従来どおり生成できること(回帰確認)

### 3.6 フォローアップ

- **2027-01-01**: 3.8 TTS の料金が倍額になる(Flash $1.00 / $18.00、Flash-Lite $1.00 / $12.00)。`DEFAULT_GEMINI_TTS_RATES` を更新する

---

## 4. 進捗ログ

| 日付 | 内容 |
|---|---|
| 2026-09-26 | 指示書作成。ユーザー決定事項を確定。ミッション A / B を Opus サブエージェントに worktree 分離で発注 |
