# Changelog

All notable changes to Cloudonym are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the engine version follows [Semantic Versioning](https://semver.org/). Every response also carries a **rules revision** (`YYYY-MM-DD.N`), which changes whenever the same input could produce a different name, verdict, suggestion or label. Decision numbers (`D45` …) refer to [docs/decisions.md](docs/decisions.md).

## [0.1.0] - Unreleased

The first public release. It opens **Google Cloud** only; the AWS and Azure rule data stays in the engine and its tests and is shown as "Coming soon".

Rules revision for this release: 2026-10-10.8.

### Added

- **Naming engine** for 122 Google Cloud resource types: generates a name from five context values (owner · system · purpose · env · region), shortens it in three steps (drop optional tokens → abbreviate and share the length budget → fail) and validates it against the provider's documented length, characters and reserved words. A name that cannot fit is returned with `valid: false` and the reasons; it is never cut into something the provider would reject. Every limit cites an official document.
- **Naming wizard** at `/` (D59, D64, D68) — names a whole project in six steps: project values (owner, system, environment, region) and the project ID, project-level network, several services each named by its purpose, presets per service (web, app and bastion servers, file server, Cloud SQL database, Cloud Storage bucket; any other catalog row as a custom pick), serverless or high-availability options, one line per server, attached disks and addresses, and the names grouped by project and service with JSON, Terraform `locals` (one map `gcp_names` keyed by the item key) and a share link (hash v4, D67).
- **Tier token** (D60) — an optional purpose token such as `web` or `was` after the abbreviation and kind token and before the sequence number (`…-gce-web-01`). Only the wizard fills it; it is never shortened, and abbreviations, kind tokens, environment values and region codes are rejected as tiers. A name without a tier is unchanged.
- **Instance slots with stable numbers** (D61) — each server keeps its sequence number; removing server 01 does not rename server 02.
- **Attached resources** (D62) — a VM's boot disk, data disks and reserved external and internal addresses are named after the VM's final name (`…-gce-web-01-boot`, `-data-01`, `-ip`, `-ipi`) and are never shortened; if the VM's name fails, they get no name.
- **`POST /v1/wizard`** (D66, D69) — names a whole project in one request: the project ID, project-level items and several services, with structured item keys (`service/shop/compute_instance/web/01/data/01`), labels per namespace, conflicts checked across the whole project, and errors that name the request element (`services[0].picks[0].instances[0].attach.data[1]`). `/v1/generate`, `/v1/names` and `/v1/validate` are unchanged.
- **Cloud Run service rule** (D65) — `gcp.run_service` (abbreviation `run`, 1–49 characters), so `/v1/generate` returns one more item; also offered as the serverless choice of web and app servers.
- **Web UI in four steps**, now at `/pick` (D68) — ① Cloud ② Context ③ Resources (a tree grouped by the scope in which Google Cloud requires a name to be unique, with search, categories, a count per resource, a scope choice for merged rows, a one-line description and where the name is entered) ④ Names (PASS / FAIL per name with the reasons, copy one name, all valid names, names JSON, Terraform locals or the standard labels). The state lives in the URL hash, so a link restores the same screen; links made before the wizard still open this screen.
- **API** — `POST /v1/generate` (every resource type), `POST /v1/names` (the picked resources, with count, role and kind), `POST /v1/validate`, `GET /v1/health`, `POST /v1/events`. Successful responses carry `version: { engine, rules }`; `rules_version` in a request turns a rules change into a 409.
- **For AI coding agents** — `GET /llms.txt` (formulas, canonical values, regions, kind tokens, the tier token, attached resources, wizard presets, abbreviations with their sources, every rule), `GET /openapi.json` and `GET /catalog.json` (the resource catalog and region table of the enabled providers), all generated from the same data as the engine.
- **Region codes per provider** (D49) — `asia-northeast3` → `ane3`. The `region` field takes a region or a zone, by name or by code, or `global`; global resources carry no region token.
- **Kind token** (D52) — an optional value such as `POSTGRES` adds a short token after the abbreviation (`…-sql-pg-01`) when it differs from the provider default. Resource policies require one (`name.kind_required`).
- **Resource catalog** (D46, D47, D54) — `catalog/gcp.json` and `catalog/regions.json` are the source for abbreviations, uniqueness classes, region-token kind, allowed kinds, descriptions and search aliases; `npm run catalog` writes the typed constants the engine uses. A collision test keeps abbreviations, kind tokens, region codes and environment values apart.
- **Same-name conflicts** (D41, D47) — two items of the same uniqueness class with the same name are both `valid: false` with `name.conflict`, on `/v1/names` and on `/v1/generate`.
- **Naming guide** at `/docs/naming` (D57) — formulas, tokens, the region table, shortening, abbreviations, kind tokens, tiers, attached resources and wizard presets, rendered from the engine's own data.
- **Privacy page** at `/privacy` and usage counting that does not collect what you type (D56): KV day counters and, when configured, Axiom events with a client class instead of the User-Agent.
- **Terraform example** (`examples/terraform/`) that calls `/v1/generate` and blocks `apply` unless the name is valid.

### Changed

These changes were made before any public deployment, so no released name depends on the earlier scheme.

- The canonical environment is **`prod`** (D48); `prd`, `production`, `real` and `live` are accepted as aliases.
- The country values `kr`, `us`, `jp` and `eu` are no longer accepted for `region`; the error lists the matching region names. `global` now leaves the region slot empty instead of writing the word `global` into the name.
- **Names carry no zone** (D50 revised): a zone (`asia-northeast3-a` or `ane3a`) is accepted and resolved to its region, and zonal resources such as VMs and disks carry the region code like regional ones (`…-ane3-gce-01`, was `…-ane3a-gce-01`). The `name.zone_required` code is gone, the UI has no zone picker, and a share link stores the region code.
- Abbreviations come from the catalog, for example a Compute Engine VM is `gce` (was `vm`).
- `providers` defaults to the enabled providers; a request for a provider that is not enabled is 400 `request.provider_not_enabled` with the supported list.
- The home page `/` is the naming wizard and the four-step screen moved to `/pick` (D68); its share links now point to `/pick`, and older links opened at `/` still show it.
- Formulas gain an empty tier slot before the sequence number (D60). It is filled only by the wizard, so every name from `/v1/generate` and `/v1/names` stays character for character the same.
- Share links use hash v3 (D55): old links with a country region do not open, and a link made for a provider that is not enabled keeps the free fields and `env` and resets the region and the selection.

### Security

- Telemetry never stores generated names, the five context values, the URL hash, the raw User-Agent, cookies or identifiers; tests check the whole payload text, the KV writes and the console logs, not only the keys (D56).
- The client IP is read only as the key of Cloudflare's rate-limit binding (60 requests per 60 seconds for `POST /v1/*`, `GET /llms.txt` and `GET /catalog.json`) and is not stored.
- `owner`, `system` and `purpose` are capped at 64 characters, and echoed user values are escaped and cut to 80 characters, to bound response size.
- Every rule pattern is tested for slow backtracking, and one definition of invisible characters is applied to every rule that would otherwise accept them.

### History

Cloudonym started as a three-provider naming engine with an API and a single-page UI, then grew a four-step screen, per-resource selection (`/v1/names`), documented uniqueness scopes and rule tables imported from official sources for AWS, Google Cloud and Azure (667 rules in all). Before the first release the scope was narrowed to Google Cloud and the naming scheme was replaced — `prod`, provider region codes, kind tokens and catalog abbreviations — and then the naming wizard was added, zone codes were taken out of names and the Cloud Run service rule was added, so that the first public names use the scheme that will be kept. AWS and Azure are planned for later releases.
