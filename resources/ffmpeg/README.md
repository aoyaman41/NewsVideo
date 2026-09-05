# ffmpeg（開発用 fallback）

現在の GitHub Releases 向け配布では、`ffmpeg` / `ffprobe` は同梱しません。
このディレクトリは、開発時に `NEWSVIDEO_VIDEO_BACKEND=ffmpeg` を使う fallback 用のメモです。

## 生成（mac）

```sh
PATH=/usr/local/bin:$PATH npm run prepare:ffmpeg:mac
```

成功すると以下が生成されます（git管理しません）:

- `resources/ffmpeg/ffmpeg`
- `resources/ffmpeg/ffprobe`

ライセンスと再配布メモは、ルートの `THIRD_PARTY_NOTICES.md` を参照してください。
