## Change Summary

- {{CHANGE_SUMMARY}}

## Breaking Changes

- {{BREAKING_CHANGES}}

## Public Beta

- Version: `v{{VERSION}}`
- Platform: macOS / Apple Silicon (arm64)
- Support level: best effort
- Support boundary: self-serve by default, no hands-on setup support for individual environments
- Not supported: Windows, Linux, Intel Mac, SLA-like support, instant response to upstream API/model changes
- Signing: no Developer ID signing
- Notarization: not notarized
- Rationale: intentionally omitted for this individual OSS beta because the annual Apple program cost and operational overhead are not justified yet
- Install guide: https://github.com/{{REPOSITORY}}/blob/main/docs/%E5%85%AC%E9%96%8B%E3%83%AA%E3%83%AA%E3%83%BC%E3%82%B9%E6%89%8B%E9%A0%86.md
- Gatekeeper guide: https://github.com/{{REPOSITORY}}/blob/main/docs/macOS%E3%82%A4%E3%83%B3%E3%82%B9%E3%83%88%E3%83%BC%E3%83%AB%E3%81%A8Gatekeeper.md
- Quick start: https://github.com/{{REPOSITORY}}/blob/main/docs/%E3%82%AF%E3%82%A4%E3%83%83%E3%82%AF%E3%82%B9%E3%82%BF%E3%83%BC%E3%83%88.md
- FAQ: https://github.com/{{REPOSITORY}}/blob/main/docs/FAQ%E3%81%A8%E3%83%88%E3%83%A9%E3%83%96%E3%83%AB%E3%82%B7%E3%83%A5%E3%83%BC%E3%83%88.md
- Platform limits: https://github.com/{{REPOSITORY}}/blob/main/docs/%E5%AF%BE%E5%BF%9C%E7%92%B0%E5%A2%83%E3%81%A8%E5%88%B6%E7%B4%84.md

## Assets

- `NewsVideo-{{VERSION}}-arm64.dmg`
- `NewsVideo-{{VERSION}}-arm64-mac.zip`
- `latest-mac.yml`

## Notes

- This release is built from `{{COMMIT_SHA}}`.
- `releases/latest` is expected to point to this release, so keep `prerelease` disabled unless you intentionally want it excluded from the latest link.
