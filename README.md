# Cloudonym

Multi-cloud resource naming engine for **AWS · GCP · Azure**. From five context values (owner · system · purpose · env · region) it **generates, corrects and validates** resource names against each provider's physical constraints — a web UI for people, and `/v1/generate` · `/v1/validate` · `/llms.txt` · `/openapi.json` for AI coding agents and IaC.

[한국어](#한국어)

![Cloudonym web UI — context form, provider tabs and result cards](docs/screenshots/01-desktop-light.png)

## Usage in 3 seconds (web UI)

1. Type **Owner · System · Purpose**, pick **Environment** and **Region** — names are regenerated as you type.
2. Each card shows the name, `PASS`/`FAIL`, and why it was shortened or transformed (e.g. dropped `region`, removed hyphens).
3. Copy a name with its button, copy the tags/labels as **JSON** or **Terraform**, or share the whole form with **공유 URL** (state lives in the URL hash).

Allowed values — env: `prd` · `stg` · `dev` · `sbx` (aliases such as `prod`, `staging` are accepted) · region: `kr` · `us` · `jp` · `eu` · `global` (aliases such as `asia-northeast3`, `ap-northeast-2`, `koreacentral` are accepted). The full alias list is in `/llms.txt`.

## API in three lines

There is no public domain yet — replace `https://<your-deployment>` with your Worker URL (or the URL `npm run dev` prints).

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"kr"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"azure","resource_type":"storage_account","name":"St-Payments-Prd"}'
```

`providers` is optional (default: all three). Response of `/v1/generate`, trimmed to one resource:

```json
{
  "success": true,
  "data": {
    "gcp": {
      "compute_instance": {
        "name": "payments-batch-prd-kr-vm-01",
        "valid": true,
        "is_truncated": false,
        "is_transformed": false,
        "original": "payments-batch-prd-kr-vm-01",
        "violations": [],
        "reason": "",
        "rule": {
          "min_length": 1,
          "max_length": 63,
          "pattern": "^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$",
          "pattern_flags": "",
          "allowed": "lower-digit-hyphen",
          "doc_url": "https://docs.cloud.google.com/compute/docs/naming-resources"
        }
      }
    }
  },
  "metadata": {
    "generated_labels": { "gcp": { "owner": "platform", "system": "payments", "purpose": "batch", "environment": "prd", "managed_by": "cloudonym" } },
    "label_violations": { "gcp": [] },
    "label_transformed": { "gcp": [] },
    "transformed": ["env: prod→prd"]
  }
}
```

Response of `/v1/validate` (violation messages are in Korean):

```json
{ "valid": false, "violations": ["허용 형식(^[a-z0-9]{3,24}$)에 맞지 않는다"], "suggested_name": "stpaymentsprd" }
```

A malformed request returns `400` with `{ "success": false, "errors": [...] }` (plus `supported` when a provider or resource type is unknown). Bodies over 16 KB return `413`.

## AI-agent integration

- **`GET /llms.txt`** — naming formulas, canonical values with aliases, every rule's length · pattern · forbidden words · doc link, and the API summary. It is built from the rule table at request time, so it never drifts from the engine.
- **`GET /openapi.json`** — OpenAPI 3.0.3 for `/v1/generate`, `/v1/validate` and `/v1/events`.

Point your agent at `https://<your-deployment>/llms.txt`; paths in it are relative to the host that served it.

## Supported resources (24 rules)

Every limit is checked against the official document linked below. The line-by-line comparison is in [docs/규칙-대조-20260928.md](docs/규칙-대조-20260928.md).

| Provider | `resource_type` | Length | Official doc |
|---|---|---|---|
| GCP | `project_id` | 6–30 | [link](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers) |
| GCP | `service_account` | 6–30 | [link](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create) |
| GCP | `compute_instance` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/naming-resources) |
| GCP | `vpc_network` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks#Network.FIELDS.name) |
| GCP | `subnet` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/subnetworks#Subnetwork.FIELDS.name) |
| GCP | `cloud_sql_instance` | 1–67 | [link](https://docs.cloud.google.com/sql/docs/mysql/instance-settings) |
| GCP | `storage_bucket` | 3–63 | [link](https://docs.cloud.google.com/storage/docs/buckets#naming) |
| AWS | `s3_bucket` | 3–63 | [link](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html) |
| AWS | `iam_role` | 1–64 | [link](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html) |
| AWS | `vpc` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `subnet` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `ec2_instance` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `rds_instance` | 1–63 | [link](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBInstance.html) |
| Azure | `resource_group` | 1–90 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftresources) |
| Azure | `storage_account` | 3–24 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftstorage) |
| Azure | `key_vault` | 3–24 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftkeyvault) |
| Azure | `managed_identity` | 3–128 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftmanagedidentity) |
| Azure | `virtual_machine` (Linux) | 1–64 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftcompute) |
| Azure | `virtual_machine_windows` | 1–15 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftcompute) |
| Azure | `virtual_network` | 2–64 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftnetwork) |
| Azure | `subnet` | 1–80 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftnetwork) |
| Azure | `sql_server` | 1–63 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftsql) |
| Azure | `aks_nodepool_linux` | 1–12 | [link](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-common-issues-faq#what-naming-restrictions-are-enforced-for-aks-resources-and-parameters-) |
| Azure | `aks_nodepool_windows` | 1–6 | [link](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/create-upgrade-delete/aks-common-issues-faq#what-naming-restrictions-are-enforced-for-aks-resources-and-parameters-) |

Tag/label limits (key · value): AWS 128 · 256, Azure 512 · 256, GCP 63 · 63.

## Limitations

Cloudonym does **not** replace the provider's final verdict.

1. **Only known reserved words** (decision D19). `forbidden` holds only strings the official documents state explicitly (e.g. `google`, `g00gle`, `goog` prefix for GCS). Other look-alike spellings and trademarks are not checked.
2. **Conservative limits** (D20). Where a document is ambiguous or a limit spans several fields, the engine is stricter than the provider — it may reject a valid name, but it must never mark an invalid one valid:
   - Cloud SQL instance ID capped at **67** (the 98-char `project-id:instance-id` total minus the longest project ID 30, minus 1), and it must end with a letter or digit.
   - GCS bucket kept at **63** even though dotted names may reach 222 (the engine never generates dots); consecutive dots `..` rejected.
   - Azure VM (Linux · Windows) follows **hostname** rules: must start with a letter or digit, and dots are rejected entirely. Other symbols that ARM accepts may be rejected.
   - AWS Name tags measured by UTF-16 length (1–256), stricter than code points only for supplementary-plane characters such as emoji.
   - Azure resource group rejects supplementary-plane characters (U+10000 and above).
3. **Usage counts are approximate** (D16). Cloudflare KV daily counters use read-modify-write, so concurrent requests can lose a count and writes over the per-key rate limit are dropped. Exact analytics come from Axiom events.

## Terraform example

[examples/terraform/](examples/terraform/README.md) calls `/v1/generate` from a `data "http"` block and creates a `google_compute_instance` with the returned name and labels. `apply` is blocked unless `valid` is `true` and there are no label violations.

## Local development

Node version comes from `.nvmrc` (22).

```sh
nvm use
npm install
npm run dev        # Vite + workerd — UI and /v1/* together, from source
npm test           # Vitest
npm run typecheck  # tsc -b --noEmit (plain `npx tsc --noEmit` checks nothing here)
npm run lint       # oxlint
npm run build      # tsc -b && vite build → dist/client + dist/cloudonym
npm run preview    # build, then vite preview
npm run deploy     # build, then wrangler deploy (needs `npx wrangler login`)
```

Local secrets go in `.dev.vars` (template: `.dev.vars.example`). More detail — including running the built Worker with `wrangler dev` — is in [docs/개발환경.md](docs/개발환경.md).

---

## 한국어

**Cloudonym** 은 **AWS · GCP · Azure** 리소스 이름을 다섯 문맥값(owner · system · purpose · env · region)에서 각 CSP 의 물리 제약에 맞게 **생성 · 교정 · 검증**하는 엔진이다. 사람은 웹 화면으로, AI 코딩 에이전트와 IaC 는 `/v1/generate` · `/v1/validate` · `/llms.txt` · `/openapi.json` 으로 쓴다.

### 3초 사용법 (웹 화면)

1. **Owner · System · Purpose** 를 적고 **Environment** · **Region** 을 고른다 — 입력하는 대로 이름이 다시 만들어진다
2. 카드마다 이름 · `PASS`/`FAIL` · 줄이거나 바꾼 이유(`region` 생략 · 하이픈 제거 등)가 나온다
3. 이름은 복사 버튼으로, 태그 · 라벨은 **JSON** · **Terraform** 으로 복사하고, **공유 URL** 로 입력 전체를 넘긴다(상태는 URL hash 에 있다)

허용값 — env: `prd` · `stg` · `dev` · `sbx`(`prod` · `staging` 같은 별칭도 받는다) · region: `kr` · `us` · `jp` · `eu` · `global`(`asia-northeast3` · `ap-northeast-2` · `koreacentral` 같은 별칭도 받는다). 별칭 전체는 `/llms.txt` 에 있다.

### API 세 줄

아직 공개 도메인이 없다. `https://<your-deployment>` 를 배포한 Worker 의 URL(또는 `npm run dev` 가 찍는 URL)로 바꾼다. 요청 · 응답 예시는 위 [API in three lines](#api-in-three-lines) 와 같다.

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"kr"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"azure","resource_type":"storage_account","name":"St-Payments-Prd"}'
```

`providers` 는 생략할 수 있다(기본은 셋 다). 요청이 잘못되면 `400` 과 `{ "success": false, "errors": [...] }`, 본문이 16KB 를 넘으면 `413` 이다.

### AI 에이전트 연동

- **`GET /llms.txt`** — 이름 공식 · 표준값과 별칭 · 규칙마다 길이 · pattern · 금지어 · 문서 링크 · API 요약. 요청 때 규칙 표에서 만들므로 엔진과 어긋나지 않는다
- **`GET /openapi.json`** — `/v1/generate` · `/v1/validate` · `/v1/events` 의 OpenAPI 3.0.3

### 지원 리소스

GCP 7 · AWS 6 · Azure 11, 모두 **24개** 규칙이다. 표와 공식 문서 링크는 위 [Supported resources](#supported-resources-24-rules) 에 있고, 규칙마다 공식 문서와 대조한 기록은 [docs/규칙-대조-20260928.md](docs/규칙-대조-20260928.md) 다.

### 한계

Cloudonym 의 판정은 **CSP 의 최종 판정을 대신하지 않는다.**

1. **알려진 예약어만 검사한다** (D19) — 공식 문서에 명시된 문자열(`google` · `g00gle` · GCS 의 `goog` 접두 등)만 막는다. 그 밖의 유사 철자와 상표는 보지 않는다
2. **한도를 보수적으로 잡는다** (D20) — 유효한 이름을 거부할 수는 있어도 무효를 유효로 표시하지는 않는 쪽으로 간다
   - Cloud SQL 인스턴스 ID 상한 **67**(`project-id:instance-id` 합 98 − 최장 project ID 30 − 1) · 끝 영숫자 요구
   - GCS 버킷은 점이 있으면 222자까지 되지만 **63** 으로 둔다(엔진은 점을 만들지 않는다) · 연속 점 `..` 거부
   - Azure VM(Linux · Windows)은 **호스트명 규칙** — 영숫자 시작 · 점 전부 거부. ARM 이 허용하는 다른 기호는 거부될 수 있다
   - AWS Name 태그는 UTF-16 길이(1~256)로 잰다 — 이모지 같은 보조 평면 문자에서만 더 엄격하다
   - Azure 리소스 그룹은 보조 평면 문자(U+10000 이상)를 거부한다
3. **호출 통계는 근사치다** (D16) — Cloudflare KV 일자 카운터는 read-modify-write 라 동시 요청에서 한 건을 잃을 수 있고, 같은 키 쓰기 제한에 걸린 건은 버려진다. 정확한 집계는 Axiom 이벤트로 한다

### Terraform 예제

[examples/terraform/](examples/terraform/README.md) — `data "http"` 로 `/v1/generate` 를 불러 받은 이름 · 라벨로 `google_compute_instance` 를 만든다. `valid` 가 `true` 이고 라벨 위반이 없을 때만 apply 된다.

### 로컬 개발

Node 는 `.nvmrc`(22)를 따른다. 명령은 위 [Local development](#local-development) 와 같고, 정본은 `package.json` `scripts` · 자세한 내용은 [docs/개발환경.md](docs/개발환경.md) 다.
