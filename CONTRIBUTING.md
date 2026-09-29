# Contributing to Cloudonym

Thanks for your interest. Issues and pull requests are welcome.

## Before you start

- **Bugs and naming-rule errors** — open an issue with the provider, `resource_type`, input, the response you got, and what the provider actually accepts or rejects. If Cloudonym marks a name `valid: true` and the provider rejects it, that is the engine's critical bug class; see [SECURITY.md](SECURITY.md) if you prefer to report it privately.
- **Security problems** — do not open a public issue; follow [SECURITY.md](SECURITY.md).
- **Larger changes** (new providers, new resource types, API changes) — open an issue first so the approach can be agreed before you write code.

## Development

Use the Node version in `.nvmrc`.

```sh
nvm use
npm install
npm test           # Vitest
npm run typecheck  # tsc -b --noEmit
npm run lint       # oxlint
npm run build      # tsc -b && vite build && node scripts/check-bundle.mjs
```

All four must pass before you open a pull request. Add or update tests for any behaviour you change.

## Rules the code must follow

- **Every naming limit cites the provider's official documentation.** A length, pattern or forbidden word in `src/core/constraints.ts` needs a `docUrl` pointing to the official AWS, Google Cloud or Microsoft Azure document that states it. Rules without an official source are not accepted. Where a document is ambiguous, the limit is set conservatively and recorded in [docs/decisions.md](docs/decisions.md) — see the existing D numbers there.
- **Never mark an invalid name valid.** If a name cannot be shortened to fit, the engine returns `valid: false` with a reason instead of truncating it into something the provider would reject. When a document is ambiguous, choose the stricter limit.
- **Rule changes bump the rules revision.** Any change that can give a different name, verdict, suggestion or label for the same input needs a new `RULES_REVISION` in `src/core/revision.ts` (`YYYY-MM-DD.N`) and a rewritten `src/core/rules-fingerprint.json` (`UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts`). CI compares the fingerprint with `main` and fails if one changes without the other.
- **The engine version lives in two places.** When you change `version` in `package.json`, change `ENGINE_VERSION` in `src/version.ts` too — a test fails if they differ. The build fails if a devDependency name appears in `dist/` (`scripts/check-bundle.mjs`).
- **System text comes from the catalog.** API messages and screen text are English sentences in `src/messages/en.ts`; the engine returns codes only. Tests reject Hangul in string literals, JSX text and API responses.
- **`src/core/` stays pure** — it imports only its own modules (`./…`), no npm packages and nothing from `src/api/` or `src/components/`. The API and the UI only call the engine; naming logic does not live there.

## Pull requests

- Keep each pull request focused on one change and describe what changed and why.
- Link the official documentation for any rule you add or change.

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin 1.1](DCO) instead of a Contributor License Agreement. By signing off a commit you certify the statements in the `DCO` file.

Sign off **every commit** with `git commit -s`, which adds a line like this using your `git config` name and email:

```text
Signed-off-by: Your Name <you@example.com>
```

Use your real name. To sign off commits you already made: `git commit --amend -s` for the last one, or `git rebase --signoff main` for a branch. Pull requests with unsigned commits cannot be merged.

## License of contributions

Cloudonym is licensed under the [Apache License, Version 2.0](LICENSE). As stated in Section 5 of that license, any contribution you intentionally submit for inclusion is licensed under the same Apache License 2.0 terms, without any additional terms or conditions (inbound = outbound). The Cloudonym name and logo are not covered by the license; see [TRADEMARKS.md](TRADEMARKS.md).

---

## 한국어 요약

- **issue · PR 모두 환영한다.** 큰 변경(새 provider · 새 리소스 · API 변경)은 issue 로 먼저 방향을 맞춘다. 보안 문제는 [SECURITY.md](SECURITY.md) 를 따른다
- **로컬 확인** — `.nvmrc` 의 Node 로 `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` 넷을 통과시킨 뒤 PR 을 연다
- **규칙 숫자에는 CSP 공식 문서 URL(`docUrl`)이 붙는다.** 출처 없는 길이 · 정규식은 받지 않는다. 무효인 이름을 유효로 표시하지 않는다 — 문서가 모호하면 보수적으로 잡고 [docs/decisions.md](docs/decisions.md) 에 적는다
- **규칙을 바꾸면 규칙 버전을 올린다** — 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있는 변경은 `src/core/revision.ts` 의 `RULES_REVISION` 을 올리고 `src/core/rules-fingerprint.json` 을 다시 쓴다. CI 가 `main` 과 대어 본다
- **엔진 버전은 두 곳에 있다** — `package.json` 의 `version` 을 바꾸면 `src/version.ts` 의 `ENGINE_VERSION` 도 같이 바꾼다(다르면 시험이 실패한다). `dist/` 에 devDependency 이름이 있으면 빌드가 실패한다
- **시스템 문구는 사전에서 나온다** — API 메시지와 화면 문구는 `src/messages/en.ts` 의 영어 문장이고 엔진은 코드만 돌려준다
- **모든 commit 에 `git commit -s` 로 서명한다** — CLA 대신 [DCO](DCO) 를 쓴다
- **기여물은 Apache License 2.0 §5 에 따라 같은 조건으로 제공된다**(inbound = outbound)
