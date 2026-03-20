# Third-Party Notices

NewsVideo のソースコード自体は [LICENSE](LICENSE) に記載のとおり `ISC` です。

一方、配布物には別ライセンスの第三者コンポーネントを同梱する場合があります。特に `ffmpeg` / `ffprobe` バイナリは、アプリ本体とは別ライセンスとして扱ってください。

## Bundled Components

| Component | Packaged artifact | Current source in this repo | License metadata | Notes |
| --- | --- | --- | --- | --- |
| `ffmpeg` | `resources/ffmpeg/ffmpeg` | `scripts/prepare-ffmpeg.mjs` が `ffmpeg-static` からコピー | `GPL-3.0-or-later` | `ffmpeg-static` README では、配布されるバイナリの利用・再配布はそれぞれのライセンスに従うと案内されています。 |
| `ffprobe` | `resources/ffmpeg/ffprobe` | `scripts/prepare-ffmpeg.mjs` が `ffprobe-static` からコピー | `MIT` | `ffprobe-static` の MIT License を保持してください。 |

## Audit Trail

- `scripts/prepare-ffmpeg.mjs` は `ffmpeg-static` と `ffprobe-static` のローカルインストールから実行ファイルを `resources/ffmpeg/` にコピーします。
- `electron-builder.json5` は `resources/ffmpeg/` を `extraResources` としてアプリ配布物へ同梱します。
- 現在の依存関係のメタデータは `ffmpeg-static@5.3.0` が `GPL-3.0-or-later`、`ffprobe-static@3.1.0` が `MIT` です。
- FFmpeg の公式ドキュメントでは、FFmpeg 本体はデフォルトでは LGPL 2.1 以上、GPL オプションを有効にしたビルドでは GPL に変わると説明されています。実際に同梱するバイナリの条件は、そのビルド構成と配布元に依存します。

## Release Policy

- GitHub Releases などで配布物を公開する場合は、このファイルと [LICENSE](LICENSE) を一緒に管理してください。
- `ffmpeg-static` / `ffprobe-static` のバージョンを上げるとき、または同梱方法を変えるときは、必ずこのファイルを見直してください。
- ここに記載している内容は、現時点の依存関係と配布フローの記録です。法的判断が必要な場合は、配布前に別途確認してください。

## Upstream References

- FFmpeg official legal notes: [ffmpeg.org/legal.html](https://ffmpeg.org/legal.html)
- `ffmpeg-static` package: [github.com/eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- `ffprobe-static` package: [github.com/joshwnj/ffprobe-static](https://github.com/joshwnj/ffprobe-static)
