# API and AI-agent integration

[Back to README](../README.md) · [한국어](#한국어)

## API in three lines

Replace `https://<your-deployment>` with the URL of the deployed site, or of a Worker you deployed yourself (or the URL `npm run dev` prints). The site's `/docs/api` page has the same guide, with every endpoint, a curl example built from `/openapi.json` and the rate limit.

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/names -H 'content-type: application/json' \
  -d '{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"resources":[{"type":"vpc_network"},{"type":"compute_instance","count":2},{"type":"cloud_sql_instance","kind":"POSTGRES"},{"type":"service_account","role":"db"}]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"gcp","resource_type":"storage_bucket","name":"Payments-Prod-Bucket"}'
```

`/v1/generate` returns a name for **every** resource type of the requested providers; `/v1/names` returns names only for the resources you pick, as many as you ask for. `providers` is optional (default: the enabled providers — `aws` and `gcp` in this release — whose region table resolves `context.region`, so `asia-northeast3-a` gives `gcp` only; when none resolves it, all enabled providers and the region error); `azure` is `400 request.provider_not_enabled` with `supported: ["aws", "gcp"]`. Response of `/v1/generate`, trimmed to one resource:

```json
{
  "success": true,
  "version": { "engine": "0.2.0", "rules": "2026-10-24.1" },
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
  "version": { "engine": "0.2.0", "rules": "2026-10-24.1" },
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

`resources` — `count` 1–99 (default 1) on rules with a sequence number, `role` (`^[a-z0-9]{2,16}$`, default `sync`) on rules with a role, `kind` (a value name such as `POSTGRES`, listed per rule in `/llms.txt` and `/catalog.json`) on rules with kinds; at most 200 items and 200 names per request, no type twice. A kind that equals the provider default adds no token. `scope` is the uniqueness scope the name belongs to and `uniqueness: "none"` means the provider enforces none (AWS `Name` tags). One request is treated as one instance of the parent scope: two items that would get the same name are both `valid: false` with `name.conflict`, and `conflicts` summarises them.

Response of `/v1/validate`:

```json
{
  "valid": false,
  "version": { "engine": "0.2.0", "rules": "2026-10-24.1" },
  "violations": [
    { "code": "name.pattern_mismatch", "params": { "pattern": "^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$" }, "message": "Does not match the allowed pattern ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$" }
  ],
  "suggested_name": "payments-prod-bucket"
}
```

**Messages.** `violations`, `steps`, `rule.notes`, `metadata.transformed`, `label_violations`, `label_transformed` and `errors` are all lists of `{ code, field?, params?, message }`. Branch on `code` (stable); show `message` (English, may be reworded between releases) to people. `params` holds the values used in the message. `jq '.violations[].message'` prints the reasons.

**Errors.** Every failure has the same shape — `{ "success": false, "errors": [{ code, field?, params?, message }], "supported"?: [...] }` (`supported` when a provider is unknown or not enabled, when a resource type, event or copy target is unknown, or when `providers` is not a non-empty array; an unknown kind lists the allowed values in `params.supported`). User values echoed in an error (`params.value`, `params.requested` and the `message`) are cut to 40 characters followed by `…`, and control / bidirectional characters appear as `\uXXXX`; lists such as `supported` are never cut. `400` malformed request, `404` unknown `/v1` path or method (`request.not_found`), `409` `rules_version` mismatch, `413` body over 32 KB (32,768 bytes), `429` over 60 requests per 60 seconds per client IP (POST `/v1/*`, GET `/llms.txt` and GET `/catalog.json` together, with `Retry-After: 60`), `500` unexpected error. A `POST /v1/wizard` or `POST /v1/generate` 400 lists at most the first 50 errors; when there are more, the last entry is `request.errors_truncated` with `params: { shown, total }`. Other routes list every error. `GET /v1/health` returns `{ "ok": true, "version": { … } }`.

**Input limits.** `owner`, `system` and `purpose` are at most **64 characters** each (`400 request.field_too_long` above that; the UI inputs stop at 64).

<a id="what-pass-means"></a>**What PASS means.** PASS / `valid: true` means the name satisfies the documented naming checks of this rules revision (length, pattern, reserved words). It does not mean the name is available or that you may create it — uniqueness, permissions, quotas and organisation policy are not checked. Generated names are not guaranteed unique: shortening can map two different contexts to the same name.

**Version and name stability.** Successful responses of `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `rules` (`YYYY-MM-DD.N`) changes whenever the same input could produce a different name, verdict, suggestion or label. Cloudonym does not serve old rules revisions — keep the names you created. Send `"rules_version": "<rules>"` to be told with a `409 request.rules_version_mismatch` instead of silently getting a different name. The [Terraform example](../examples/terraform/README.md) shows `ignore_changes` and a pinned mode that skips the API.

<a id="whole-project-post-v1wizard"></a>
### Whole project: `POST /v1/wizard`

```sh
curl -s -X POST https://<your-deployment>/v1/wizard -H 'content-type: application/json' \
  -d '{"provider":"gcp","project":{"owner":"platform","system":"billing","env":"prod","region":"asia-northeast3"},"project_picks":[{"preset":"vpc","instances":[{"id":"n1","seq":"01"}]}],"services":[{"purpose":"shop","picks":[{"preset":"web","instances":[{"id":"a","seq":"01","attach":{"boot":true,"data":["01"]}}]},{"preset":"db","kind":"POSTGRES","instances":[{"id":"b","seq":"01"}]}]},{"purpose":"pay","picks":[{"preset":"web","ha":true,"instances":[{"id":"c","seq":"01"},{"id":"d","seq":"02"}]}]}]}'
```

One request is one project. `project` holds four values (no `purpose`), `project_picks` the project-level resources, and each entry of `services` a `purpose` and its `picks`. A pick is a `preset` (`web`, `was`, `bastion`, `file`, `db`, `object`, `run`, `sa`, `secret`, `gke`, `wip`, `bq`, `ar`, `topic`, `sub`, `dlq`, `dlqsub`, `build`, `conn`, `repo`, `cron`, `runjob`, `redis`, `intweb`, `intwas`, `worker`, `raw`, `ingest`, `appdata`, the load balancer parts `ip`, `ig`, `bs`, `hc`, `url`, `cert`, `thps`, `fwd`, `urlredir`, `thp`, `fwdredir`, `neg`, `bb`, and the network presets `vpc`, `subnet`, `firewall`, `router`, `nat`, `psa`) or `"preset": null` with a `rule` id, plus optional `tier`, `kind`, `ha` and `serverless`. `instances` are the servers: each has an `id` you choose (`^[a-z0-9]{1,8}$`), a `seq` that stays its number, and `attach` (`boot`, `data`, `ip`, `ipi`) on resources that take attached resources. At most 20 services, 40 picks per service or in `project_picks`, and 200 names including the project ID. Response, trimmed to a server and its boot disk (8 items in all — the names listed under [Naming wizard](web-ui.md#naming-wizard)):

```json
{
  "success": true,
  "version": { "engine": "0.2.0", "rules": "2026-10-24.1" },
  "data": {
    "gcp": {
      "valid": true,
      "items": [
        {
          "key": "service/shop/compute_instance/-/web/01",
          "namespace": "shop",
          "resource_type": "compute_instance",
          "tier": "web",
          "seq": "01",
          "scope": "gcp:project",
          "uniqueness": "csp",
          "name": "billing-shop-prod-ane3-gce-web-01",
          "valid": true,
          "…": "…"
        },
        {
          "key": "service/shop/compute_instance/-/web/01/boot/-",
          "namespace": "shop",
          "parent": "service/shop/compute_instance/-/web/01",
          "attach": "boot",
          "resource_type": "disk",
          "scope": "gcp:project_zone",
          "uniqueness": "csp",
          "name": "billing-shop-prod-ane3-gce-web-01-boot",
          "valid": true,
          "…": "…"
        }
      ],
      "conflicts": []
    }
  },
  "metadata": {
    "generated_labels": {
      "gcp": {
        "project": { "owner": "platform", "system": "billing", "environment": "prod", "managed_by": "cloudonym" },
        "shop": { "owner": "platform", "system": "billing", "purpose": "shop", "environment": "prod", "managed_by": "cloudonym" },
        "pay": { "owner": "platform", "system": "billing", "purpose": "pay", "environment": "prod", "managed_by": "cloudonym" }
      }
    },
    "…": "…"
  }
}
```

Items come in order: the project ID, the project-level items, then each service, each server followed by its attached resources. `key` is a structured path (`service/shop/compute_instance/-/web/01/data/01`) that does not change when other items are added or removed; `parent` and `attach` mark an attached resource, and project-level items carry `"level": "project"`. Two items of the same uniqueness class with the same name anywhere in the project are both `valid: false` with `name.conflict`. A 400 names the offending element in `field` with the request names, for example `services[0].picks[0].instances[0].attach.data[1]`. `/v1/generate`, `/v1/names` and `/v1/validate` are unchanged.

## AI-agent integration

- **`GET /llms.txt`** — engine and rules version, naming formulas, canonical values with aliases, the region codes and the zones they accept, kind tokens, the tier token, attached resources and wizard presets, abbreviations with their sources, every rule's length · pattern · forbidden words · notes · doc link, the resource tree per provider, what PASS means, the API summary, the limits (body size, rate limit with `429` and `Retry-After`, field, item and error caps, echoed values), the plan file, the `/catalog.json` fields and the repository CLI (commands, server URL, exit codes). It is built from the rule table, the catalog and the server's constants, so it never drifts from the engine.
- **`GET /openapi.json`** — OpenAPI 3.0.3 for `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate`, `/v1/events`, `/v1/health` and `/catalog.json`, including every error status. The test suite validates real responses against it.
- **`GET /catalog.json`** — the resource catalog and region table of the enabled providers as JSON: one row per screen row with its rule ids, abbreviation, kinds and tokens, region-token kind, description, where the name is entered and search aliases, plus `version: { engine, rules }` and the standard environment values `env_values`; each rule also says what a wizard pick of it takes (`input`, `tier`, `locations`), and each provider lists the wizard `presets`, the `attachments` of a server slot and the request `limits` — what the CLI reads instead of keeping its own copy. The source is `catalog/*.json` in this repository (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
- **`/docs/naming`** — the same data as a page for people: formulas, tokens, the region table, how names are shortened, abbreviations, kind tokens, tiers, attached resources and the wizard presets.

Point your agent at `https://<your-deployment>/llms.txt`; paths in it are relative to the host that served it.

---

## 한국어

## API 세 줄

`https://<your-deployment>` 를 배포된 사이트의 URL, 또는 직접 배포한 Worker 의 URL(또는 `npm run dev` 가 찍는 URL)로 바꾼다. 사이트의 `/docs/api` 쪽에 같은 안내가 있다 — 엔드포인트 전부 · `/openapi.json` 에서 만든 curl 예제 · 요청 제한. 요청 · 응답 예시는 위 [API in three lines](#api-in-three-lines) 와 같다.

```sh
curl -s -X POST https://<your-deployment>/v1/generate -H 'content-type: application/json' \
  -d '{"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"providers":["gcp"]}'
curl -s -X POST https://<your-deployment>/v1/names -H 'content-type: application/json' \
  -d '{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3-a"},"resources":[{"type":"vpc_network"},{"type":"compute_instance","count":2},{"type":"cloud_sql_instance","kind":"POSTGRES"},{"type":"service_account","role":"db"}]}'
curl -s -X POST https://<your-deployment>/v1/validate -H 'content-type: application/json' \
  -d '{"provider":"gcp","resource_type":"storage_bucket","name":"Payments-Prod-Bucket"}'
```

`providers` 는 생략할 수 있다(기본은 켜진 CSP — 이번 릴리스는 `aws` · `gcp` — 가운데 `context.region` 을 지역 표로 풀 수 있는 것만이다. `asia-northeast3-a` 면 `gcp` 하나다. 어느 쪽도 못 풀면 켜진 CSP 전부와 지역 오류). `azure` 는 `400 request.provider_not_enabled` 이고 `supported: ["aws", "gcp"]` 가 실린다. `/v1/generate` 는 고른 CSP 의 **모든** 리소스 종류에 이름을 하나씩 주고, `/v1/names` 는 **고른 리소스만** 요청한 개수만큼 준다.

- **`/v1/generate` 에서 늘 FAIL 인 행** — 기본 입력으로 전체 목록을 만들기 때문이다. 리소스 정책은 종류가 필요하고(`name.kind_required`), Cloud Functions 1세대 · 2세대는 이름공간이 하나라 같은 이름이 되어 둘 다 `name.conflict` 다. 리소스 정책은 `/v1/names` 에 `kind` 를 넣어 만든다
- **`/v1/names`** — `resources` 의 `count` 는 순번이 있는 규칙에만 1~99(기본 1), `role` 은 역할 규칙에만 `^[a-z0-9]{2,16}$`(기본 `sync`), `kind` 는 종류가 있는 규칙에만 값 이름(`POSTGRES` 등 — 규칙별 목록은 `/llms.txt` · `/catalog.json`)이다. CSP 기본값과 같은 종류는 토큰을 붙이지 않는다. 한 요청에 항목 200개 · 이름 200개까지, 같은 종류는 한 번만. 항목마다 `scope`(이름이 유일해야 하는 범위)와 `uniqueness`(`none` 이면 CSP 가 유일성을 매기지 않는다 — AWS `Name` 태그, 아직 켜지지 않음)가 실린다. 한 요청은 부모 범위 하나로 본다 — 같은 이름이 될 두 항목은 둘 다 `valid: false` · `name.conflict` 이고 `conflicts` 가 요약한다
- **입력 상한** — `owner` · `system` · `purpose` 는 각 **64자**까지다(넘으면 `400 request.field_too_long` · 화면 입력은 64자에서 멈춘다)

- **메시지** — `violations` · `steps` · `rule.notes` · `metadata.transformed` · 라벨 위반 · 라벨 변환 · `errors` 는 전부 `{ code, field?, params?, message }` 목록이다. 분기는 `code`(바뀌지 않는다)로, 사람에게는 `message`(영어 · 문구는 다듬어질 수 있다)를 보인다
- **오류** — 모든 실패가 `{ "success": false, "errors": [...], "supported"?: [...] }` 한 꼴이다. `supported` 는 provider 가 모르는 값이거나 켜지지 않았을 때, resource type · event · 복사 target 이 모르는 값일 때, `providers` 가 비지 않은 배열이 아닐 때 실린다(모르는 종류는 `params.supported` 에 허용 값이 실린다). 오류에 되돌려 싣는 사용자 값(`params.value` · `params.requested` 와 `message`)은 40자에서 자르고 `…` 를 붙이며 제어 · 양방향 문자는 `\uXXXX` 로 보인다. `supported` 같은 목록은 자르지 않는다. `400` 요청 모양 오류 · `404` `/v1` 아래 없는 경로 · 메서드(`request.not_found`) · `409` `rules_version` 불일치 · `413` 본문 32KB(32,768 바이트) 초과 · `429` 클라이언트 IP 당 60초 60건 초과(POST `/v1/*` · GET `/llms.txt` · GET `/catalog.json` 합산 · `Retry-After: 60`) · `500` 내부 오류. `POST /v1/wizard` · `POST /v1/generate` 의 400 은 오류를 앞에서부터 50개까지만 싣고, 더 있으면 마지막 항목 `request.errors_truncated` 가 `params: { shown, total }` 로 알린다. 다른 경로는 오류를 모두 싣는다. `GET /v1/health` 는 `{ "ok": true, "version": {…} }`
- **PASS 의 뜻** — 이 규칙 버전의 이름 검사(길이 · 형식 · 예약어)를 통과했다는 뜻이다. 그 이름을 쓸 수 있다는 뜻이 아니다 — 고유성 · 권한 · 할당량 · 조직 정책은 검사하지 않고, 축소 때문에 서로 다른 문맥이 같은 이름이 될 수 있다
- **버전 · 이름 안정성** — `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/v1/health` 의 성공 응답에 `version: { engine, rules }` 가 실린다(실패와 `/v1/events` 에는 없다). `rules`(`YYYY-MM-DD.N`)는 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있는 변경마다 오른다. 옛 규칙 버전은 서빙하지 않는다 — 만든 이름을 그대로 쓴다. 요청에 `"rules_version"` 을 넣으면 규칙이 바뀌었을 때 다른 이름 대신 `409` 를 받는다

### 프로젝트 전체 — `POST /v1/wizard`

```sh
curl -s -X POST https://<your-deployment>/v1/wizard -H 'content-type: application/json' \
  -d '{"provider":"gcp","project":{"owner":"platform","system":"billing","env":"prod","region":"asia-northeast3"},"project_picks":[{"preset":"vpc","instances":[{"id":"n1","seq":"01"}]}],"services":[{"purpose":"shop","picks":[{"preset":"web","instances":[{"id":"a","seq":"01","attach":{"boot":true,"data":["01"]}}]},{"preset":"db","kind":"POSTGRES","instances":[{"id":"b","seq":"01"}]}]},{"purpose":"pay","picks":[{"preset":"web","ha":true,"instances":[{"id":"c","seq":"01"},{"id":"d","seq":"02"}]}]}]}'
```

요청 하나가 프로젝트 하나다. `project` 는 네 값(`purpose` 없음), `project_picks` 는 프로젝트 공용 리소스, `services` 의 항목마다 `purpose` 와 그 `picks` 다. pick 은 `preset`(`web` · `was` · `bastion` · `file` · `db` · `object` · `run` · `sa` · `secret` · `gke` · `wip` · `bq` · `ar` · `topic` · `sub` · `dlq` · `dlqsub` · `build` · `conn` · `repo` · `cron` · `runjob` · `redis` · `intweb` · `intwas` · `worker` · `raw` · `ingest` · `appdata`, 로드 밸런서 부품 `ip` · `ig` · `bs` · `hc` · `url` · `cert` · `thps` · `fwd` · `urlredir` · `thp` · `fwdredir` · `neg` · `bb`, 네트워크 `vpc` · `subnet` · `firewall` · `router` · `nat` · `psa`)이거나 `"preset": null` 과 `rule` id 이고, `tier` · `kind` · `ha` · `serverless` 를 더할 수 있다. `instances` 는 서버다 — 저마다 고른 `id`(`^[a-z0-9]{1,8}$`) · 번호로 남는 `seq` · 딸린 리소스를 받는 리소스에만 `attach`(`boot` · `data` · `ip` · `ipi`). 서비스 20개 · 서비스마다 또는 `project_picks` 에 pick 40개 · 프로젝트 ID 를 넣어 이름 200개까지. 응답(항목 여덟)은 위 [Whole project](#whole-project-post-v1wizard) 와 같다.

- 항목 순서 — 프로젝트 ID · 프로젝트 공용 · 서비스마다, 서버 바로 뒤에 그 딸린 리소스
- `key` 는 구조 경로(`service/shop/compute_instance/-/web/01/data/01`)라 다른 항목을 더하거나 지워도 바뀌지 않는다. 딸린 리소스에는 `parent` · `attach`, 프로젝트 공용 항목에는 `"level": "project"` 가 실린다
- 프로젝트 어디서든 같은 고유성 부류의 같은 이름 둘은 둘 다 `valid: false` · `name.conflict` 다
- `400` 은 잘못된 자리를 요청의 이름으로 `field` 에 적는다(`services[0].picks[0].instances[0].attach.data[1]` 등). `/v1/generate` · `/v1/names` · `/v1/validate` 는 바뀌지 않았다

## AI 에이전트 연동

- **`GET /llms.txt`** — 엔진 · 규칙 버전 · 이름 공식 · 표준값과 별칭 · 리전 코드와 받는 존 · 종류 토큰 · 용도 토큰 tier · 딸린 리소스 · 마법사 프리셋 · 약어와 그 출처 · 규칙마다 길이 · pattern · 금지어 · 설명 · 문서 링크 · CSP 별 리소스 트리 · PASS 의 뜻 · API 요약 · 한도(본문 크기 · `429` 와 `Retry-After` 의 요청 제한 · 필드 · 항목 · 오류 수 · 되돌려 싣는 값) · 계획 파일 · `/catalog.json` 칸 · 저장소 CLI(명령 · 서버 URL · 종료 코드). 규칙 표 · catalog · 서버 상수에서 만들므로 엔진과 어긋나지 않는다
- **`GET /openapi.json`** — `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/v1/events` · `/v1/health` · `/catalog.json` 의 OpenAPI 3.0.3. 시험이 실제 응답을 이 명세로 검증한다
- **`GET /catalog.json`** — 켜진 CSP 의 리소스 catalog 와 지역 표(JSON). 화면 행마다 규칙 id · 약어 · 종류와 토큰 · 지역 토큰 종류 · 설명 · 이름 넣는 자리 · 검색 별칭과 `version: { engine, rules }` · 환경 표준값 `env_values`. 규칙마다 마법사 pick 이 받는 것(`input` · `tier` · `locations`), CSP 마다 마법사 `presets` · 서버 슬롯의 `attachments` · 요청 `limits` 도 싣는다 — CLI 가 규칙을 복제하지 않고 이것을 읽는다. 정본은 이 저장소의 `catalog/*.json` 이다([CONTRIBUTING.md](../CONTRIBUTING.md))
- **`/docs/naming`** — 같은 데이터를 사람이 읽는 쪽으로 — 이름 공식 · 토큰 · 지역 표 · 축소 방법 · 약어 · 종류 토큰 · tier · 딸린 리소스 · 마법사 프리셋
