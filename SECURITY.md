# Security Policy

## Supported versions

Cloudonym is pre-1.0. Only the latest commit on the `main` branch is supported; fixes are not backported.

| Version | Supported |
|---|---|
| latest `main` | Yes |
| anything older | No |

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's private vulnerability reporting: open this repository's **Security** tab and choose **Report a vulnerability**.

Please include:

- What is affected — the endpoint (`/v1/generate`, `/v1/validate`, `/v1/events`, `/llms.txt`, `/openapi.json`), the web UI, or the engine itself (`src/core/`).
- Steps to reproduce: the exact request body or input, the response you got, and the response you expected.
- For a naming-rule report: the provider, `resource_type`, the name, the provider's error message, and a link to the official document if you have one.
- The commit or deployment you tested against, and the impact as you see it.

## What to expect

Cloudonym is maintained by one person on a best-effort basis. I aim to acknowledge a report within about a week and will keep you updated in the advisory thread, but I cannot promise fixed response or fix times. Please give reasonable time for a fix before disclosing publicly. With your permission, you will be credited in the advisory.

## Scope

**In scope**

- **A name that Cloudonym marks `valid: true` but the cloud provider rejects.** This is the engine's critical bug class — reporting it privately is welcome, and so is a normal issue if you prefer.
- Injection, request smuggling, denial of service or information disclosure in the Worker API.
- Cross-site scripting or other client-side flaws in the web UI, including through the shared URL hash.
- Secrets or credentials exposed in the repository or the built output.

**Out of scope**

- Deployments run by third parties (for example, a public copy deployed without rate limiting). Report those to whoever operates them.
- A valid name that Cloudonym rejects — the engine is intentionally conservative (see *Limitations* in the README). Open a regular issue.
- Approximate usage counts in Cloudflare KV (documented as approximate).
- Vulnerabilities in Cloudflare, the cloud providers, or third-party dependencies with no demonstrated impact on Cloudonym — report those upstream.
- Automated scanner output without a working proof of concept.

---

## 한국어 요약

- **지원 버전** — 1.0 전이다. `main` 의 최신 commit 만 지원한다
- **신고** — 공개 issue 를 열지 않는다. 저장소 **Security** 탭의 **Report a vulnerability**(GitHub 비공개 취약점 신고)로 보낸다
- **적을 것** — 대상(endpoint · 화면 · 엔진), 재현 절차(요청 본문 · 받은 응답 · 기대한 응답), 이름 규칙 건이면 provider · `resource_type` · 이름 · CSP 오류 메시지
- **응답** — 관리자 한 사람이 할 수 있는 만큼 한다. 약 일주일 안에 받았음을 알리려 하지만 기한을 약속하지 않는다
- **범위** — CSP 가 거부하는 이름을 `valid: true` 로 표시하는 것은 **범위 안이다**(이 엔진의 치명적 버그다). 제3자가 호출 제한 없이 띄운 배포는 범위 밖이다
