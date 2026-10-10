# Cloudonym

Multi-cloud resource naming engine — **Google Cloud** in this release, with AWS and Azure in the rule table and planned for later releases. From five context values (owner · system · purpose · env · region) it **generates, corrects and validates** resource names against each provider's physical constraints — a web UI for people, and `/v1/generate` · `/v1/names` · `/v1/validate` · `/llms.txt` · `/openapi.json` · `/catalog.json` for AI coding agents and IaC. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

[한국어](#한국어)

![Cloudonym web UI — four steps: cloud, naming context, resource tree and generated names](docs/screenshots/01-desktop-light.png)

## Usage in four steps (web UI)

1. **① Cloud** — GCP is selected for you. AWS and Azure are shown as **Coming soon** and cannot be picked yet.
2. **② Context** — type **Owner · System · Purpose** (at most 64 characters each), pick **Environment**, and pick a **Region** (searching by a zone name also finds its region). Names are regenerated as you type.
3. **③ Resources** — a tree of the provider's resources, grouped by the scope in which the provider requires a name to be unique. Search by name, id, Terraform type, gcloud group or alias, filter by category, or show the selected rows only. Each row has an ⓘ with a one-line description and where the name is entered (gcloud flag or Terraform argument); rows marked **API only** have no gcloud command or Terraform resource and are created through the API. Tick a resource and set how many you need (1–99, numbered `01`…`99`); resources without a sequence number are always one, and identity-like resources take a short role (`sync` by default). A row that covers several scopes (for example a regional and a global address) asks for the scope first, and some rows take a **kind** (for example the Cloud SQL engine).
4. **④ Names** — only the picked resources, grouped by scope, each with `PASS`/`FAIL` and why it was shortened or transformed. Copy one name, **all valid names** (one per line), the **names JSON** or **Terraform locals** (names and tags). The **Tags · Labels** panel copies the provider's standard tags as JSON. Two picked resources that would get the same name in the same scope are both marked `FAIL` (`name.conflict`).

One line above the names says what **PASS** means (see [What PASS means](#what-pass-means)). The footer shows the engine and rules versions; a share link made with older rules shows a notice until you change the input.

Allowed values — env: `prod` · `stg` · `dev` · `sbx` (aliases such as `prd`, `production`, `staging` are accepted and normalised) · region: a region or a zone of the provider, by name or by code (`asia-northeast3`, `asia-northeast3-a`, `ane3`, `ane3a`), or `global` — a zone is accepted and resolved to its region (names carry the region code, never a zone), and global resources carry no region token. The old country values `kr`, `us`, `jp` and `eu` are rejected with the matching region names. The region table is in `/llms.txt` and on the naming guide page `/docs/naming`.

### Share URL — your input is readable by anyone with the link

The page keeps its state (the five values, the provider and the selection) in the URL hash, and **Share URL** copies that link. The hash is written to the address bar as you type, even if you never press the button. It is **Base64, not encryption**: anyone who gets the link can decode it and read owner, system, purpose and the rest. Do not enter sensitive values such as internal company or project names if you plan to share the link. The page shows the same warning next to the button.

### Screenshots

| | |
|---|---|
| [Desktop, light](docs/screenshots/01-desktop-light.png) | GCP, four resources picked (the tree shows the selected rows only) |
| [Mobile, 360 px](docs/screenshots/02-mobile-360.png) | The same selection on a narrow screen, with the bar that jumps to the names |
| [Desktop, dark](docs/screenshots/03-desktop-dark.png) | The same share link opened in dark mode |
| [FAIL cards](docs/screenshots/04-fail-card.png) | A `system` made only of symbols — every name fails with the reason and cannot be copied |
| [Naming guide](docs/screenshots/05-naming-guide.png) | `/docs/naming` — formulas, tokens, region codes, abbreviations and kind tokens, generated from the same data as the engine |

## API in three lines

There is no public domain yet — replace `https://<your-deployment>` with your Worker URL (or the URL `npm run dev` prints).

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/names -H 'content-type: application/json' \
  -d '{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"resources":[{"type":"vpc_network"},{"type":"compute_instance","count":2},{"type":"cloud_sql_instance","kind":"POSTGRES"},{"type":"service_account","role":"db"}]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"gcp","resource_type":"storage_bucket","name":"Payments-Prod-Bucket"}'
```

`/v1/generate` returns a name for **every** resource type of the requested providers; `/v1/names` returns names only for the resources you pick, as many as you ask for. `providers` is optional (default: the enabled providers — `gcp` in this release); `aws` or `azure` is `400 request.provider_not_enabled` with `supported: ["gcp"]`. Response of `/v1/generate`, trimmed to one resource:

```json
{
  "success": true,
  "version": { "engine": "0.1.0", "rules": "2026-10-10.5" },
  "data": {
    "gcp": {
      "compute_instance": {
        "name": "payments-batch-prod-ane3-gce-01",
        "valid": true,
        "is_truncated": false,
        "is_transformed": false,
        "original": "payments-batch-prod-ane3-gce-01",
        "violations": [],
        "steps": [],
        "rule": {
          "min_length": 1,
          "max_length": 63,
          "pattern": "^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$",
          "pattern_flags": "",
          "allowed": "lower-digit-hyphen",
          "doc_url": "https://docs.cloud.google.com/compute/docs/naming-resources",
          "notes": [
            { "code": "note.gcp_vm_project_unique", "message": "VM names must be unique across the project unless its vmDnsSetting is ZonalOnly, so this rule is placed at project scope although the API path is zones/{zone}/instances" }
          ]
        }
      }
    }
  },
  "metadata": {
    "generated_labels": { "gcp": { "owner": "platform", "system": "payments", "purpose": "batch", "environment": "prod", "managed_by": "cloudonym" } },
    "label_violations": { "gcp": [] },
    "label_transformed": { "gcp": [] },
    "transformed": [
      { "code": "context.normalized", "field": "region", "params": { "from": "asia-northeast3-a", "to": "ane3" }, "message": "region 'asia-northeast3-a' normalised to 'ane3'" }
    ]
  }
}
```

`/v1/generate` is the whole catalogue with default inputs, so some rows always come back `valid: false` there: the resource policy needs a kind (`name.kind_required`) and Cloud Functions 1st and 2nd gen share one name space and get the same name (`name.conflict` on both). Use `/v1/names` with `kind` for the resource policy.

Response of `/v1/names`, trimmed to two of the five items (`rule` and `metadata` have the same shape as above):

```json
{
  "success": true,
  "version": { "engine": "0.1.0", "rules": "2026-10-10.5" },
  "data": {
    "gcp": {
      "valid": true,
      "items": [
        {
          "key": "compute_instance_02",
          "resource_type": "compute_instance",
          "seq": "02",
          "scope": "gcp:project",
          "uniqueness": "csp",
          "name": "payments-batch-prod-ane3-gce-02",
          "valid": true,
          "is_truncated": false,
          "is_transformed": false,
          "original": "payments-batch-prod-ane3-gce-02",
          "violations": [],
          "steps": [],
          "rule": { "min_length": 1, "max_length": 63, "…": "…" }
        },
        {
          "key": "cloud_sql_instance_01",
          "resource_type": "cloud_sql_instance",
          "seq": "01",
          "kind": "POSTGRES",
          "kind_token": "pg",
          "scope": "gcp:project",
          "uniqueness": "csp",
          "name": "payments-batch-prod-ane3-sql-pg-01",
          "valid": true,
          "…": "…"
        }
      ],
      "conflicts": []
    }
  },
  "metadata": { "generated_labels": { "gcp": { "owner": "platform", "system": "payments", "purpose": "batch", "environment": "prod", "managed_by": "cloudonym" } }, "…": "…" }
}
```

`resources` — `count` 1–99 (default 1) on rules with a sequence number, `role` (`^[a-z0-9]{2,16}$`, default `sync`) on rules with a role, `kind` (a value name such as `POSTGRES`, listed per rule in `/llms.txt` and `/catalog.json`) on rules with kinds; at most 200 items and 200 names per request, no type twice. A kind that equals the provider default adds no token. `scope` is the uniqueness scope the name belongs to and `uniqueness: "none"` means the provider enforces none (AWS `Name` tags, not enabled yet). One request is treated as one instance of the parent scope: two items that would get the same name are both `valid: false` with `name.conflict`, and `conflicts` summarises them.

Response of `/v1/validate`:

```json
{
  "valid": false,
  "version": { "engine": "0.1.0", "rules": "2026-10-10.5" },
  "violations": [
    { "code": "name.pattern_mismatch", "params": { "pattern": "^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$" }, "message": "Does not match the allowed pattern ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$" }
  ],
  "suggested_name": "payments-prod-bucket"
}
```

**Messages.** `violations`, `steps`, `rule.notes`, `metadata.transformed`, `label_violations`, `label_transformed` and `errors` are all lists of `{ code, field?, params?, message }`. Branch on `code` (stable); show `message` (English, may be reworded between releases) to people. `params` holds the values used in the message. `jq '.violations[].message'` prints the reasons.

**Errors.** Every failure has the same shape — `{ "success": false, "errors": [{ code, field?, params?, message }], "supported"?: [...] }` (`supported` when a provider is unknown or not enabled, when a resource type, event or copy target is unknown, or when `providers` is not a non-empty array; an unknown kind lists the allowed values in `params.supported`). User values echoed in `params` are cut to 80 characters and control / bidirectional characters appear as `\uXXXX`. `400` malformed request, `404` unknown `/v1` path or method (`request.not_found`), `409` `rules_version` mismatch, `413` body over 16 KB, `429` over 60 requests per 60 seconds per client IP (POST `/v1/*`, GET `/llms.txt` and GET `/catalog.json` together, with `Retry-After: 60`), `500` unexpected error. `GET /v1/health` returns `{ "ok": true, "version": { … } }`.

**Input limits.** `owner`, `system` and `purpose` are at most **64 characters** each (`400 request.field_too_long` above that; the UI inputs stop at 64).

<a id="what-pass-means"></a>**What PASS means.** PASS / `valid: true` means the name satisfies the documented naming checks of this rules revision (length, pattern, reserved words). It does not mean the name is available or that you may create it — uniqueness, permissions, quotas and organisation policy are not checked. Generated names are not guaranteed unique: shortening can map two different contexts to the same name.

**Version and name stability.** Successful responses of `/v1/generate`, `/v1/names`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `rules` (`YYYY-MM-DD.N`) changes whenever the same input could produce a different name, verdict, suggestion or label. Cloudonym does not serve old rules revisions — keep the names you created. Send `"rules_version": "<rules>"` to be told with a `409 request.rules_version_mismatch` instead of silently getting a different name. The [Terraform example](examples/terraform/README.md) shows `ignore_changes` and a pinned mode that skips the API.

## AI-agent integration

- **`GET /llms.txt`** — engine and rules version, naming formulas, canonical values with aliases, the region codes and the zones they accept, kind tokens, abbreviations with their sources, every rule's length · pattern · forbidden words · notes · doc link, the resource tree per provider, what PASS means, and the API summary. It is built from the rule table and the catalog, so it never drifts from the engine.
- **`GET /openapi.json`** — OpenAPI 3.0.3 for `/v1/generate`, `/v1/names`, `/v1/validate`, `/v1/events`, `/v1/health` and `/catalog.json`, including every error status. The test suite validates real responses against it.
- **`GET /catalog.json`** — the resource catalog and region table of the enabled providers as JSON: one row per screen row with its rule ids, abbreviation, kinds and tokens, region-token kind, description, where the name is entered and search aliases, plus `version: { engine, rules }`. The source is `catalog/*.json` in this repository (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **`/docs/naming`** — the same data as a page for people: formulas, tokens, the region table, how names are shortened, abbreviations and kind tokens.

Point your agent at `https://<your-deployment>/llms.txt`; paths in it are relative to the host that served it.

## Supported resources (121 rules)

**GCP 121** rules are enabled in this release (rules revision `2026-10-10.5`; counted from the engine's rule table and matching the rule list in `/llms.txt`). **AWS 169 · Azure 377** — in the rule table, not enabled yet: the engine and its tests cover them, but the UI, the API, `/llms.txt` and `/catalog.json` do not offer them.

The 35 hand-written rules below (the AWS and Azure rows among them are not enabled yet) are each checked against the official document linked. On top of them, **332 Azure rules** are imported from the formal rows of the [Azure naming rules table](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules) (generated by `scripts/rules/build-azure-rules.mjs`) **82 GCP rules** from the [Compute Engine](https://www.googleapis.com/discovery/v1/apis/compute/v1/rest) and [Cloud KMS](https://www.googleapis.com/discovery/v1/apis/cloudkms/v1/rest) discovery documents (generated by `scripts/rules/build-gcp-rules.mjs`), and **116 AWS rules** from the [CloudFormation resource schemas](https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip) — 23 physical names with a schema pattern and length, and 93 `Name` tags (generated by `scripts/rules/build-aws-rules.mjs`); `/llms.txt` lists every rule, and the rows not imported yet are in [docs/azure-intake-held.md](docs/azure-intake-held.md) (29 rows), [docs/gcp-intake-held.md](docs/gcp-intake-held.md) (10 discovery methods, and the 26 of the 116 supported GCP asset types that have no rule: 8 held, 13 with no user-chosen name, 5 named outside this engine) and [docs/aws-intake-held.md](docs/aws-intake-held.md) (33 types). A further **30 GCP rules**, **42 AWS rules** and **30 Azure rules** were added by hand after reading each REST or API reference, product guide or naming-rules row again (`src/core/rules/gcp-manual.ts`, `src/core/rules/aws-manual.ts`, `src/core/rules/azure-manual.ts`, with the source sentence quoted above each rule).

Every limit is checked against the official document linked below. The line-by-line comparison is in [docs/rule-verification.md](docs/rule-verification.md).

| Provider | `resource_type` | Length | Official doc |
|---|---|---|---|
| GCP | `project_id` | 6–30 | [link](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers) |
| GCP | `service_account` | 6–30 | [link](https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create) |
| GCP | `compute_instance` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/naming-resources) |
| GCP | `vpc_network` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks#Network.FIELDS.name) |
| GCP | `subnet` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/subnetworks#Subnetwork.FIELDS.name) |
| GCP | `cloud_sql_instance` | 1–67 | [link](https://docs.cloud.google.com/sql/docs/mysql/instance-settings) |
| GCP | `storage_bucket` | 3–63 | [link](https://docs.cloud.google.com/storage/docs/buckets#naming) |
| GCP | `firewall_rule` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/firewalls#Firewall.FIELDS.name) |
| GCP | `disk` | 1–63 | [link](https://docs.cloud.google.com/compute/docs/reference/rest/v1/disks#Disk.FIELDS.name) |
| AWS | `s3_bucket` | 3–63 | [link](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html) |
| AWS | `iam_role` | 1–64 | [link](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html) |
| AWS | `vpc` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `subnet` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `ec2_instance` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `rds_instance` | 1–63 | [link](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBInstance.html) |
| AWS | `internet_gateway` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `route_table` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
| AWS | `security_group` | 1–255 | [link](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html) |
| AWS | `key_pair` | 1–255 | [link](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateKeyPair.html) |
| AWS | `ebs_volume` (Name tag) | 1–256 | [link](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Using_Tags.html#tag-restrictions) |
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
| Azure | `public_ip` | 1–80 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftnetwork) |
| Azure | `network_security_group` | 1–80 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftnetwork) |
| Azure | `network_interface` | 1–80 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftnetwork) |
| Azure | `os_disk` (managed disk) | 1–80 | [link](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules#microsoftcompute) |

Tag/label limits (key · value): AWS 128 · 256, Azure 512 · 256, GCP 63 · 63.

## Limitations

Cloudonym does **not** replace the provider's final verdict. Decision numbers (D16, D19, D20) refer to [docs/decisions.md](docs/decisions.md).

1. **Only known reserved words** (decision D19). `forbidden` holds only strings the official documents state explicitly (e.g. `google`, `g00gle`, `goog` prefix for GCS). Other look-alike spellings and trademarks are not checked.
2. **Conservative limits** (D20). Where a document is ambiguous or a limit spans several fields, the engine is stricter than the provider — it may reject a valid name, but it must never mark an invalid one valid:
   - Cloud SQL instance ID capped at **67** (the 98-char `project-id:instance-id` total minus the longest project ID 30, minus 1), and it must end with a letter or digit.
   - GCS bucket kept at **63** even though dotted names may reach 222 (the engine never generates dots); consecutive dots `..` rejected.
   - Azure VM (Linux · Windows) follows **hostname** rules: must start with a letter or digit, and dots are rejected entirely. Other symbols that ARM accepts may be rejected.
   - AWS Name tags measured by UTF-16 length (1–256), stricter than code points only for supplementary-plane characters such as emoji.
   - Azure resource group rejects supplementary-plane characters (U+10000 and above).
3. **Usage counts are approximate** (D16). Cloudflare KV daily counters use read-modify-write, so concurrent requests can lose a count and writes over the per-key rate limit are dropped. Exact analytics come from Axiom events.

## Telemetry and privacy

The site and the API count usage without collecting what you type. Generated names, the five context values, the URL hash, the raw User-Agent, cookies and identifiers are never collected; each event records only its name, the time, a client class (`ai_agent`, `browser`, `cli` or `other`) and a few fixed fields such as which copy button was used. The client IP is read only as the key of Cloudflare's rate-limiting binding and is not stored. KV day counters expire after 366 days. The full list, retention and hosting details are on the site's `/privacy` page ([source](src/components/Privacy.tsx)); the decision is D56 in [docs/decisions.md](docs/decisions.md).

## Terraform example

[examples/terraform/](examples/terraform/README.md) calls `/v1/generate` from a `data "http"` block and creates a `google_compute_instance` with the returned name and labels. `apply` is blocked unless `valid` is `true` and there are no label violations. `ignore_changes = [name]` keeps an existing VM's name when the rules change, `rules_version` turns a rules change into a 409, and `pinned` skips the API with the name you already created. `instance_name` is the VM's real name; `cloudonym_candidate_name` is what the API proposes now.

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

Local secrets go in `.dev.vars` (template: `.dev.vars.example`). To run the last build (not the sources) locally, use `npm run build && npx wrangler dev --port 8799` — `wrangler dev` serves `dist/cloudonym/`, so run the build first or you will see stale code. Production secrets are set with `npx wrangler secret put AXIOM_API_KEY`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) — every commit is signed off under the [DCO](DCO) (`git commit -s`). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Project Status

Cloudonym is an independent open-source project created and maintained
by Sungjae Yun.

It is not affiliated with, sponsored by, or developed on behalf of any
current or former employer.

## License

Copyright 2026 Sungjae Yun.

Licensed under the Apache License, Version 2.0.
See the LICENSE file for details.

[LICENSE](LICENSE) · [NOTICE](NOTICE). The Apache License 2.0 covers the code only — the Cloudonym name and logo are covered by a separate [trademark policy](TRADEMARKS.md).

---

## 한국어

**Cloudonym** 은 클라우드 리소스 이름을 다섯 문맥값(owner · system · purpose · env · region)에서 각 CSP 의 물리 제약에 맞게 **생성 · 교정 · 검증**하는 엔진이다. 이번 릴리스는 **Google Cloud** 만 연다 — AWS · Azure 는 규칙 표에 있고 다음 릴리스에서 연다. 사람은 웹 화면으로, AI 코딩 에이전트와 IaC 는 `/v1/generate` · `/v1/names` · `/v1/validate` · `/llms.txt` · `/openapi.json` · `/catalog.json` 으로 쓴다. 바뀐 점은 [CHANGELOG.md](CHANGELOG.md)(영어)에 있다.

### 네 단계 사용법 (웹 화면)

1. **① Cloud** — GCP 가 골라져 있다. AWS · Azure 는 **Coming soon** 표지와 함께 보이고 아직 고를 수 없다
2. **② Context** — **Owner · System · Purpose** 를 적고(각 64자까지) **Environment** 를 고르고, **Region** 을 고른다(존 이름으로 찾아도 그 리전이 나온다). 입력하는 대로 이름이 다시 만들어진다
3. **③ Resources** — CSP 가 이름을 유일하게 요구하는 범위로 묶은 리소스 트리다. 이름 · id · Terraform 타입 · gcloud 그룹 · 별칭으로 찾고, 분류로 거르고, 고른 행만 볼 수 있다. 행마다 ⓘ 에 한 줄 설명과 이름을 넣는 자리(gcloud 플래그 · Terraform 인자)가 있고, **API only** 표지가 붙은 행은 gcloud 명령 · Terraform 리소스가 없어 API 로 만든다. 체크하고 개수(1~99 · 순번 `01`…`99`)를 정한다. 순번이 없는 리소스는 늘 하나이고, ID 성격의 리소스는 짧은 역할(기본 `sync`)을 받는다. 범위가 여럿인 행(지역 주소와 전역 주소 등)은 범위부터 고르고, 어떤 행은 **종류**(Cloud SQL 엔진 등)를 받는다
4. **④ Names** — 고른 리소스만 범위별로 보이고, 카드마다 `PASS`/`FAIL` 과 줄이거나 바꾼 이유가 나온다. 이름 하나 · **유효한 이름 전부**(한 줄에 하나) · **이름 JSON** · **Terraform locals**(이름 + 태그)를 복사한다. **Tags · Labels** 칸은 CSP 표준 태그를 JSON 으로 복사한다. 같은 범위에서 같은 이름이 될 두 리소스는 둘 다 `FAIL`(`name.conflict`)이다

이름 위 한 줄이 **PASS** 의 뜻을 말한다(쓸 수 있는지 · 고유한지는 검사하지 않는다). 꼬리말에 엔진 · 규칙 버전이 있고, 옛 규칙으로 만든 공유 링크는 입력을 바꿀 때까지 안내를 보인다.

**공유 URL 주의** — 화면 상태(다섯 값 · CSP · 선택)는 URL hash 에 있고 **Share URL** 은 그 링크를 복사한다. hash 는 버튼을 누르지 않아도 입력하는 대로 주소창에 쓰인다. **Base64 는 암호화가 아니다** — 링크를 받은 사람은 owner · system · purpose 등 입력값을 그대로 읽는다. 링크를 넘길 생각이면 회사 내부 이름 같은 민감한 값을 넣지 않는다. 화면도 버튼 옆에 같은 경고를 보인다.

스크린샷 — [데스크톱 밝은 화면](docs/screenshots/01-desktop-light.png) · [폭 360px](docs/screenshots/02-mobile-360.png) · [데스크톱 어두운 화면](docs/screenshots/03-desktop-dark.png) · [FAIL 카드](docs/screenshots/04-fail-card.png) · [이름 안내](docs/screenshots/05-naming-guide.png).

허용값 — env: `prod` · `stg` · `dev` · `sbx`(`prd` · `production` · `staging` 같은 별칭도 받아 표준값으로 바꾼다) · region: 그 CSP 의 리전 · 존을 이름이나 코드로(`asia-northeast3` · `asia-northeast3-a` · `ane3` · `ane3a`) 또는 `global` — 존은 받아 그 리전으로 푼다(이름에는 리전 코드만 들고 존은 들지 않는다). 전역 리소스에는 지역 토큰이 없다. 옛 나라 값 `kr` · `us` · `jp` · `eu` 는 거부하고 해당 리전 이름을 알려 준다. 지역 표는 `/llms.txt` 와 이름 안내 쪽 `/docs/naming` 에 있다.

### API 세 줄

아직 공개 도메인이 없다. `https://<your-deployment>` 를 배포한 Worker 의 URL(또는 `npm run dev` 가 찍는 URL)로 바꾼다. 요청 · 응답 예시는 위 [API in three lines](#api-in-three-lines) 와 같다.

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/names -H 'content-type: application/json' \
  -d '{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"resources":[{"type":"vpc_network"},{"type":"compute_instance","count":2},{"type":"cloud_sql_instance","kind":"POSTGRES"},{"type":"service_account","role":"db"}]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"gcp","resource_type":"storage_bucket","name":"Payments-Prod-Bucket"}'
```

`providers` 는 생략할 수 있다(기본은 켜진 CSP — 이번 릴리스는 `gcp`). `aws` · `azure` 는 `400 request.provider_not_enabled` 이고 `supported: ["gcp"]` 가 실린다. `/v1/generate` 는 고른 CSP 의 **모든** 리소스 종류에 이름을 하나씩 주고, `/v1/names` 는 **고른 리소스만** 요청한 개수만큼 준다.

- **`/v1/generate` 에서 늘 FAIL 인 행** — 기본 입력으로 전체 목록을 만들기 때문이다. 리소스 정책은 종류가 필요하고(`name.kind_required`), Cloud Functions 1세대 · 2세대는 이름공간이 하나라 같은 이름이 되어 둘 다 `name.conflict` 다. 리소스 정책은 `/v1/names` 에 `kind` 를 넣어 만든다
- **`/v1/names`** — `resources` 의 `count` 는 순번이 있는 규칙에만 1~99(기본 1), `role` 은 역할 규칙에만 `^[a-z0-9]{2,16}$`(기본 `sync`), `kind` 는 종류가 있는 규칙에만 값 이름(`POSTGRES` 등 — 규칙별 목록은 `/llms.txt` · `/catalog.json`)이다. CSP 기본값과 같은 종류는 토큰을 붙이지 않는다. 한 요청에 항목 200개 · 이름 200개까지, 같은 종류는 한 번만. 항목마다 `scope`(이름이 유일해야 하는 범위)와 `uniqueness`(`none` 이면 CSP 가 유일성을 매기지 않는다 — AWS `Name` 태그, 아직 켜지지 않음)가 실린다. 한 요청은 부모 범위 하나로 본다 — 같은 이름이 될 두 항목은 둘 다 `valid: false` · `name.conflict` 이고 `conflicts` 가 요약한다
- **입력 상한** — `owner` · `system` · `purpose` 는 각 **64자**까지다(넘으면 `400 request.field_too_long` · 화면 입력은 64자에서 멈춘다)

- **메시지** — `violations` · `steps` · `rule.notes` · `metadata.transformed` · 라벨 위반 · 라벨 변환 · `errors` 는 전부 `{ code, field?, params?, message }` 목록이다. 분기는 `code`(바뀌지 않는다)로, 사람에게는 `message`(영어 · 문구는 다듬어질 수 있다)를 보인다
- **오류** — 모든 실패가 `{ "success": false, "errors": [...], "supported"?: [...] }` 한 꼴이다. `supported` 는 provider 가 모르는 값이거나 켜지지 않았을 때, resource type · event · 복사 target 이 모르는 값일 때, `providers` 가 비지 않은 배열이 아닐 때 실린다(모르는 종류는 `params.supported` 에 허용 값이 실린다). `params` 에 되돌려 싣는 사용자 값은 80자로 자르고 제어 · 양방향 문자는 `\uXXXX` 로 보인다. `400` 요청 모양 오류 · `404` `/v1` 아래 없는 경로 · 메서드(`request.not_found`) · `409` `rules_version` 불일치 · `413` 본문 16KB 초과 · `429` 클라이언트 IP 당 60초 60건 초과(POST `/v1/*` · GET `/llms.txt` · GET `/catalog.json` 합산 · `Retry-After: 60`) · `500` 내부 오류. `GET /v1/health` 는 `{ "ok": true, "version": {…} }`
- **PASS 의 뜻** — 이 규칙 버전의 이름 검사(길이 · 형식 · 예약어)를 통과했다는 뜻이다. 그 이름을 쓸 수 있다는 뜻이 아니다 — 고유성 · 권한 · 할당량 · 조직 정책은 검사하지 않고, 축소 때문에 서로 다른 문맥이 같은 이름이 될 수 있다
- **버전 · 이름 안정성** — `/v1/generate` · `/v1/names` · `/v1/validate` · `/v1/health` 의 성공 응답에 `version: { engine, rules }` 가 실린다(실패와 `/v1/events` 에는 없다). `rules`(`YYYY-MM-DD.N`)는 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있는 변경마다 오른다. 옛 규칙 버전은 서빙하지 않는다 — 만든 이름을 그대로 쓴다. 요청에 `"rules_version"` 을 넣으면 규칙이 바뀌었을 때 다른 이름 대신 `409` 를 받는다

### AI 에이전트 연동

- **`GET /llms.txt`** — 엔진 · 규칙 버전 · 이름 공식 · 표준값과 별칭 · 리전 코드와 받는 존 · 종류 토큰 · 약어와 그 출처 · 규칙마다 길이 · pattern · 금지어 · 설명 · 문서 링크 · CSP 별 리소스 트리 · PASS 의 뜻 · API 요약. 규칙 표와 catalog 에서 만들므로 엔진과 어긋나지 않는다
- **`GET /openapi.json`** — `/v1/generate` · `/v1/names` · `/v1/validate` · `/v1/events` · `/v1/health` · `/catalog.json` 의 OpenAPI 3.0.3. 시험이 실제 응답을 이 명세로 검증한다
- **`GET /catalog.json`** — 켜진 CSP 의 리소스 catalog 와 지역 표(JSON). 화면 행마다 규칙 id · 약어 · 종류와 토큰 · 지역 토큰 종류 · 설명 · 이름 넣는 자리 · 검색 별칭과 `version: { engine, rules }`. 정본은 이 저장소의 `catalog/*.json` 이다([CONTRIBUTING.md](CONTRIBUTING.md))
- **`/docs/naming`** — 같은 데이터를 사람이 읽는 쪽으로 — 이름 공식 · 토큰 · 지역 표 · 축소 방법 · 약어 · 종류 토큰

### 지원 리소스

이번 릴리스에서 켠 것은 **GCP 121** 개 규칙이다(규칙 버전 `2026-10-10.5` · 엔진의 규칙 표에서 세고 `/llms.txt` 의 규칙 목록과 대어 본 값). **AWS 169 · Azure 377** 은 규칙 표에 있지만 아직 켜지 않았다 — 엔진과 시험은 셋을 다 돌리고, 화면 · API · `/llms.txt` · `/catalog.json` 은 GCP 만 내놓는다. 손으로 쓴 35개의 표와 공식 문서 링크는 위 [Supported resources](#supported-resources-121-rules) 에 있다. Azure 332개는 Azure 이름 규칙 표의 정형 행에서(`scripts/rules/build-azure-rules.mjs`), GCP 82개는 Compute Engine · Cloud KMS 디스커버리 문서의 정형 행에서(`scripts/rules/build-gcp-rules.mjs`), AWS 116개(물리 이름 23 · Name 태그 93)는 CloudFormation 리소스 스키마에서(`scripts/rules/build-aws-rules.mjs`) 들였다. 전체 목록은 `/llms.txt`, 아직 들이지 않은 행은 [docs/azure-intake-held.md](docs/azure-intake-held.md)(29행) · [docs/gcp-intake-held.md](docs/gcp-intake-held.md)(디스커버리 메서드 10행, 그리고 지원 범위 GCP 자산 유형 116종 가운데 규칙이 없는 26종 — 보류 8 · 사람이 짓는 이름 없음 13 · 이 엔진 밖에서 정해지는 이름 5) · [docs/aws-intake-held.md](docs/aws-intake-held.md)(33 타입) 에 있다. 생성기가 정형으로 읽지 못한 행 가운데 GCP 30개 · AWS 42개 · Azure 30개는 REST · API 참조와 제품 안내서, Azure 이름 규칙 표를 다시 읽고 손으로 넣었다(`src/core/rules/gcp-manual.ts` · `src/core/rules/aws-manual.ts` · `src/core/rules/azure-manual.ts`, 규칙마다 원문 인용). 손으로 쓴 규칙마다 공식 문서와 대조한 기록은 [docs/rule-verification.md](docs/rule-verification.md)(영어) 다.

### 한계

Cloudonym 의 판정은 **CSP 의 최종 판정을 대신하지 않는다.** 결정 번호(D16 · D19 · D20)는 [docs/decisions.md](docs/decisions.md) 에 있다.

1. **알려진 예약어만 검사한다** (D19) — 공식 문서에 명시된 문자열(`google` · `g00gle` · GCS 의 `goog` 접두 등)만 막는다. 그 밖의 유사 철자와 상표는 보지 않는다
2. **한도를 보수적으로 잡는다** (D20) — 유효한 이름을 거부할 수는 있어도 무효를 유효로 표시하지는 않는 쪽으로 간다
   - Cloud SQL 인스턴스 ID 상한 **67**(`project-id:instance-id` 합 98 − 최장 project ID 30 − 1) · 끝 영숫자 요구
   - GCS 버킷은 점이 있으면 222자까지 되지만 **63** 으로 둔다(엔진은 점을 만들지 않는다) · 연속 점 `..` 거부
   - Azure VM(Linux · Windows)은 **호스트명 규칙** — 영숫자 시작 · 점 전부 거부. ARM 이 허용하는 다른 기호는 거부될 수 있다
   - AWS Name 태그는 UTF-16 길이(1~256)로 잰다 — 이모지 같은 보조 평면 문자에서만 더 엄격하다
   - Azure 리소스 그룹은 보조 평면 문자(U+10000 이상)를 거부한다
3. **호출 통계는 근사치다** (D16) — Cloudflare KV 일자 카운터는 read-modify-write 라 동시 요청에서 한 건을 잃을 수 있고, 같은 키 쓰기 제한에 걸린 건은 버려진다. 정확한 집계는 Axiom 이벤트로 한다

### 계측 · 개인정보

화면과 API 는 입력한 값을 모으지 않고 사용량만 센다. 생성한 이름 · 다섯 문맥값 · URL hash · User-Agent 원문 · 쿠키 · 식별자는 모으지 않고, 이벤트마다 이름 · 시각 · 클라이언트 구분(`ai_agent` · `browser` · `cli` · `other`) · 정해진 몇 필드(어느 복사 버튼인가 등)만 남긴다. 클라이언트 IP 는 Cloudflare 요청 제한 바인딩의 키로만 읽고 저장하지 않는다. KV 일자 카운터는 366일 뒤 만료된다. 전체 목록 · 보존 · 호스팅은 사이트의 `/privacy` 쪽에 있다([소스](src/components/Privacy.tsx)) — 결정은 [docs/decisions.md](docs/decisions.md) 의 D56.

### Terraform 예제

[examples/terraform/](examples/terraform/README.md) — `data "http"` 로 `/v1/generate` 를 불러 받은 이름 · 라벨로 `google_compute_instance` 를 만든다. `valid` 가 `true` 이고 라벨 위반이 없을 때만 apply 된다. `ignore_changes = [name]` 이 규칙이 바뀌어도 기존 VM 이름을 지키고, `rules_version` 은 규칙 변경을 409 로 알리고, `pinned` 는 이미 만든 이름으로 API 를 건너뛴다.

### 로컬 개발

Node 는 `.nvmrc`(22)를 따른다. 명령은 위 [Local development](#local-development) 와 같고, 정본은 `package.json` `scripts` 다. 빌드 산출물을 로컬에서 돌리려면 `npm run build && npx wrangler dev --port 8799`(빌드 없이 돌리면 옛 코드를 본다).

### 기여 · 보안

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md) 다 — 모든 commit 에 [DCO](DCO) 서명(`git commit -s`)을 단다. 취약점은 [SECURITY.md](SECURITY.md) 대로 비공개로 신고한다.

### 프로젝트 상태

Cloudonym 은 Sungjae Yun 이 만들고 관리하는 독립 오픈소스 프로젝트다. 현재 · 이전 어느 고용주와도 관계가 없고, 후원을 받지 않으며, 고용주를 위해 개발한 것이 아니다.

### 라이선스

Copyright 2026 Sungjae Yun. Apache License 2.0 으로 배포한다 — 전문은 [LICENSE](LICENSE), 고지는 [NOTICE](NOTICE) 다. 라이선스는 코드에만 적용되고, Cloudonym 이름과 로고는 별도의 [상표 정책](TRADEMARKS.md)을 따른다.
