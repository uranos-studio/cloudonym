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
npm run test:rules # node --test scripts/rules/*.test.mjs scripts/catalog/*.test.mjs (rule and catalog generators, source checks)
```

All five must pass before you open a pull request. Add or update tests for any behaviour you change.

## Rules the code must follow

- **Every naming limit cites the provider's official documentation.** A length, pattern or forbidden word in `src/core/constraints.ts` needs a `docUrl` pointing to the official AWS, Google Cloud or Microsoft Azure document that states it. Rules without an official source are not accepted. Where a document is ambiguous, the limit is set conservatively and recorded in [docs/decisions.md](docs/decisions.md) — see the existing D numbers there.
- **Never mark an invalid name valid.** If a name cannot be shortened to fit, the engine returns `valid: false` with a reason instead of truncating it into something the provider would reject. When a document is ambiguous, choose the stricter limit.
- **Rule changes bump the rules revision.** Any change that can give a different name, verdict, suggestion or label for the same input needs a new `RULES_REVISION` in `src/core/revision.ts` (`YYYY-MM-DD.N`) and a rewritten `src/core/rules-fingerprint.json` (`UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts`). CI compares the fingerprint with `main` and fails if one changes without the other.
- **The engine version lives in two places.** When you change `version` in `package.json`, change `ENGINE_VERSION` in `src/version.ts` too — a test fails if they differ. The build fails if a devDependency name appears in `dist/` (`scripts/check-bundle.mjs`).
- **System text comes from the catalog.** API messages and screen text are English sentences in `src/messages/en.ts`; the engine returns codes only. Tests reject Hangul in string literals, JSX text and API responses.
- **`src/core/` stays pure** — it imports only its own modules (`./…`), no npm packages and nothing from `src/api/` or `src/components/`. The API and the UI only call the engine; naming logic does not live there.

## Adding or changing a naming rule

Rules are typed `const` data in `src/core/rules/` — no rule is parsed from documentation at run time (decisions D9 and D43 in [docs/decisions.md](docs/decisions.md)). Each provider has three kinds of file:

| File | What it holds |
|---|---|
| `src/core/rules/{aws,gcp,azure}.ts` | Hand-written core rules, and the provider table that merges all three files |
| `src/core/rules/{aws,gcp,azure}-manual.ts` | Rules added by hand for rows a generator could not read as formal — the official sentence is quoted above each rule |
| `src/core/rules/{aws,gcp,azure}-intake.ts` | **Generated** — do not edit by hand. Re-run the generator instead |

1. **Find the official source** and the sentence that states the length, characters and uniqueness scope. Every rule needs a `docUrl` to that page, an `entity` (the provider's type name for uniqueness) and a `scope` that exists in `src/core/scopes.ts`. If the document is ambiguous, choose the stricter reading and add a dated row to `docs/decisions.md`.
2. **Generated rows** — run the generator for the provider; its header comment lists the inputs and the files it writes:
   - `node scripts/rules/build-azure-rules.mjs <intake.json> <resource-abbreviations.html> --existing <json> --commit <sha>`
   - `node scripts/rules/build-gcp-rules.mjs <compute.json> <cloudkms.json> --anchors anchors.json --existing existing.json`
   - `node scripts/rules/build-aws-rules.mjs <schema folder> --anchors anchors.json`

   Each one rewrites `src/core/rules/<provider>-intake.ts`, the source snapshot `src/core/__fixtures__/<provider>-intake.json`, the per-row examples `src/core/__fixtures__/rule-cases-<provider>-intake.json` and the list of rows it held back, `docs/<provider>-intake-held.md`. Read the diff row by row before committing.
3. **Hand rows** — add the rule to `src/core/rules/<provider>-manual.ts` (or the core file) with the quoted source sentence.
4. **Examples for every rule** — `src/core/rule-cases.test.ts` fails unless every rule has at least one name the document allows and one it rejects. Hand rules take theirs from `src/core/__fixtures__/rule-cases.json` (pick them from the document, not from your regular expression); generated rules take them from the generator's `rule-cases-<provider>-intake.json`.
5. **Source fingerprints** — if you brought in rows from a newer copy of a source, refresh `docs/rule-sources.lock.json` with `node scripts/rules/check-sources.mjs --lock docs/rule-sources.lock.json … --write` (arguments in the script header) and commit the diff. A monthly workflow runs the same script without `--write` and only reports changes.
6. **Rules revision and fingerprint** — bump `RULES_REVISION` in `src/core/revision.ts` (`YYYY-MM-DD.N`), then rewrite the fingerprint and, if the baseline output changed, the baseline:

   ```sh
   UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts
   UPDATE_BASELINE=1 npx vitest run src/core/baseline.test.ts
   ```

   CI runs `node scripts/check-rules-revision.mjs <main's fingerprint> src/core/rules-fingerprint.json` and fails if the fingerprint changed without a new revision or the other way round.
7. **Check** — `npm test`, `npm run test:rules`, `npm run typecheck`, `npm run lint` and `npm run build`. `/llms.txt` and the resource tree are generated from the rule table, so a new rule appears there without further edits.

## Editing the catalog (abbreviations, kinds, regions, descriptions)

For Google Cloud, the abbreviation in each name, the uniqueness class, whether a rule takes a region, a zone or no region token, the allowed kinds and their tokens, the one-line description, where the name is entered and the search aliases come from the **catalog**, not from the rule files (decisions D46, D47 and D54). The catalog also holds the region and zone codes of every provider.

| File | What it holds |
|---|---|
| `catalog/gcp.json` | One row per screen row: rule ids, abbreviation and its basis, kinds, description, `enterNameAt`, badges, aliases |
| `catalog/regions.json` | Regions and zones with their codes, for all three providers |
| `catalog/kind-sources.json` | Where each kind list and default was read, and when |
| `catalog/schema.json` | JSON Schema for the three files above |
| `src/core/rules/gcp-catalog.ts`, `src/core/regions-data.ts` | **Generated** — do not edit by hand |

1. Edit the JSON. An abbreviation needs a `basis` that names the principle and an official or measured source; a kind list needs its source in `kind-sources.json`. Write in English.
2. Run **`npm run catalog`** (`node scripts/catalog/build-catalog.mjs`). It validates the JSON against the schema and rewrites the two generated files.
3. Run `npm test`. `src/core/catalog.test.ts` checks the JSON against the schema, that the generated files hold the same data as the JSON, and that catalog rule ids and the rule table cover each other; `src/core/catalog-collision.test.ts` rejects an abbreviation or kind token that equals another one, a region or zone code, or an environment value.
4. A catalog change changes names, so bump the rules revision and rewrite the fingerprint and the baseline as in step 6 above. `/llms.txt`, `/catalog.json` and the `/docs/naming` page are built from the generated files and need no further edits.

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
- **로컬 확인** — `.nvmrc` 의 Node 로 `npm test` · `npm run typecheck` · `npm run lint` · `npm run build` · `npm run test:rules` 다섯을 통과시킨 뒤 PR 을 연다
- **catalog 고치기** — GCP 의 약어 · 고유성 부류 · 지역 토큰 종류 · 종류와 토큰 · 설명 · 별칭과 세 CSP 의 리전 · 존 코드는 `catalog/*.json` 이 정본이다. JSON 을 고치고 **`npm run catalog`** 로 생성 파일(`src/core/rules/gcp-catalog.ts` · `src/core/regions-data.ts`)을 다시 쓴 뒤 `npm test`(`catalog.test.ts` · `catalog-collision.test.ts`)를 돌린다. 이름이 바뀌므로 규칙 버전도 올린다
- **규칙 더하기** — 공식 문장을 찾아 `docUrl` · `entity` · `scope` 를 정한다 → 생성 행은 `scripts/rules/build-<provider>-rules.mjs` 를 다시 돌리고(`*-intake.ts` 는 손으로 고치지 않는다), 손 행은 `src/core/rules/<provider>-manual.ts` 에 원문을 인용해 넣는다 → 규칙마다 허용 · 거부 예가 있어야 `rule-cases.test.ts` 가 통과한다 → 출처를 새로 받았으면 `check-sources.mjs … --write` 로 `docs/rule-sources.lock.json` 을 고친다 → `RULES_REVISION` 을 올리고 `UPDATE_FINGERPRINT=1 npx vitest run src/core/revision.test.ts` (기준선이 바뀌었으면 `UPDATE_BASELINE=1 npx vitest run src/core/baseline.test.ts`) 로 지문을 다시 쓴다
- **규칙 숫자에는 CSP 공식 문서 URL(`docUrl`)이 붙는다.** 출처 없는 길이 · 정규식은 받지 않는다. 무효인 이름을 유효로 표시하지 않는다 — 문서가 모호하면 보수적으로 잡고 [docs/decisions.md](docs/decisions.md) 에 적는다
- **규칙을 바꾸면 규칙 버전을 올린다** — 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있는 변경은 `src/core/revision.ts` 의 `RULES_REVISION` 을 올리고 `src/core/rules-fingerprint.json` 을 다시 쓴다. CI 가 `main` 과 대어 본다
- **엔진 버전은 두 곳에 있다** — `package.json` 의 `version` 을 바꾸면 `src/version.ts` 의 `ENGINE_VERSION` 도 같이 바꾼다(다르면 시험이 실패한다). `dist/` 에 devDependency 이름이 있으면 빌드가 실패한다
- **시스템 문구는 사전에서 나온다** — API 메시지와 화면 문구는 `src/messages/en.ts` 의 영어 문장이고 엔진은 코드만 돌려준다
- **모든 commit 에 `git commit -s` 로 서명한다** — CLA 대신 [DCO](DCO) 를 쓴다
- **기여물은 Apache License 2.0 §5 에 따라 같은 조건으로 제공된다**(inbound = outbound)
