# macOSインストールとGatekeeper

このドキュメントは、NewsVideo の `Public Beta` 配布版を macOS に入れるときに、未署名 / 未 notarize のアプリとしてどんな警告が出るかと、そのときの判断材料をまとめたものです。

## 先に結論

- 現在の配布版は `Developer ID` 署名も `notarization` も行っていません
- そのため、初回起動時に macOS の Gatekeeper 警告が出る可能性があります
- 個人開発の `OSS Public Beta` として配布しているため、手厚い個別サポートは行いません
- 不安がある場合は、使わない判断で問題ありません

## 対象の配布物

- GitHub Releases で配布している `NewsVideo-X.Y.Z-arm64.dmg`
- GitHub Releases で配布している `NewsVideo-X.Y.Z-arm64-mac.zip`

この手順は `macOS / Apple Silicon (arm64)` 向けを前提にしています。

## 推奨インストール手順

1. [GitHub Releases](https://github.com/aoyaman41/NewsVideo/releases/latest) から `.dmg` を取得します
2. `.dmg` を開きます
3. `NewsVideo.app` を `Applications` にコピーします
4. いったん `Applications` から起動します

## よくある警告

### 「Apple could not verify ...」

- 意味: Apple による notarization 済みアプリではないため、初回起動を止めています
- この時点で「壊れている」とは限りません

### 「developer cannot be verified」

- 意味: `Developer ID` 署名済みの配布ではないため、開発元検証ができません
- これも未署名配布に対して予想される挙動です

## 起動したい場合の回避手順

1. `Applications` の `NewsVideo.app` を `control`-click または右クリックします
2. `開く` を選びます
3. 再度確認ダイアログが出たら `開く` を選びます

これで通らない場合は、次を試します。

1. `システム設定` を開きます
2. `プライバシーとセキュリティ` を開きます
3. ブロックされたアプリに `NewsVideo` が表示されていれば `このまま開く` を選びます

## 使わないほうがよいケース

次に当てはまる場合は、この Public Beta は見送ったほうが安全です。

- 未署名 / 未 notarize アプリの実行を許可できない
- 管理対象 Mac でセキュリティポリシーの変更ができない
- 仕事用端末で厳しいインストール制限がある
- 手動許可の手順を踏みたくない

## 補足

- NewsVideo は個人開発の `OSS Public Beta` です
- 配布版の初回起動で困った場合は、まず [クイックスタート](./クイックスタート.md) と [対応環境と制約](./対応環境と制約.md) を確認してください
- 将来 `Developer ID` 署名や `notarization` を導入したら、このドキュメントも更新します
