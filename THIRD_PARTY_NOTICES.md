# Third-Party Notices

NewsVideo のソースコード自体は [LICENSE](LICENSE) に記載のとおり `ISC` です。

一方、配布物には別ライセンスの第三者コンポーネントを同梱する場合があります。現行の動画書き出しは macOS ネイティブ helper を配布物へ同梱しており、GPL の `ffmpeg` バイナリは release artifacts に含めません。

## Bundled Components

| Component | Packaged artifact | Current source in this repo | License metadata | Notes |
| --- | --- | --- | --- | --- |
| `native-video-renderer` | `resources/native-video-renderer/native-video-renderer` | `native/video-renderer/NativeVideoRenderer.swift` を `scripts/build-native-video-renderer.mjs` でコンパイル | Apple platform frameworks | `AVFoundation` / `AppKit` / `CoreGraphics` を利用する macOS 専用 helper です。 |

## Audit Trail

- `scripts/build-native-video-renderer.mjs` は `native/video-renderer/NativeVideoRenderer.swift` を `resources/native-video-renderer/native-video-renderer` へコンパイルします。
- `electron-builder.json5` は `resources/native-video-renderer/` を `extraResources` としてアプリ配布物へ同梱します。
- `electron-builder.json5` は配布物の `Contents/Resources/` に `LICENSE` と `THIRD_PARTY_NOTICES.md` も同梱します。
- `ffmpeg-static` / `ffprobe-static` は現時点では開発用 fallback として依存関係に残していますが、GitHub Releases 向けの packaged app には同梱しません。
- `npm run audit:licenses` はインストール済み依存を走査し、許可済みライセンスと既知例外以外を CI で検出します。

## Release Policy

- GitHub Releases などで配布物を公開する場合は、このファイルと [LICENSE](LICENSE) を一緒に管理してください。
- 現行フローでは、配布アプリの `Contents/Resources/` に `LICENSE` と `THIRD_PARTY_NOTICES.md` を同梱します。
- `ffmpeg-static` / `ffprobe-static` の fallback 運用を変えるとき、または native helper の同梱方法を変えるときは、必ずこのファイルを見直してください。
- ここに記載している内容は、現時点の依存関係と配布フローの記録です。法的判断が必要な場合は、配布前に別途確認してください。

## Upstream References

- `ffmpeg-static` package: [github.com/eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- `ffprobe-static` package: [github.com/joshwnj/ffprobe-static](https://github.com/joshwnj/ffprobe-static)
