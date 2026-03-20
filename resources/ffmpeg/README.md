# ffmpeg（mac同梱用）

mac向けアプリ配布時に、利用者のPCへ `brew install ffmpeg` を要求しないために、
`resources/ffmpeg/` に ffmpeg/ffprobe バイナリを同梱します。

## 生成（mac）

```sh
PATH=/usr/local/bin:$PATH npm run prepare:ffmpeg:mac
```

成功すると以下が生成されます（git管理しません）:

- `resources/ffmpeg/ffmpeg`
- `resources/ffmpeg/ffprobe`

ライセンスと再配布メモは、リポジトリ直下の [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) を参照してください。
