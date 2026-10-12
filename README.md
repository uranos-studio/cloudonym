# Cloudonym

Multi-cloud resource naming engine — **Google Cloud** in this release, with AWS and Azure in the rule table and planned for later releases. From five context values (owner · system · purpose · env · region) it **generates, corrects and validates** resource names against each provider's physical constraints — a web UI for people (a **naming wizard** for a whole project, and a resource tree for any single resource), and `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/llms.txt` · `/openapi.json` · `/catalog.json` for AI coding agents and IaC. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

[한국어](#한국어)

![Cloudonym naming wizard — project values, two services with their servers and disks, and the generated names](docs/screenshots/06-wizard.png)

<a id="naming-wizard"></a>
## Naming wizard (web UI, `/`)

The home page names a whole Google Cloud project in seven steps (D84). Names are regenerated as you type. Above the steps, **Cloud** shows GCP selected; AWS and Azure are shown as **Coming soon**.

1. **① Project** — type **Owner · System** (at most 64 characters each), pick one or more **Environments** and a **Region** (searching by a zone name also finds its region). The **project name** and the **project ID** (`<owner>-<system>-<env>`) appear at once, one per environment; with several environments the same plan is named once for each. An optional **Project ID suffix** (a team code or a year, e.g. `team1` → `platform-billing-prod-team1`) makes a predictable ID your own: project IDs are unique across Google Cloud and never reusable, and Cloudonym cannot check whether one is free (D85).
2. **② Required network** — a VPC, subnets, firewall rules (`ssh`, `web`, `icmp`, `iap` for IAP TCP forwarding, `lbhc` for load balancer health checks, or any other tier you type), a Cloud Router, Cloud NAT and a private services access range (`psa`, a global internal address). The VPC starts as one network (a plan with two, made through the API, still shows both). **Add subnet** adds another subnet with its own kind and tier — for example a proxy-only subnet beside the private one (`…-snet-01`, `…-snet-proxy-01`) (D86, D87, D88).
3. **③ Services** — one card per service. The service name is the `purpose` of every name in that service; **Add service** adds another.
4. **④ Purpose** — pick what runs in the service: **web**, **was** (app server), **bastion**, **file** (file server), **db** (Cloud SQL), **object** (Cloud Storage), **run** (Cloud Run service), **sa** (service account), **secret** (Secret Manager), **gke** (GKE cluster), **wip** (Workload Identity pool), or **Custom…**, which opens the resource tree to pick any other catalog row. The **Load balancer** row adds the parts of an HTTPS load balancer one name at a time — global IP address, backend service, health check, URL map, SSL certificate, target HTTPS proxy and forwarding rule; the parts are not linked to one another.
5. **⑤ Options and servers** — web and app servers can be **Serverless** (Cloud Functions or Cloud Run) or **HA** (at least two servers); a resource with kinds takes its kind (a database its engine, a GKE cluster Standard or Autopilot), and a service account its role (`sync` when left empty). Each server is one line with its own number: removing server 01 does not rename server 02, and **Renumber** closes the gaps only when you ask; other numbered resources add a line with **Add Cloud SQL Instance** and so on (a subnet: **Add number (same kind and tier)**). A pick without a fixed tier (a bucket, a database, a custom pick) takes an optional **Tier**, and **Duplicate** copies it without the tier so one service can hold two of a kind — for example buckets `…-gcs-uploads` and `…-gcs-backups`. A bucket or BigQuery dataset pick has a **Location** select: the project region by default, or a multi-region or dual-region location (`US` → `…-prod-us-gcs`). A secret pick has one too: **Global** by default, with no region token (`…-prod-secret-01`), or **Regional** for a regional secret in the project region (`…-prod-ane3-secret-01`).
6. **⑥ Attached resources** — per server, a **boot** disk, numbered **data** disks and reserved external or internal addresses (**ip**, **ipi**). Their names continue the server's name.
**Shared extra resources** (no number) — **Custom…** here picks any other project-level resource that is not tied to one service.
7. **⑦ Names** — grouped by project and service, attached resources under their server, each with `PASS`/`FAIL` and the reasons. Copy **all names**, the **JSON**, **Terraform** `locals` (one map `gcp_names` keyed by the item key, plus `gcp_labels_by_namespace`) or the **Share URL**. With several environments the names are grouped by environment first, the JSON has one entry per environment under `environments`, and Terraform gives `gcp_names_by_env` and `gcp_labels_by_env` (environment → item key or namespace). `POST /v1/wizard` still takes one environment per request. A valid bucket name has a **Check** button (here and on `/pick`): when you click it, your browser asks Cloud Storage directly whether the name is taken (available · taken · could not tell); the name never goes to Cloudonym.

For example, project `platform` · `billing` · `prod` · `asia-northeast3` with a VPC network, a service `shop` (web server 01 with a boot disk and data disk 01, and a PostgreSQL database) and a service `pay` (web servers 01 and 02 with HA) gives these names — the same request is the [`POST /v1/wizard` example](#whole-project-post-v1wizard) below:

```text
platform-billing-prod                        project ID
billing-prod-vpc-01                          VPC network (project level: no service, no region)
billing-shop-prod-ane3-gce-web-01            web server 01 of shop
billing-shop-prod-ane3-gce-web-01-boot       its boot disk
billing-shop-prod-ane3-gce-web-01-data-01    its data disk 01
billing-shop-prod-ane3-sql-pg-01             Cloud SQL (PostgreSQL)
billing-pay-prod-ane3-gce-web-01             web server 01 of pay
billing-pay-prod-ane3-gce-web-02             web server 02 of pay
```

The wizard and its preset groups — web, app and bastion servers; file server; database; object storage; Cloud Run service; service account; secret; GKE cluster; Workload Identity pool; load balancer parts; network — are part of this repository, and any other catalog row is a custom pick. More complex stacks are out of scope for this repository.

### Name formula

Most numbered resources follow `<system>-<purpose>-<env>-<region>-<abbreviation>[-<kind>][-<tier>]-<seq>`; every formula in use is listed on `/docs/naming` and in `/llms.txt`.

- `region` is a region code (`ane3`), never a zone — a zone you enter resolves to its region, so VMs and disks are named like regional resources. Resources without a location (a service account, Workload Identity pools, deny policies, policy bindings and workforce pools, whose only location is `global`) and children that inherit their parent's location (a KMS key, a Spanner database, a Cloud SQL user, Cloud NAT) carry no region token (D77); a Cloud Storage bucket or BigQuery dataset can carry a multi-region or dual-region code instead (`us`, `asia1`; D78); a Secret Manager secret is global unless the wizard pick asks for a regional secret (D79).
- `kind` is added only when it differs from the provider default (`pg` for PostgreSQL).
- `tier` (`web`, `was`, …; pattern `^[a-z0-9]{2,16}$`) is filled only by the wizard, so `/v1/generate` and `/v1/names` never put one in a name. It is never shortened. Numbered resources take it before the sequence number; resources with neither a sequence number nor a role (a bucket, a BigQuery dataset) take it right after the abbreviation, which is how two buckets in one service differ (`platform-billing-shop-prod-ane3-gcs-uploads`, `…-gcs-backups`). Abbreviations, kind tokens, environment values and region codes are not allowed as tiers.
- Attached resources add `-boot`, `-data-<seq>`, `-ip` or `-ipi` to the server's final name and are never shortened; a name that does not fit fails with the reason.

## Pick resources (`/pick`)

The resource tree is at `/pick` (header link **Pick resources**); a tree link opened at `/` moves there. It names single resources from one set of five values, in four steps:

1. **① Cloud** — GCP is selected for you. AWS and Azure are shown as **Coming soon** and cannot be picked yet.
2. **② Context** — type **Owner · System · Purpose** (at most 64 characters each), pick **Environment**, and pick a **Region** (searching by a zone name also finds its region). Names are regenerated as you type.
3. **③ Resources** — a tree of the provider's resources, grouped by the scope in which the provider requires a name to be unique. Search by name, id, Terraform type, gcloud group or alias, filter by category, or show the selected rows only. Each row has an ⓘ with a one-line description and where the name is entered (gcloud flag or Terraform argument); rows marked **API only** have no gcloud command or Terraform resource and are created through the API. Tick a resource and set how many you need (1–99, numbered `01`…`99`); resources without a sequence number are always one, and identity-like resources take a short role (`sync` by default). A row that covers several scopes (for example a regional and a global address) asks for the scope first, and some rows take a **kind** (for example the Cloud SQL engine).
4. **④ Names** — only the picked resources, grouped by scope, each with `PASS`/`FAIL` and why it was shortened or transformed. Copy one name, **all valid names** (one per line), the **names JSON** or **Terraform locals** (names and tags). The **Tags · Labels** panel copies the provider's standard tags as JSON. Two picked resources that would get the same name in the same scope are both marked `FAIL` (`name.conflict`).

One line above the names says what **PASS** means (see [What PASS means](#what-pass-means)). The footer shows the engine and rules versions; a share link made with older rules shows a notice until you change the input.

Allowed values — env: `prod` · `stg` · `dev` · `sbx` · `qa` · `uat` · `test` · `perf` · `dr` (aliases such as `prd`, `production`, `staging`, `acceptance`, `performance`, `recovery` are accepted and normalised) · region: a region or a zone of the provider, by name or by code (`asia-northeast3`, `asia-northeast3-a`, `ane3`, `ane3a`), or `global` — a zone is accepted and resolved to its region (names carry the region code, never a zone), and global resources carry no region token. The old country values `kr` and `jp` are rejected with the matching region names. Multi-region and dual-region locations (`US`, `EU`, `ASIA`, `ASIA1`, `EUR4`, `EUR5`, `EUR7`, `EUR8`, `NAM4`; by name or code) are accepted only for the types that take them — `storage_bucket` all nine, `bigquery_dataset` `US` and `EU` — so `/v1/names` takes one when every requested type with a region token supports it, and `/v1/generate` (every type) answers 400 `context.location_unsupported`. The locations and the types that take them are listed in `/llms.txt`. The region table is in `/llms.txt` and on the naming guide page `/docs/naming`.

### Share URL — your input is readable by anyone with the link

Both screens keep their state in the URL hash — the wizard its project values, services, picks and servers; the tree the five values, the provider and the selection — and **Share URL** copies that link. The hash is written to the address bar as you type, even if you never press the button. It is **Base64, not encryption**: anyone who gets the link can decode it and read owner, system, the service names and the rest. Do not enter sensitive values such as internal company or project names if you plan to share the link. The page shows the same warning next to the button.

### Screenshots

| | |
|---|---|
| [Naming wizard](docs/screenshots/06-wizard.png) | Two services — `shop` (server 01 with a boot disk and data disk 01) and `pay` (server 01 with a boot disk) — and their names |
| [Desktop, light](docs/screenshots/01-desktop-light.png) | The resource tree, four resources picked (the tree shows the selected rows only) |
| [Mobile, 360 px](docs/screenshots/02-mobile-360.png) | The same selection on a narrow screen, with the bar that jumps to the names |
| [Desktop, dark](docs/screenshots/03-desktop-dark.png) | The same share link opened in dark mode |
| [FAIL cards](docs/screenshots/04-fail-card.png) | A `system` made only of symbols — every name fails with the reason and cannot be copied |
| [Naming guide](docs/screenshots/05-naming-guide.png) | `/docs/naming` — formulas, tokens, region codes, abbreviations, kind tokens, tiers, attached resources and wizard presets, generated from the same data as the engine |

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
  "version": { "engine": "0.1.0", "rules": "2026-10-12.4" },
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
  "version": { "engine": "0.1.0", "rules": "2026-10-12.4" },
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
  "version": { "engine": "0.1.0", "rules": "2026-10-12.4" },
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

**Version and name stability.** Successful responses of `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate` and `/v1/health` carry `version: { engine, rules }` (failures and `/v1/events` do not). `rules` (`YYYY-MM-DD.N`) changes whenever the same input could produce a different name, verdict, suggestion or label. Cloudonym does not serve old rules revisions — keep the names you created. Send `"rules_version": "<rules>"` to be told with a `409 request.rules_version_mismatch` instead of silently getting a different name. The [Terraform example](examples/terraform/README.md) shows `ignore_changes` and a pinned mode that skips the API.

<a id="whole-project-post-v1wizard"></a>
### Whole project: `POST /v1/wizard`

```sh
curl -s -X POST https://<your-deployment>/v1/wizard -H 'content-type: application/json' \
  -d '{"provider":"gcp","project":{"owner":"platform","system":"billing","env":"prod","region":"asia-northeast3"},"project_picks":[{"preset":"vpc","instances":[{"id":"n1","seq":"01"}]}],"services":[{"purpose":"shop","picks":[{"preset":"web","instances":[{"id":"a","seq":"01","attach":{"boot":true,"data":["01"]}}]},{"preset":"db","kind":"POSTGRES","instances":[{"id":"b","seq":"01"}]}]},{"purpose":"pay","picks":[{"preset":"web","ha":true,"instances":[{"id":"c","seq":"01"},{"id":"d","seq":"02"}]}]}]}'
```

One request is one project. `project` holds four values (no `purpose`), `project_picks` the project-level resources, and each entry of `services` a `purpose` and its `picks`. A pick is a `preset` (`web`, `was`, `bastion`, `file`, `db`, `object`, `run`, `sa`, `secret`, `gke`, `wip`, the load balancer parts `ip`, `bs`, `hc`, `url`, `cert`, `thps`, `fwd`, and the network presets `vpc`, `subnet`, `firewall`, `router`, `nat`) or `"preset": null` with a `rule` id, plus optional `tier`, `kind`, `ha` and `serverless`. `instances` are the servers: each has an `id` you choose (`^[a-z0-9]{1,8}$`), a `seq` that stays its number, and `attach` (`boot`, `data`, `ip`, `ipi`) on resources that take attached resources. At most 20 services, 20 picks per service or in `project_picks`, and 200 names including the project ID. Response, trimmed to a server and its boot disk (8 items in all — the names listed under [Naming wizard](#naming-wizard)):

```json
{
  "success": true,
  "version": { "engine": "0.1.0", "rules": "2026-10-12.4" },
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

- **`GET /llms.txt`** — engine and rules version, naming formulas, canonical values with aliases, the region codes and the zones they accept, kind tokens, the tier token, attached resources and wizard presets, abbreviations with their sources, every rule's length · pattern · forbidden words · notes · doc link, the resource tree per provider, what PASS means, and the API summary. It is built from the rule table and the catalog, so it never drifts from the engine.
- **`GET /openapi.json`** — OpenAPI 3.0.3 for `/v1/generate`, `/v1/names`, `/v1/wizard`, `/v1/validate`, `/v1/events`, `/v1/health` and `/catalog.json`, including every error status. The test suite validates real responses against it.
- **`GET /catalog.json`** — the resource catalog and region table of the enabled providers as JSON: one row per screen row with its rule ids, abbreviation, kinds and tokens, region-token kind, description, where the name is entered and search aliases, plus `version: { engine, rules }`. The source is `catalog/*.json` in this repository (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **`/docs/naming`** — the same data as a page for people: formulas, tokens, the region table, how names are shortened, abbreviations, kind tokens, tiers, attached resources and the wizard presets.

Point your agent at `https://<your-deployment>/llms.txt`; paths in it are relative to the host that served it.

## Supported resources (136 rules)

**GCP 136** rules are enabled in this release (rules revision `2026-10-12.4`; counted from the engine's rule table and matching the rule list in `/llms.txt`). **AWS 169 · Azure 377** — in the rule table, not enabled yet: the engine and its tests cover them, but the UI, the API, `/llms.txt` and `/catalog.json` do not offer them.

The 36 hand-written rules below (the AWS and Azure rows among them are not enabled yet) are each checked against the official document linked. On top of them, **332 Azure rules** are imported from the formal rows of the [Azure naming rules table](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules) (generated by `scripts/rules/build-azure-rules.mjs`) **82 GCP rules** from the [Compute Engine](https://www.googleapis.com/discovery/v1/apis/compute/v1/rest) and [Cloud KMS](https://www.googleapis.com/discovery/v1/apis/cloudkms/v1/rest) discovery documents (generated by `scripts/rules/build-gcp-rules.mjs`), and **116 AWS rules** from the [CloudFormation resource schemas](https://schema.cloudformation.us-east-1.amazonaws.com/CloudformationSchema.zip) — 23 physical names with a schema pattern and length, and 93 `Name` tags (generated by `scripts/rules/build-aws-rules.mjs`); `/llms.txt` lists every rule, and the rows not imported yet are in [docs/azure-intake-held.md](docs/azure-intake-held.md) (29 rows), [docs/gcp-intake-held.md](docs/gcp-intake-held.md) (10 discovery methods, and the 23 of the 116 supported GCP asset types that have no rule: 5 held, 13 with no user-chosen name, 5 named outside this engine) and [docs/aws-intake-held.md](docs/aws-intake-held.md) (33 types). A further **44 GCP rules**, **42 AWS rules** and **30 Azure rules** were added by hand after reading each REST or API reference, product guide or naming-rules row again (`src/core/rules/gcp-manual.ts`, `src/core/rules/aws-manual.ts`, `src/core/rules/azure-manual.ts`, with the source sentence quoted above each rule).

Every limit is checked against the official document linked below. The line-by-line comparison is in [docs/rule-verification.md](docs/rule-verification.md).

| Provider | `resource_type` | Length | Official doc |
|---|---|---|---|
| GCP | `project_id` | 6–30 | [link](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers) |
| GCP | `project_name` | 4–30 | [link](https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers) |
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

[examples/terraform/](examples/terraform/README.md) calls `/v1/generate` from a `data "http"` block and creates a `google_compute_instance` with the returned name and labels. `apply` is blocked unless `valid` is `true` and there are no label violations. `ignore_changes = [name]` keeps an existing VM's name when the rules change, `rules_version` turns a rules change into a 409, and `pinned` skips the API with the name you already created. `instance_name` is the VM's real name; `cloudonym_candidate_name` is what the API proposes now. For a whole project, the wizard's **Terraform** button gives one map `gcp_names` keyed by the item key; the example README shows the same map built from a `/v1/wizard` response.

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

**Cloudonym** 은 클라우드 리소스 이름을 다섯 문맥값(owner · system · purpose · env · region)에서 각 CSP 의 물리 제약에 맞게 **생성 · 교정 · 검증**하는 엔진이다. 이번 릴리스는 **Google Cloud** 만 연다 — AWS · Azure 는 규칙 표에 있고 다음 릴리스에서 연다. 사람은 웹 화면(프로젝트 전체를 짓는 **이름 마법사**와 리소스 하나씩 고르는 리소스 트리)으로, AI 코딩 에이전트와 IaC 는 `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/llms.txt` · `/openapi.json` · `/catalog.json` 으로 쓴다. 바뀐 점은 [CHANGELOG.md](CHANGELOG.md)(영어)에 있다.

### 이름 마법사 (웹 화면 `/`)

첫 화면은 Google Cloud 프로젝트 하나의 이름을 일곱 단계로 짓는다(D84). 입력하는 대로 이름이 다시 만들어진다. 단계 위의 **Cloud** 에는 GCP 가 골라져 있고 AWS · Azure 는 **Coming soon** 으로 보인다.

1. **① Project** — **Owner · System** 을 적고(각 64자까지) **Environments** 를 하나 이상 · **Region** 을 고른다(존 이름으로 찾아도 그 리전이 나온다). **프로젝트 이름**과 **프로젝트 ID**(`<owner>-<system>-<env>`)가 환경마다 바로 보인다. 환경을 여럿 고르면 같은 계획을 환경마다 한 번씩 짓는다. 선택 칸 **Project ID suffix**(팀 코드나 연도 — `team1` → `platform-billing-prod-team1`)는 예측할 수 있는 ID 를 내 것으로 만든다 — 프로젝트 ID 는 Google Cloud 전체에서 유일하고 다시 쓸 수 없으며, Cloudonym 은 그 ID 가 비어 있는지 확인할 수 없다(D85)
2. **② Required network** — VPC · 서브넷 · 방화벽 규칙(`ssh` · `web` · `icmp` · IAP TCP forwarding 용 `iap` · 로드 밸런서 상태 확인용 `lbhc`, 또는 직접 적은 tier) · Cloud Router · Cloud NAT · private services access 대역(`psa`, 전역 내부 주소). VPC 는 하나로 시작한다(둘이 든 링크는 둘 다 보인다). **Add subnet** 은 종류와 tier 를 따로 갖는 서브넷을 하나 더 둔다 — 예: 사설 서브넷 옆의 프록시 전용 서브넷(`…-snet-01` · `…-snet-proxy-01`) (D86 · D87 · D88)
3. **③ Services** — 서비스마다 카드 하나. 서비스 이름이 그 서비스 안 모든 이름의 `purpose` 다. **Add service** 로 더한다
4. **④ Purpose** — 서비스에서 돌릴 것을 고른다 — **web** · **was**(앱 서버) · **bastion** · **file**(파일 서버) · **db**(Cloud SQL) · **object**(Cloud Storage) · **run**(Cloud Run 서비스) · **sa**(서비스 계정) · **secret**(Secret Manager) · **gke**(GKE 클러스터) · **wip**(Workload Identity pool), 또는 리소스 트리를 열어 다른 catalog 행을 고르는 **Custom…**. **Load balancer** 줄은 HTTPS 로드 밸런서 부품을 이름 하나씩 더한다 — 전역 IP 주소 · 백엔드 서비스 · 상태 확인 · URL 맵 · SSL 인증서 · 대상 HTTPS 프록시 · 전달 규칙. 부품끼리 엮지는 않는다
5. **⑤ Options and servers** — web · was 서버는 **Serverless**(Cloud Functions · Cloud Run)나 **HA**(서버 두 대 이상)로 바꿀 수 있고, 종류가 있는 리소스는 종류를 고르고(데이터베이스는 엔진, GKE 클러스터는 Standard · Autopilot) 서비스 계정은 역할을 적는다(비우면 `sync`). 서버는 한 줄에 하나, 저마다 번호를 갖는다 — 서버 01 을 지워도 서버 02 의 이름은 그대로이고, 빈 번호는 **Renumber** 를 누를 때만 당긴다. 다른 번호 붙은 리소스는 **Add Cloud SQL Instance** 처럼 그 이름으로 줄을 더한다(서브넷은 **Add number (same kind and tier)**). tier 가 정해지지 않은 pick(버킷 · 데이터베이스 · custom)은 **Tier** 를 적을 수 있고, **Duplicate** 로 복사하면 한 서비스에 같은 종류를 둘 둔다 — 예: 버킷 `…-gcs-uploads` · `…-gcs-backups`. 버킷 · BigQuery 데이터셋 pick 에는 **Location** 고르기가 있다 — 기본은 프로젝트 지역, 멀티 · 이중 리전 위치를 고르면 그 코드가 든다(`US` → `…-prod-us-gcs`). Secret pick 에도 있다 — 기본은 **Global** 이라 지역 토큰이 없고(`…-prod-secret-01`), **Regional** 을 고르면 프로젝트 지역의 지역 Secret 이 된다(`…-prod-ane3-secret-01`)
6. **⑥ Attached resources** — 서버마다 **boot** 디스크 · 번호 붙은 **data** 디스크 · 예약 고정 외부 · 내부 주소(**ip** · **ipi**). 이름은 서버 이름을 잇는다
**Shared extra resources**(번호 없음) — 여기의 **Custom…** 은 서비스 하나에 묶이지 않는 프로젝트 수준의 다른 리소스를 고른다
7. **⑦ Names** — 프로젝트 → 서비스로 묶고 딸린 리소스는 서버 아래에 보인다. 카드마다 `PASS`/`FAIL` 과 이유가 있다. **이름 전부** · **JSON** · **Terraform** `locals`(항목 키를 맵 키로 하는 맵 `gcp_names` 하나와 `gcp_labels_by_namespace`) · **Share URL** 을 복사한다. 환경이 여럿이면 이름은 환경으로 먼저 묶이고, JSON 은 `environments` 아래 환경마다 하나, Terraform 은 `gcp_names_by_env` · `gcp_labels_by_env`(환경 → 항목 키 · 이름공간)다. `POST /v1/wizard` 는 요청마다 환경 하나 그대로다. 유효한 버킷 이름에는 **Check** 단추가 있다(여기와 `/pick`) — 누르면 브라우저가 Cloud Storage 에 그 이름이 쓰이고 있는지 직접 묻는다(available · taken · 모름). 이름은 Cloudonym 에 가지 않는다

예 — 프로젝트 `platform` · `billing` · `prod` · `asia-northeast3` 에 VPC 네트워크, 서비스 `shop`(boot 디스크 · data 디스크 01 이 붙은 web 서버 01 과 PostgreSQL 데이터베이스), 서비스 `pay`(HA 로 web 서버 01 · 02)를 두면 위 [Naming wizard](#naming-wizard) 의 여덟 이름이 나온다. 같은 요청이 아래 `POST /v1/wizard` 예시다.

마법사와 프리셋 묶음 — web · was · bastion 서버, 파일 서버, 데이터베이스, 오브젝트 스토리지, Cloud Run 서비스, 서비스 계정, 시크릿, GKE 클러스터, Workload Identity pool, 로드 밸런서 부품, 네트워크 — 은 이 저장소에 있고, 그 밖의 catalog 행은 Custom 으로 고른다. 더 복잡한 구성은 이 저장소의 범위 밖이다.

**이름 공식** — 순번이 있는 리소스 대부분은 `<system>-<purpose>-<env>-<region>-<약어>[-<kind>][-<tier>]-<seq>` 이다. 쓰이는 공식 전부는 `/docs/naming` 과 `/llms.txt` 에 있다.

- `region` 은 리전 코드(`ane3`)이고 존은 들지 않는다 — 입력한 존은 그 리전으로 풀려 VM · 디스크도 리전 리소스처럼 이름 붙는다. 위치가 없는 리소스(서비스 계정 · Workload Identity 풀 · 거부 정책, 위치가 `global` 하나인 policy binding · workforce pool)와 부모의 위치를 물려받는 자식(KMS 키 · Spanner 데이터베이스 · Cloud SQL 사용자 · Cloud NAT)에는 지역 토큰이 없다(D77). Cloud Storage 버킷 · BigQuery 데이터셋은 멀티 · 이중 리전 코드(`us` · `asia1`)를 대신 가질 수 있다(D78). Secret Manager secret 은 마법사 pick 이 지역 Secret 을 고르지 않으면 전역이다(D79)
- `kind` 는 CSP 기본값과 다를 때만 붙는다(PostgreSQL 은 `pg`)
- `tier`(`web` · `was` …, 꼴 `^[a-z0-9]{2,16}$`)는 마법사만 채운다 — `/v1/generate` · `/v1/names` 의 이름에는 들지 않는다. 줄이지 않는다. 순번이 있는 리소스는 순번 앞에, 순번도 역할도 없는 리소스(버킷 · BigQuery 데이터셋)는 약어 바로 뒤에 든다 — 한 서비스의 버킷 둘이 이렇게 갈린다(`platform-billing-shop-prod-ane3-gcs-uploads` · `…-gcs-backups`). 약어 · 종류 토큰 · 환경 값 · 지역 코드는 tier 로 쓸 수 없다
- 딸린 리소스는 서버의 최종 이름에 `-boot` · `-data-<seq>` · `-ip` · `-ipi` 를 붙이고 줄이지 않는다 — 들어가지 않으면 이유와 함께 실패한다

### 리소스 고르기 (`/pick`)

리소스 트리는 `/pick`(헤더 링크 **Pick resources**)에 있고, 마법사 전에 나간 공유 링크도 이 화면으로 열린다. 다섯 값 한 벌로 리소스를 하나씩 네 단계로 짓는다.

1. **① Cloud** — GCP 가 골라져 있다. AWS · Azure 는 **Coming soon** 표지와 함께 보이고 아직 고를 수 없다
2. **② Context** — **Owner · System · Purpose** 를 적고(각 64자까지) **Environment** 를 고르고, **Region** 을 고른다(존 이름으로 찾아도 그 리전이 나온다). 입력하는 대로 이름이 다시 만들어진다
3. **③ Resources** — CSP 가 이름을 유일하게 요구하는 범위로 묶은 리소스 트리다. 이름 · id · Terraform 타입 · gcloud 그룹 · 별칭으로 찾고, 분류로 거르고, 고른 행만 볼 수 있다. 행마다 ⓘ 에 한 줄 설명과 이름을 넣는 자리(gcloud 플래그 · Terraform 인자)가 있고, **API only** 표지가 붙은 행은 gcloud 명령 · Terraform 리소스가 없어 API 로 만든다. 체크하고 개수(1~99 · 순번 `01`…`99`)를 정한다. 순번이 없는 리소스는 늘 하나이고, ID 성격의 리소스는 짧은 역할(기본 `sync`)을 받는다. 범위가 여럿인 행(지역 주소와 전역 주소 등)은 범위부터 고르고, 어떤 행은 **종류**(Cloud SQL 엔진 등)를 받는다
4. **④ Names** — 고른 리소스만 범위별로 보이고, 카드마다 `PASS`/`FAIL` 과 줄이거나 바꾼 이유가 나온다. 이름 하나 · **유효한 이름 전부**(한 줄에 하나) · **이름 JSON** · **Terraform locals**(이름 + 태그)를 복사한다. **Tags · Labels** 칸은 CSP 표준 태그를 JSON 으로 복사한다. 같은 범위에서 같은 이름이 될 두 리소스는 둘 다 `FAIL`(`name.conflict`)이다

이름 위 한 줄이 **PASS** 의 뜻을 말한다(쓸 수 있는지 · 고유한지는 검사하지 않는다). 꼬리말에 엔진 · 규칙 버전이 있고, 옛 규칙으로 만든 공유 링크는 입력을 바꿀 때까지 안내를 보인다.

**공유 URL 주의** — 두 화면 모두 상태를 URL hash 에 둔다(마법사는 프로젝트 값 · 서비스 · 고른 것 · 서버, 트리는 다섯 값 · CSP · 선택). **Share URL** 은 그 링크를 복사한다. hash 는 버튼을 누르지 않아도 입력하는 대로 주소창에 쓰인다. **Base64 는 암호화가 아니다** — 링크를 받은 사람은 owner · system · 서비스 이름 등 입력값을 그대로 읽는다. 링크를 넘길 생각이면 회사 내부 이름 같은 민감한 값을 넣지 않는다. 화면도 버튼 옆에 같은 경고를 보인다.

스크린샷 — [이름 마법사](docs/screenshots/06-wizard.png) · [데스크톱 밝은 화면](docs/screenshots/01-desktop-light.png) · [폭 360px](docs/screenshots/02-mobile-360.png) · [데스크톱 어두운 화면](docs/screenshots/03-desktop-dark.png) · [FAIL 카드](docs/screenshots/04-fail-card.png) · [이름 안내](docs/screenshots/05-naming-guide.png).

허용값 — env: `prod` · `stg` · `dev` · `sbx` · `qa` · `uat` · `test` · `perf` · `dr`(`prd` · `production` · `staging` · `acceptance` · `performance` · `recovery` 같은 별칭도 받아 표준값으로 바꾼다) · region: 그 CSP 의 리전 · 존을 이름이나 코드로(`asia-northeast3` · `asia-northeast3-a` · `ane3` · `ane3a`) 또는 `global` — 존은 받아 그 리전으로 푼다(이름에는 리전 코드만 들고 존은 들지 않는다). 전역 리소스에는 지역 토큰이 없다. 옛 나라 값 `kr` · `jp` 는 거부하고 해당 리전 이름을 알려 준다. 멀티 · 이중 리전 위치(`US` · `EU` · `ASIA` · `ASIA1` · `EUR4` · `EUR5` · `EUR7` · `EUR8` · `NAM4`, 이름이나 코드)는 그 위치를 받는 리소스에만 쓴다 — `storage_bucket` 은 아홉 전부, `bigquery_dataset` 은 `US` · `EU`. `/v1/names` 는 지역 토큰이 있는 요청 리소스가 전부 그 위치를 받을 때만 받고, 리소스 전부를 내는 `/v1/generate` 는 400 `context.location_unsupported` 로 답한다. 위치와 그 위치를 받는 리소스는 `/llms.txt` 에 있다. 지역 표는 `/llms.txt` 와 이름 안내 쪽 `/docs/naming` 에 있다.

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
- **버전 · 이름 안정성** — `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/v1/health` 의 성공 응답에 `version: { engine, rules }` 가 실린다(실패와 `/v1/events` 에는 없다). `rules`(`YYYY-MM-DD.N`)는 같은 입력에서 이름 · 판정 · 제안 · 라벨이 달라질 수 있는 변경마다 오른다. 옛 규칙 버전은 서빙하지 않는다 — 만든 이름을 그대로 쓴다. 요청에 `"rules_version"` 을 넣으면 규칙이 바뀌었을 때 다른 이름 대신 `409` 를 받는다

#### 프로젝트 전체 — `POST /v1/wizard`

```sh
curl -s -X POST https://<your-deployment>/v1/wizard -H 'content-type: application/json' \
  -d '{"provider":"gcp","project":{"owner":"platform","system":"billing","env":"prod","region":"asia-northeast3"},"project_picks":[{"preset":"vpc","instances":[{"id":"n1","seq":"01"}]}],"services":[{"purpose":"shop","picks":[{"preset":"web","instances":[{"id":"a","seq":"01","attach":{"boot":true,"data":["01"]}}]},{"preset":"db","kind":"POSTGRES","instances":[{"id":"b","seq":"01"}]}]},{"purpose":"pay","picks":[{"preset":"web","ha":true,"instances":[{"id":"c","seq":"01"},{"id":"d","seq":"02"}]}]}]}'
```

요청 하나가 프로젝트 하나다. `project` 는 네 값(`purpose` 없음), `project_picks` 는 프로젝트 공용 리소스, `services` 의 항목마다 `purpose` 와 그 `picks` 다. pick 은 `preset`(`web` · `was` · `bastion` · `file` · `db` · `object` · `run` · `sa` · `secret` · `gke` · `wip`, 로드 밸런서 부품 `ip` · `bs` · `hc` · `url` · `cert` · `thps` · `fwd`, 네트워크 `vpc` · `subnet` · `firewall` · `router` · `nat`)이거나 `"preset": null` 과 `rule` id 이고, `tier` · `kind` · `ha` · `serverless` 를 더할 수 있다. `instances` 는 서버다 — 저마다 고른 `id`(`^[a-z0-9]{1,8}$`) · 번호로 남는 `seq` · 딸린 리소스를 받는 리소스에만 `attach`(`boot` · `data` · `ip` · `ipi`). 서비스 20개 · 서비스마다 또는 `project_picks` 에 pick 20개 · 프로젝트 ID 를 넣어 이름 200개까지. 응답(항목 여덟)은 위 [Whole project](#whole-project-post-v1wizard) 와 같다.

- 항목 순서 — 프로젝트 ID · 프로젝트 공용 · 서비스마다, 서버 바로 뒤에 그 딸린 리소스
- `key` 는 구조 경로(`service/shop/compute_instance/-/web/01/data/01`)라 다른 항목을 더하거나 지워도 바뀌지 않는다. 딸린 리소스에는 `parent` · `attach`, 프로젝트 공용 항목에는 `"level": "project"` 가 실린다
- 프로젝트 어디서든 같은 고유성 부류의 같은 이름 둘은 둘 다 `valid: false` · `name.conflict` 다
- `400` 은 잘못된 자리를 요청의 이름으로 `field` 에 적는다(`services[0].picks[0].instances[0].attach.data[1]` 등). `/v1/generate` · `/v1/names` · `/v1/validate` 는 바뀌지 않았다

### AI 에이전트 연동

- **`GET /llms.txt`** — 엔진 · 규칙 버전 · 이름 공식 · 표준값과 별칭 · 리전 코드와 받는 존 · 종류 토큰 · 용도 토큰 tier · 딸린 리소스 · 마법사 프리셋 · 약어와 그 출처 · 규칙마다 길이 · pattern · 금지어 · 설명 · 문서 링크 · CSP 별 리소스 트리 · PASS 의 뜻 · API 요약. 규칙 표와 catalog 에서 만들므로 엔진과 어긋나지 않는다
- **`GET /openapi.json`** — `/v1/generate` · `/v1/names` · `/v1/wizard` · `/v1/validate` · `/v1/events` · `/v1/health` · `/catalog.json` 의 OpenAPI 3.0.3. 시험이 실제 응답을 이 명세로 검증한다
- **`GET /catalog.json`** — 켜진 CSP 의 리소스 catalog 와 지역 표(JSON). 화면 행마다 규칙 id · 약어 · 종류와 토큰 · 지역 토큰 종류 · 설명 · 이름 넣는 자리 · 검색 별칭과 `version: { engine, rules }`. 정본은 이 저장소의 `catalog/*.json` 이다([CONTRIBUTING.md](CONTRIBUTING.md))
- **`/docs/naming`** — 같은 데이터를 사람이 읽는 쪽으로 — 이름 공식 · 토큰 · 지역 표 · 축소 방법 · 약어 · 종류 토큰 · tier · 딸린 리소스 · 마법사 프리셋

### 지원 리소스

이번 릴리스에서 켠 것은 **GCP 136** 개 규칙이다(규칙 버전 `2026-10-12.4` · 엔진의 규칙 표에서 세고 `/llms.txt` 의 규칙 목록과 대어 본 값). **AWS 169 · Azure 377** 은 규칙 표에 있지만 아직 켜지 않았다 — 엔진과 시험은 셋을 다 돌리고, 화면 · API · `/llms.txt` · `/catalog.json` 은 GCP 만 내놓는다. 손으로 쓴 36개의 표와 공식 문서 링크는 위 [Supported resources](#supported-resources-136-rules) 에 있다. Azure 332개는 Azure 이름 규칙 표의 정형 행에서(`scripts/rules/build-azure-rules.mjs`), GCP 82개는 Compute Engine · Cloud KMS 디스커버리 문서의 정형 행에서(`scripts/rules/build-gcp-rules.mjs`), AWS 116개(물리 이름 23 · Name 태그 93)는 CloudFormation 리소스 스키마에서(`scripts/rules/build-aws-rules.mjs`) 들였다. 전체 목록은 `/llms.txt`, 아직 들이지 않은 행은 [docs/azure-intake-held.md](docs/azure-intake-held.md)(29행) · [docs/gcp-intake-held.md](docs/gcp-intake-held.md)(디스커버리 메서드 10행, 그리고 지원 범위 GCP 자산 유형 116종 가운데 규칙이 없는 23종 — 보류 5 · 사람이 짓는 이름 없음 13 · 이 엔진 밖에서 정해지는 이름 5) · [docs/aws-intake-held.md](docs/aws-intake-held.md)(33 타입) 에 있다. 생성기가 정형으로 읽지 못한 행 가운데 GCP 44개 · AWS 42개 · Azure 30개는 REST · API 참조와 제품 안내서, Azure 이름 규칙 표를 다시 읽고 손으로 넣었다(`src/core/rules/gcp-manual.ts` · `src/core/rules/aws-manual.ts` · `src/core/rules/azure-manual.ts`, 규칙마다 원문 인용). 손으로 쓴 규칙마다 공식 문서와 대조한 기록은 [docs/rule-verification.md](docs/rule-verification.md)(영어) 다.

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

[examples/terraform/](examples/terraform/README.md) — `data "http"` 로 `/v1/generate` 를 불러 받은 이름 · 라벨로 `google_compute_instance` 를 만든다. `valid` 가 `true` 이고 라벨 위반이 없을 때만 apply 된다. `ignore_changes = [name]` 이 규칙이 바뀌어도 기존 VM 이름을 지키고, `rules_version` 은 규칙 변경을 409 로 알리고, `pinned` 는 이미 만든 이름으로 API 를 건너뛴다. 프로젝트 전체는 마법사의 **Terraform** 버튼이 항목 키를 맵 키로 하는 맵 `gcp_names` 하나를 주고, 예제 README 가 `/v1/wizard` 응답에서 같은 맵을 만드는 법을 보인다.

### 로컬 개발

Node 는 `.nvmrc`(22)를 따른다. 명령은 위 [Local development](#local-development) 와 같고, 정본은 `package.json` `scripts` 다. 빌드 산출물을 로컬에서 돌리려면 `npm run build && npx wrangler dev --port 8799`(빌드 없이 돌리면 옛 코드를 본다).

### 기여 · 보안

기여 방법은 [CONTRIBUTING.md](CONTRIBUTING.md) 다 — 모든 commit 에 [DCO](DCO) 서명(`git commit -s`)을 단다. 취약점은 [SECURITY.md](SECURITY.md) 대로 비공개로 신고한다.

### 프로젝트 상태

Cloudonym 은 Sungjae Yun 이 만들고 관리하는 독립 오픈소스 프로젝트다. 현재 · 이전 어느 고용주와도 관계가 없고, 후원을 받지 않으며, 고용주를 위해 개발한 것이 아니다.

### 라이선스

Copyright 2026 Sungjae Yun. Apache License 2.0 으로 배포한다 — 전문은 [LICENSE](LICENSE), 고지는 [NOTICE](NOTICE) 다. 라이선스는 코드에만 적용되고, Cloudonym 이름과 로고는 별도의 [상표 정책](TRADEMARKS.md)을 따른다.
