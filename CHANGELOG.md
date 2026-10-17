# Changelog

All notable changes to Cloudonym are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the engine version follows [Semantic Versioning](https://semver.org/). Every response also carries a **rules revision** (`YYYY-MM-DD.N`), which changes whenever the same input could produce a different name, verdict, suggestion or label. Decision numbers (`D45` …) refer to [docs/decisions.md](docs/decisions.md).

## [Unreleased]

### Security

- **Rate limiting counts IPv6 clients per /64** — `/v1/*` POSTs, `/llms.txt` and `/catalog.json` used the full IPv6 address as the limiter key, so one client holding a /64 could rotate addresses past the 60-per-minute limit. IPv4 keys are unchanged.
- **HTTPS only** — plain HTTP now gets a 301 to HTTPS, and every response carries `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Both come from the zone settings, not the Worker.
- Development dependencies updated with `npm audit fix` (wrangler, miniflare, undici, sharp, source-map-js); the production bundle had no advisories.

## [0.1.9] - 2026-10-17

Search engines can confirm site ownership, and the site can tell IndexNow about its pages. Rules revision for this release: 2026-10-17.1 (unchanged); no name, verdict or suggestion changes.

### Added

- **Search-engine ownership checks and IndexNow** (D120) — the home page carries the Naver site-verification meta tag, `/robots.txt` ends with the Daum webmaster line, and `/<key>.txt` serves the IndexNow key; all three values come from `wrangler.jsonc` `vars` and are left out when unset. `scripts/indexnow-ping.mjs <BASE>` submits the URLs of a deployed site's sitemap to IndexNow.

## [0.1.8] - 2026-10-17

The naming wizard grows five cards — Data warehouse (BigQuery), GKE cluster, Event pipeline (Pub/Sub), CI/CD (Cloud Build) and Batch job — with their presets, cards in one service share the parts they have in common, the CI/CD card can connect a GitHub repository, and the wizard opens with a headline. Every card except HTTPS load balancer was built and tested on Google Cloud under its exported names.

Rules revision for this release: 2026-10-17.1. New wizard presets and two new Google Cloud rules; no name, verdict or suggestion for an existing input changes. Some cards now produce more or different names because their parts changed (see Changed).

### Added

- **Cloud Build connection and repository rules** (D118, D119) — `gcp.cloudbuild_connection` (`conn`, `google_cloudbuildv2_connection.name`; unique per location and project, with a region token) and `gcp.cloudbuild_repository` (`repo`, `google_cloudbuildv2_repository.name`; unique in its connection, no region token): the REST reference's characters (letters, digits and `-._~%!$&'()*+,;=@`), 1 to 59 characters each. No page states a length, so it comes from the server: a connection longer than 181 characters minus the location name cannot be read or deleted after it is created, and a repository is refused once connection, repository and location name total more than 141 characters; the rules split what is left in the longest location name evenly. Generated names use lowercase letters, digits and hyphens.
- **GitHub connection option on the CI/CD card** (D119) — presets `conn` and `repo` (service level), off by default: the trigger builds on pushes to the linked repository. Built and tested on Google Cloud with a private GitHub repository: the connection and the linked repository took the exported names, a push to the repository started the trigger, the build ran as the card's service account, the image reached the card's Artifact Registry repository and the step logs reached Cloud Logging.
- **Five more wizard cards** (D114) — **Data warehouse (BigQuery)** (a landing bucket, a BigQuery dataset whose name uses underscores, a service account; a Cloud Scheduler job as an option), **GKE cluster** (the cluster, an Artifact Registry repository and a node service account on the project's VPC network and subnet; Memorystore for Redis as an option), **Event pipeline (Pub/Sub)** (topic, subscription, dead-letter topic, Cloud Run service, service account), **CI/CD (Cloud Build)** (Artifact Registry repository, Cloud Build trigger, service account; a secret as an option) and **Batch job** (Cloud Run job, Cloud Scheduler job, service account). Their rules are checked against the official documents, and all five sets were then built and tested on Google Cloud (D117).
- **Nine wizard presets** for those parts: `bq`, `ar`, `topic`, `sub`, `dlq` (a Pub/Sub topic with the tier `dlq`), `build`, `cron`, `runjob` and `redis`, also accepted by `POST /v1/wizard` and listed in `/llms.txt`.
- **Several cards in one service** (D115, D116) — a service account, Artifact Registry repository, secret, Cloud SQL instance or bastion that a service already has is shared by every card that needs one, so Event pipeline, CI/CD and Batch job hold one service account and GKE and CI/CD one repository. Removing a card keeps what another card in the service still uses, and the checklist says which card uses a shared part. Every pair of the ten cards can now share a service except two load balancers (a service has one URL map with one default backend; the second goes in another service).
- **Six wizard presets for the second of a kind** (D116) — the same rule with its own tier, so two cards that need the same kind of resource for different jobs both get a name: `intweb` and `intwas` (internal web and app servers), `worker` (a private Cloud Run service, tier `worker`), `raw` (a landing bucket), `ingest` (a scheduled load job) and `appdata` (an app bucket). Each tier is checked against the reserved tokens (abbreviations, kind tokens, environment values, region and zone codes).

### Changed

- **Cards fixed after building them on Google Cloud** (D117) — every card except HTTPS load balancer was created under its exported names and checked to work. Two parts were missing: **Internal app on VMs** now adds the firewall rule `internal` (`…-fw-internal-01`, a new firewall tier for the web and app ports between servers inside the network; without it a user VPC blocked HTTP to the internal servers even from the bastion), and so does **Website**'s App server option (the web server could not reach the app server). **Event pipeline** now adds a subscription on its dead-letter topic (`dlqsub`, `…-sub-dlq-01`): messages sent to a topic with no subscription are lost. The five cards added in D114 are now marked as built and tested.
- **Card parts with their own tier** (D116) — **Internal app on VMs** names its servers `…-gce-intweb-01` and `…-gce-intwas-01` (was `…-gce-web-01`, `…-gce-was-01`) and its Object storage option `…-gcs-appdata`; **Event pipeline** names its Cloud Run service `…-run-worker-01` (was `…-run-01`); **Data warehouse** names its landing bucket `…-gcs-raw` (was `…-gcs`) and its scheduled load `…-cron-ingest-01` (was `…-cron-01`). Picks made with the plain chips keep their names; an older share link with `web`, `was` and `db` shows those resources without the Internal app card.
- **The first screen does not count the project values** — the intro line and the Project subtitle say "project values" instead of "four values", which disagreed with the headline's "five context values".
- **The wizard opens with a headline** (D113) — "Generate valid Google Cloud resource names." with a one-line explanation above the work area, on every screen width. The small header line it replaces is gone, and the intro example is labelled as sample output that does not come from your inputs.

## [0.1.7] - 2026-10-16

`/llms.txt` now opens with guidance for AI coding agents: call the API instead of composing names, how the engine shortens, and which rules a naming convention breaks. The Secrets Manager "hyphen and six characters" ending is a warning instead of a failure, shown in a new `warnings` list on the API and on the result cards. The site has its own mark on the favicon, the header and the share preview image.

Rules revision for this release: 2026-10-16.1. AWS Secrets Manager names ending in a hyphen and six characters are now valid with a warning; AWS is not enabled, so no Google Cloud name or verdict changes.

### Changed

- **Own mark for the favicon, the header and the share image** — the favicon was still the Vite template logo. It is now a round blue-to-violet badge with an open C (cloud) holding a lowercase n (name); the header shows the same file in place of the generic cloud icon at the same size, and the share preview image puts it left of the title (the image script reads `public/favicon.svg`, so the three cannot drift apart).
- **`/llms.txt` opens with guidance for AI coding agents** — a new first section, *For AI coding agents*, tells an agent not to compose names itself but to call `POST /v1/generate` or `POST /v1/names` and use the names as they come, and to check an existing name with `POST /v1/validate` and take `suggested_name`. It spells out how the engine shortens a name (the four steps, the abbreviation list, region codes) and lists, per enabled provider, the rules a naming convention breaks when applied word for word: no hyphen between tokens, characters most rules reject, maximums of 32 characters or less, and names unique across all customers. Every list is built from the rule table.
- **Secrets Manager: the "hyphen and six characters" ending is a warning, not a failure** (D112) — the AWS API reference says not to end a secret name with a hyphen followed by six characters because a search by partial ARN can then give unexpected results; it does not forbid it. Such names (`…-eu-west-1`, `…-A1b2C3`) were `valid: false` with `name.pattern_mismatch`; they are now `valid: true` with `warning.arn_suffix_lookalike` in a new `warnings` list. `warnings` appears on `/v1/validate` and on name items only when there is one; it never changes `valid`. When `/v1/validate` returns a `suggested_name` in that form, its warnings come in `suggested_warnings`, apart from the warnings of the name sent. Result cards on the web show warnings in their own list under the verdict, which stays PASS. AWS is not enabled yet, so no response changes today.

## [0.1.6] - 2026-10-15

Pages get a share preview image and the Privacy page a contact section and a last-updated date. The CLI no longer replaces a file with a partly written one and refuses a malformed names file. On phones, Esc right after opening a row is no longer lost.

Rules revision for this release: 2026-10-13.3 (unchanged — the same input gives the same names and verdicts).

### Changed

- **Share preview image** (D111) — pages carry `og:image` and `twitter:card` `summary_large_image`: a 1200×630 picture of the example inputs `demo · payment · prod · asia-northeast3` and three of the names they give, each PASS. The picture is drawn from the engine's intro example, and a test fails if the two drift apart.
- **Privacy page: contact and last-updated date** — `/privacy` ends with a *Contact and changes* section: questions go to GitHub issues, security problems to GitHub private vulnerability reporting (the same channel as SECURITY.md; no email address), and the page shows the date it was last changed. A test fingerprints the page text, so a change to the text fails until the date is updated with it.

### Fixed

- **Phone: Esc right after opening a row** — tapping a row moved focus to the Edit panel one frame later, so an Esc pressed in between went to the page and did nothing; focus now moves at once (and the same for going back to Plan).
- **CLI: a partial write no longer replaces the plan or names file** — when the disk accepts only part of the bytes, the CLI keeps writing until all are written and, if it cannot, leaves the original file untouched instead of replacing it with a truncated one.
- **CLI: a malformed names file is refused** — an environment whose `names` is not a list of `{ key, name }` (for example `"names": null`) made `validate` compare against nothing and report *same as the names file*; it now exits 2 like any other unreadable names file.

## [0.1.5] - 2026-10-15

Cloudflare Web Analytics, which Cloudflare adds to every page, is now allowed by the page CSP instead of failing with a console error, and the Privacy page says what it collects.

Rules revision for this release: 2026-10-13.3 (unchanged — the same input gives the same names and verdicts).

### Changed

- **Cloudflare Web Analytics is allowed** (D110) — Cloudflare adds its Web Analytics script to every page, and the page CSP blocked it with a console error. `script-src` now allows `https://static.cloudflareinsights.com` (the host only: the injected script path carries a version); the script sends to the site's own `/cdn-cgi/rum`, which `connect-src 'self'` already covers. `/privacy` gains a paragraph on what the script sends to Cloudflare and what Cloudflare states it does not collect, with links to Cloudflare's documentation; the README says the same in one sentence.

## [0.1.4] - 2026-10-15

The first screen says what the tool gives you: a read-only example of inputs and names at the top, and a first visit that opens on an example plan with its names already shown (Clear empties it). Tablets and phones open the names with a bar at the bottom. A new About page covers what the tool checks, the source, the license and the versions. The local dev server renders again; production headers are unchanged.

Rules revision for this release: 2026-10-13.3 (unchanged — the same input gives the same names and verdicts).

### Changed

- **First visit opens on an example plan** (D108) — with no link the wizard starts with `demo · payment · prod · asia-northeast3` and the `serverless-web` card on the `shop` service: 16 names, all PASS, with Copy all, JSON and Terraform ready. The Project panel marks the values as an **Example** and offers **Clear**, which returns to the empty start of 0.1.2 (D97). The example is not written to the address bar, and Share URL and Save plan appear only after the first change. Links open as before.
- **The intro example uses the same plan** (D108) — `demo · payment · prod · asia-northeast3` → the Project ID, the Cloud Run service and the HTTPS forwarding rule (below 768 px, the Cloud Run service).
- **Names bar** (D108) — on tablets (768–1279 px) the thin handle on the right edge is replaced by a bar at the bottom of the screen, *View N generated names (Terraform / JSON)*, that opens the names drawer; on phones the same bar switches to the Names tab and reads *View N names*, so it fits on one line at 360 px (D109).
- **Project ID note** — an info icon before the one-line summary.

- **First screen says what goes in and what comes out** (D107) — the intro box starts with a read-only example: `demo · payment · prod · asia-northeast3` → the Project ID, a Cloud Run service and an HTTPS forwarding rule, each marked PASS (below 768 px, the Cloud Run service only) — the same values as the example plan (D108). The names are produced by the engine at build time and checked by a test, not written by hand. The intro text is one sentence; "nothing is created" and "names are not checked for availability" moved next to the PASS paragraph under the names.
- **Tagline and page description** — the header tagline now reads "Enter owner, system, environment and region → Google Cloud resource names that pass the official rules"; the home page description follows it.
- **Project ID warning** — one line ("Project IDs are global and can never be reused.") with a **Why?** disclosure holding the full explanation.
- **PASS paragraph** — shown under the names only once at least one name is generated; the empty names column shows only its one-line prompt.

### Fixed

- **`npm run dev` shows the page again** (D108) — the dev server no longer sends the page CSP, which blocked Vite's inline script so only the header was drawn. Production pages keep the same CSP.

### Added

- **About page at `/about`** (D109) — what Cloudonym is, the intro's example, what PASS checks and what it does not, a link to the source repository, the Apache License 2.0 and NOTICE terms, the trademark note, the project status and the engine and rules versions. **About** in the **More** menu (wizard and `/pick`, phone included) opens it, and every page's footer links to it next to Privacy. The page can show the dismissed intro on the home page again. It is in `/sitemap.xml` with its own title and canonical URL.

Screen only: rules revision and every API response are unchanged.

## [0.1.3] - 2026-10-15

Search engines can read every page: each page has its own title, description and canonical link, unknown paths are 404, and `/robots.txt` and `/sitemap.xml` are served. The documentation is corrected and pull requests are checked for sign-off. Google Cloud only, as in 0.1.0.

Rules revision for this release: 2026-10-13.3 (unchanged — the same input gives the same names and verdicts).

### Changed

- **Unknown paths are 404** (D106) — a path that is not a page or a file used to return the home page with 200; it now answers 404 with a Not found page and `noindex`.
- **One address** (D106) — the Worker is no longer served on its `workers.dev` subdomain, so search engines see each page at one URL.
- **Home page description** — rewritten for people: "Generate and validate Google Cloud resource names that pass the official naming rules — web tool and API. AWS and Azure coming."
- **Phone header: everything in the More menu** (D105) — below 768 px the header keeps only the logo, the product name, the cloud badges and **More**; the tagline is not shown. **Share URL**, **Save plan** (wizard) and the screen mode move into the menu: Share URL and Save plan first, then the D104 items, then a **Screen mode** group of three items that shows the current mode. Share URL from the menu copies the same link and reports the result in a status line under the header; on a phone the share warning appears after Share URL is pressed, on `/pick` as well as in the wizard. At 360 px the wizard header is 107 px (was 189) and the `/pick` header 61 px (was 223); 768 px and wider are unchanged. Screen only: rules revision and every API response are unchanged.

### Fixed

- **Terraform example key** — `examples/terraform/README.md` now uses the item key `service/shop/compute_instance/-/web/01/data/01` (with the empty kind slot `-`), the key `POST /v1/wizard` actually returns for `wizard.json`; the old key without `-` matched nothing in `gcp_names`.
- **Documentation** — CONTRIBUTING lists `npm run test:cli` with the other local checks (six, as CI runs them) and names where rules live (`src/core/rules/`); SECURITY lists every endpoint (`/v1/names`, `/v1/wizard`, `/v1/health`, `/catalog.json`) and the repository CLI; `/openapi.json` states the license (Apache-2.0); `docs/rule-verification.md` and `docs/decisions.md` describe what they cover accurately.

### Added

- **Search engine pages** (D106) — each page has its own title, description, canonical link and Open Graph tags (WebApplication JSON-LD on the home page) and a short text summary readable without JavaScript; `/robots.txt` and `/sitemap.xml` are served. Absolute URLs come from the request's own origin. Screen and API responses are otherwise unchanged; rules revision unchanged.
- **DCO check** — a `dco` workflow fails a pull request when any of its commits lacks a `Signed-off-by:` line matching the commit's author email.
- **Community files** — issue forms for bugs and feature requests (blank issues off, vulnerabilities pointed to private security advisories), a pull request checklist and a Code of Conduct (Contributor Covenant 2.1).

## [0.1.2] - 2026-10-14

The wizard starts with the project values, saves and opens plan files, and gains a header menu; the API gains a guide page, capped error lists and a repository CLI. Google Cloud only, as in 0.1.0.

Rules revision for this release: 2026-10-13.3 (unchanged — the same input gives the same names and verdicts).

### Added

- **Command-line tool** (D102) — `cli/cloudonym.mjs` in the repository (not published to npm; Node 22, no dependencies) with `init`, `add`, `names` and `validate`. It edits a plan file and asks `POST /v1/wizard` for every name; `add` writes only when every existing name and verdict stays the same. Requests carry `User-Agent: cloudonym-cli/<version>`, counted as client class `cli`.
- **`/catalog.json` for clients** (D101) — each rule gains `input`, `tier` and `locations`, and each provider gains `presets`, `attachments` and `limits`. Rules revision unchanged.
- **Plan file** (D100) — the wizard's header has **Save plan**, which downloads the plan as the `POST /v1/wizard` request body plus `rules_version` and, with two or more environments, `environments` (`cloudonym-plan-<system>-<env>.json`), and **Open plan**, which loads such a file with the same repairs and notices as a share link. Unknown fields are ignored as the API ignores them (one notice line counts them), so a file gives the same names on the web and from the API; files over 176,548 bytes are not read. The file's JSON Schema is `/plan.schema.json`. `WizardRequest` gains an optional `environments` field that the API ignores, and `ui_copy` gains the target `plan-json` (Save plan; the file's content is not sent).
- **Release checks are not counted** (D99) — a request whose `x-cloudonym-telemetry-skip` header equals the new Worker secret `TELEMETRY_SKIP_TOKEN` is not written to KV or Axiom (constant-time comparison; with no secret set, the header is ignored). Rate limits and responses do not change. `scripts/release-check.sh` sends the header on every request when `CLOUDONYM_TELEMETRY_SKIP_TOKEN` is set, and warns when it is not.
- **API guide at `/docs/api`** (D98) — a page for people: every endpoint with what it does and whether it is rate limited, a curl example for each public endpoint built from the request example in `/openapi.json` (the host is the page's own address), the top level of each response, the rate limit with `429` and `Retry-After`, the failure shape, `version` and `rules_version` (`409`), what PASS means, the Terraform example and what is counted (with a Privacy link). The header has a new **API** link. `POST /v1/events` is listed as internal. Screen only: rules revision `2026-10-13.3` and every API response are unchanged.

### Changed

- **Echoed values in errors are cut to 40 characters** (D103) — every failure response cuts a user value echoed in `params.value` or `params.requested`, and the `message` built from it, to 40 characters followed by `…` (was 80). Values of 40 characters or fewer and lists such as `supported` are unchanged. The `/v1/names` 400 that was the worst case at 80 characters (200 unknown types, 111 KB) is now 74 KB; the largest measured now is 89 KB, still over 64 KB because `/v1/names` lists every error (200 resources may give over 400 errors). Rules revision unchanged.
- **`/llms.txt` covers the plan file, limits, `/catalog.json` fields and the CLI** — new sections `## Limits` (body size, rate limit with `429` and `Retry-After`, field, item and error caps, echoed values), `## Plan file` (D100), `## catalog.json fields` (D101) and `## CLI` (D102, with the exit codes), and a pointer to `/docs/api`. Every number comes from the server's constants. Rules revision unchanged.
- **Wizard and generate error responses are capped** (D103) — a `POST /v1/wizard` or `POST /v1/generate` 400 lists at most the first 50 errors; when there are more, the last entry is `request.errors_truncated` with `params: { shown, total }` (a 32 KB plan with broken slots made an 8 MB response, now 13 KB; a 32 KB `/v1/generate` body of unknown providers made 2.1 MB, now 6.5 KB). Responses with 50 errors or fewer, and `/v1/names`, `/v1/validate` and `/v1/events`, are unchanged.
- **Header More menu** (D104) — the header keeps **Share URL**, **Save plan** and the screen mode switch outside and moves **Open plan**, **Pick resources** (or **Wizard** on `/pick`), **Naming guide**, **API** and **llms.txt** into a **More** menu (icon only on a phone). The menu follows the WAI-ARIA menu button pattern (arrow keys, Home, End, Esc, Tab, a press outside closes it). The wizard header is one line at 1280 px and two at 360 px. Screen only: rules revision `2026-10-13.3` and every API response are unchanged.
- **Oversized links are not repaired** (D100) — a share link or plan file with more than 400 picks, or more than 400 servers and data disks, keeps only its project values instead of being repaired; repairs now fix independent places in one pass (a hand-made link with 200 broken picks took 1.2 s to open, now under 50 ms).
- **Request body limit 32 KB** (D100) — `POST /v1/*` accepts bodies up to 32,768 bytes (was 16,384), so a plan file saved from the wizard is accepted as it is; larger bodies are still 413 `request.body_too_large`.
- **Link and file notices** — "{n} invalid item(s) in this link were left out" now says "in this link or file".
- **Counts come from Axiom** (D99, revises D16) — KV daily counters are an approximate one-year trend; `/privacy`, `/docs/api` and the README say so.
- **README API section** — it no longer says there is no public domain; it says to use the deployed site's URL or your own Worker's, and points to `/docs/api`.
- **Cloud badges** — the header shows two badges instead of one: **Google Cloud** (solid, with a check — supported now) and **AWS · Azure coming soon** (dashed, muted). A screen reader hears "Supported now: Google Cloud. Coming soon: AWS and Azure."
- **Wizard first visit starts with the project values** (D97) — opening `/` with no link now starts with empty owner, system, environment and region; the example values are input placeholders only, and the network prefill (D90) is unchanged. The Project row is selected first (on a phone, the Edit tab), untouched empty fields show no errors, the Names column asks for the project values and offers no Copy all, JSON or Terraform until they are valid, and a **Next: what are you building** button then opens the first service's cards. No hash is written until the project values are valid. Links open exactly as before. Screen only: rules revision `2026-10-13.3`, `POST /v1/wizard` and `/v1/generate` are unchanged.
- **Intro and tagline** (D97) — the intro is a neutral note saying what Cloudonym does, what you get, what it does not do and the order of the steps, with a Naming guide link; the share-link warning appears only when Share is pressed. The header tagline names Google Cloud only (the badge beside it says AWS and Azure are coming); the page description says AWS and Azure come later. The intro's dismiss key is now `cloudonym:intro_dismissed_v2`, so a browser that closed the earlier note sees the new intro once.

## [0.1.1] - 2026-10-14

Rules revision for this release: 2026-10-13.3 (unchanged).

### Changed

- **Privacy: Axiom record copies** — `/privacy` states that the operator copies the Axiom records regularly to its own storage and keeps each copy for two years, in addition to the 30-day retention of the Axiom dataset. A copy holds the same fields as the record. No code path, name or rule changes.

## [0.1.0] - 2026-10-13

The first public release. It opens **Google Cloud** only; the AWS and Azure rule data stays in the engine and its tests and is shown as "Coming soon".

Rules revision for this release: 2026-10-13.3.

### Added

- **Naming engine** for 136 Google Cloud resource types: generates a name from five context values (owner · system · purpose · env · region), shortens it in three steps (drop optional tokens → abbreviate and share the length budget → fail) and validates it against the provider's documented length, characters and reserved words. A name that cannot fit is returned with `valid: false` and the reasons; it is never cut into something the provider would reject. Every limit cites an official document.
- **Naming wizard** at `/` (D59, D64, D68, D84) — names a whole project in seven steps: project values (owner, system, environment, region) with the project name and ID, the required network (VPC, subnets, firewall rules, Cloud Router, Cloud NAT, private services access range), several services each named by its purpose, presets per service (web, app and bastion servers, file server, Cloud SQL database, Cloud Storage bucket, Cloud Run service, service account, secret, GKE cluster, Workload Identity pool and the parts of an HTTPS load balancer; any other catalog row as a custom pick), serverless or high-availability options, one line per server, attached disks and addresses, and the names grouped by project and service with JSON, Terraform `locals` (one map `gcp_names` keyed by the item key) and a share link (hash v4, D67).
- **Tier token** (D60) — an optional purpose token such as `web` or `was` after the abbreviation and kind token and before the sequence number (`…-gce-web-01`). Only the wizard fills it; it is never shortened, and abbreviations, kind tokens, environment values and region codes are rejected as tiers. A name without a tier is unchanged. Google Cloud resources with neither a sequence number nor a role take it right after the abbreviation (D74), so the wizard can name two buckets in one service (`…-gcs-uploads`, `…-gcs-backups`).
- **Instance slots with stable numbers** (D61) — each server keeps its sequence number; removing server 01 does not rename server 02.
- **Attached resources** (D62) — a VM's boot disk, data disks and reserved external and internal addresses are named after the VM's final name (`…-gce-web-01-boot`, `-data-01`, `-ip`, `-ipi`) and are never shortened; if the VM's name fails, they get no name.
- **`POST /v1/wizard`** (D66, D69) — names a whole project in one request: the project ID, project-level items and several services, with structured item keys (`service/shop/compute_instance/-/web/01/data/01`), labels per namespace, conflicts checked across the whole project, and errors that name the request element (`services[0].picks[0].instances[0].attach.data[1]`). `/v1/generate`, `/v1/names` and `/v1/validate` are unchanged.
- **Cloud Run service rule** (D65) — `gcp.run_service` (abbreviation `run`, 1–49 characters), so `/v1/generate` returns one more item; also offered as the serverless choice of web and app servers.
- **Eleven rules for small stacks** (D72) — Cloud SQL database (`db`) and user (`user`), Cloud NAT (`nat`), Pub/Sub topic (`topic`) and subscription (`sub`), Cloud Build trigger (`trigger`), Cloud DNS managed zone (`dns`), Cloud Scheduler job (`cron`), BigQuery dataset (`bq`), Memorystore for Redis instance (`redis`) and Cloud Tasks queue (`queue`). Each constraint quotes the official page it comes from; Artifact Registry repositories and Cloud Run jobs were held because no page states their length or characters.
- **Project name rule** (D85) — `gcp.project_name` (4–30 characters: letters, digits, single quotes, hyphens, spaces or exclamation points, ending with a letter or digit; not unique and editable at any time). It is generated from the same values as the project ID, so `/v1/generate` returns one more item; `/v1/validate` accepts names such as `Team's app!2`.
- **Project ID suffix** (D85) — an optional `project_id_suffix` on `POST /v1/wizard` (hash key `x`) is appended to the project ID as a protected token (`platform-billing-prod-team1`; tier pattern and reserved words apply, item key unchanged). Project IDs are unique across Google Cloud and never reusable, and Cloudonym cannot check whether one is free (`projects.get` needs `resourcemanager.projects.get`), so a suffix the user owns is the way to keep a predictable ID unique.
- **Wizard screen order** (D84) — Project → Network → Services (what runs, options, attached) → **Shared extra resources** for project-level custom picks → Names (the step numbers were removed by D93). ① shows the project name above the project ID and takes the optional **Project ID suffix**, with a notice that Cloudonym cannot check whether an ID is free.
- **Subnets by kind and tier** (D86) — **Add subnet** adds another subnet with its own kind and tier (`…-snet-01`, `…-snet-proxy-01`, `…-snet-web-01`). The wizard's duplicate key and item key carry the kind token (`project/-/subnet/proxy/-/01`); a `POST /v1/wizard` request with two subnets that differ only in kind is accepted.
- **Firewall chips `iap` and `lbhc` and typed tiers** (D87) — IAP TCP forwarding (`35.235.240.0/20`) and load balancer health checks (`35.191.0.0/16` and the other probe ranges); a text field adds a firewall rule with any other valid tier.
- **Private services access range chip** (D88) — `psa`: a global internal address (`billing-prod-ip-int-psa-01`) with its kind fixed to `INTERNAL`; another kind is `wizard.preset_kind_fixed`, and `kind: null` is `selection.unknown_kind` as on `/v1/names`.
- **Cloud Run job and Artifact Registry repository** (D80) — `gcp.run_job` (`crj`) and `gcp.artifact_registry_repository` (`ar`): lowercase letters, digits and hyphens, 1–63 characters, a letter first and no hyphen last. No page states these limits, so each rule carries `evidence` — the server's response to real requests (2026-10-12) and, for jobs, the validation code of the Google Cloud SDK — next to its how-to `docUrl`, and the note `note.observed_server_rule`.
- **Wizard cards** (D93) — the first screen asks what you are building and offers five cards: **Website** (a web server behind an HTTPS load balancer with the HTTP-to-HTTPS redirect and the firewall rules `web` and `lbhc`; a Cloud SQL database on by default), **Serverless web** (Cloud Run behind a serverless NEG), **Static site** (a bucket behind a backend bucket), **Internal app on VMs** and **HTTPS load balancer**. A card adds plain preset picks in one click — the company website task went from 18 clicks to 3 at 1280 px. The screen reads cards back from the picks, shows a checklist with each part's name, warns when a part is missing and keeps network parts when a card is removed; share links and `POST /v1/wizard` carry no card. New presets `neg` (serverless NEG) and `bb` (backend bucket). Chips move into a closed **Add more to this service** section; the network is one row, step numbers are gone, names are one short row each, and phones get **Plan · Edit · Names** tabs instead of the settings sheet. `/llms.txt` lists the cards.
- **Screen mode** (D94) — **Light · Dark · System** in the header and on the naming guide and privacy pages, applied before the first paint and kept in `localStorage` (`cloudonym:theme`); System follows the device.
- **Wizard chips for common services** (D73) — `run` (Cloud Run service, apart from the serverless option of web and app servers), `sa` (service account, with its role), `secret`, `gke` and `wip` (Workload Identity pool; providers stay a custom pick) per service; a **Load balancer** row per service with the seven parts of an HTTPS load balancer (`ip`, `bs`, `hc`, `url`, `cert`, `thps`, `fwd`), one name each and not linked to one another; and `router` and `nat` with the project network. The kind select is labelled per resource instead of "Engine".
- **Underscore separator** (D72) — rules whose names take no hyphens (BigQuery dataset, Cloud SQL database and user) join their tokens with `_` (`billing_shop_prod_ane3_bq`); a hyphen inside a token becomes `_`.
- **Web UI in four steps**, now at `/pick` (D68) — ① Cloud ② Context ③ Resources (a tree grouped by the scope in which Google Cloud requires a name to be unique, with search, categories, a count per resource, a scope choice for merged rows, a one-line description and where the name is entered) ④ Names (PASS / FAIL per name with the reasons, copy one name, all valid names, names JSON, Terraform locals or the standard labels). The state lives in the URL hash, so a link restores the same screen; a tree link opened at `/` moves to `/pick` (D76).
- **API** — `POST /v1/generate` (every resource type), `POST /v1/names` (the picked resources, with count, role and kind), `POST /v1/validate`, `GET /v1/health`, `POST /v1/events`. Successful responses carry `version: { engine, rules }`; `rules_version` in a request turns a rules change into a 409.
- **For AI coding agents** — `GET /llms.txt` (formulas, canonical values, regions, kind tokens, the tier token, attached resources, wizard presets, abbreviations with their sources, every rule), `GET /openapi.json` and `GET /catalog.json` (the resource catalog and region table of the enabled providers), all generated from the same data as the engine.
- **Region codes per provider** (D49) — `asia-northeast3` → `ane3`. The `region` field takes a region or a zone, by name or by code, or `global`; global resources carry no region token.
- **Multi-region and dual-region locations** (D78) — Cloud Storage buckets take `US`, `EU`, `ASIA` and the predefined dual-regions `ASIA1`, `EUR4`, `EUR5`, `EUR7`, `EUR8`, `NAM4`; BigQuery datasets take `US` and `EU`. Both now carry a region token, the region or the location code (`…-prod-us-gcs`). Other resources refuse a location (`name.location_unsupported`, 400 `context.location_unsupported` on the API); the wizard sets it per bucket or dataset pick with a **Location** select. A secret pick has the same select (D79): **Global** by default, with no region token, or **Regional** for a regional secret in the project region.
- **Bucket name Check** (D83) — a valid Cloud Storage bucket name has a **Check** button on its card. Only when it is clicked, the browser asks the Cloud Storage JSON API anonymously (`GET https://storage.googleapis.com/storage/v1/b/<name>?fields=name`) and shows available (404), taken (200, 401, 403) or could not tell (anything else, a network error or 8 seconds without an answer). The request does not pass through Cloudonym and is not counted; `/privacy` says so, and the CSP `connect-src` allows `https://storage.googleapis.com`.
- **Several environments in one wizard plan** (D82) — the wizard's **Environments** chips take one or more values; the same plan is named once per environment, the names are grouped by environment, the JSON export carries `environments` and the Terraform export `gcp_names_by_env` and `gcp_labels_by_env`. A share link with several environments carries them in a new hash key `e`; a link with one environment is unchanged. `POST /v1/wizard` and its telemetry are unchanged.
- **Five more environment values** (D81) — `qa`, `uat`, `test`, `perf` and `dr` join `prod`, `stg`, `dev` and `sbx`, with the aliases `quality`, `acceptance`, `testing`, `tst`, `performance`, `load`, `disaster` and `recovery`. None of them is an abbreviation, kind token, tier or region or location code; all of them are now reserved as tiers.
- **Kind token** (D52) — an optional value such as `POSTGRES` adds a short token after the abbreviation (`…-sql-pg-01`) when it differs from the provider default. Resource policies require one (`name.kind_required`).
- **Resource catalog** (D46, D47, D54) — `catalog/gcp.json` and `catalog/regions.json` are the source for abbreviations, uniqueness classes, region-token kind, allowed kinds, descriptions and search aliases; `npm run catalog` writes the typed constants the engine uses. A collision test keeps abbreviations, kind tokens, region codes and environment values apart.
- **Same-name conflicts** (D41, D47) — two items of the same uniqueness class with the same name are both `valid: false` with `name.conflict`, on `/v1/names` and on `/v1/generate`.
- **Naming guide** at `/docs/naming` (D57) — formulas, tokens, the region table, shortening, abbreviations, kind tokens, tiers, attached resources and wizard presets, rendered from the engine's own data.
- **Privacy page** at `/privacy` and usage counting that does not collect what you type (D56): KV day counters and, when configured, Axiom events with a client class instead of the User-Agent.
- **Terraform example** (`examples/terraform/`) that calls `/v1/generate` and blocks `apply` unless the name is valid.

### Changed

These changes were made before any public deployment, so no released name depends on the earlier scheme.

- The canonical environment is **`prod`** (D48); `prd`, `production`, `real` and `live` are accepted as aliases.
- **No region token without a location** (D77): service accounts, Workload Identity pools and their parts, OAuth clients, deny policies, workforce pools and their providers, policy bindings and principal access boundary policies (D79), and children that inherit their parent's location (KMS keys and import jobs, Spanner databases and backups, Artifact Registry rules, Cloud SQL databases and users, Cloud NAT) carry no region token. The service account also has no owner token (`billing-trade-prod-sa-sync`), so the default inputs no longer shorten any Google Cloud name. Secret Manager secrets have no region token unless the wizard pick asks for a regional secret (D79).
- The country values `kr`, `us`, `jp` and `eu` are no longer accepted for `region` (on Google Cloud `us` and `eu` are now the multi-region locations, D78); the error lists the matching region names. `global` now leaves the region slot empty instead of writing the word `global` into the name.
- **Names carry no zone** (D50 revised): a zone (`asia-northeast3-a` or `ane3a`) is accepted and resolved to its region, and zonal resources such as VMs and disks carry the region code like regional ones (`…-ane3-gce-01`, was `…-ane3a-gce-01`). The `name.zone_required` code is gone, the UI has no zone picker, and a share link stores the region code.
- Abbreviations come from the catalog, for example a Compute Engine VM is `gce` (was `vm`).
- The Spanner database abbreviation is **`spdb`** (was `db`, D72): `db` now names the Cloud SQL database, and Spanner names in the wild use `spanner` far more than `db`. The longer abbreviation can push a Spanner database name past 30 characters; it then drops its region token (`billing-trade-prod-ane3-db-01` becomes `billing-trade-prod-spdb-01`). Links made with the earlier rules revision show the rules-revision notice and open with the new names.
- `providers` defaults to the enabled providers; a request for a provider that is not enabled is 400 `request.provider_not_enabled` with the supported list.
- The home page `/` is the naming wizard and the four-step screen moved to `/pick` (D68); its share links now point to `/pick`, and older links opened at `/` still show it.
- Formulas gain an empty tier slot before the sequence number (D60). It is filled only by the wizard, so every name from `/v1/generate` and `/v1/names` stays character for character the same.
- Share links use hash v3 (D55): a link made for a provider that is not enabled keeps the free fields and `env` and resets the region and the selection.

### Security

- Telemetry never stores generated names, the five context values, the URL hash, the raw User-Agent, cookies or identifiers; tests check the whole payload text, the KV writes and the console logs, not only the keys (D56).
- The client IP is read only as the key of Cloudflare's rate-limit binding (60 requests per 60 seconds for `POST /v1/*`, `GET /llms.txt` and `GET /catalog.json`) and is not stored.
- `owner`, `system` and `purpose` are capped at 64 characters, and echoed user values are escaped and cut to 80 characters, to bound response size.
- Every rule pattern is tested for slow backtracking, and one definition of invisible characters is applied to every rule that would otherwise accept them.

### History

Cloudonym started as a three-provider naming engine with an API and a single-page UI, then grew a four-step screen, per-resource selection (`/v1/names`), documented uniqueness scopes and rule tables imported from official sources for AWS, Google Cloud and Azure (667 rules in all). Before the first release the scope was narrowed to Google Cloud and the naming scheme was replaced — `prod`, provider region codes, kind tokens and catalog abbreviations — and then the naming wizard was added, zone codes were taken out of names and the Cloud Run service rule was added, so that the first public names use the scheme that will be kept. AWS and Azure are planned for later releases.

[0.1.8]: https://github.com/uranos-studio/cloudonym/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/uranos-studio/cloudonym/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/uranos-studio/cloudonym/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/uranos-studio/cloudonym/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/uranos-studio/cloudonym/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/uranos-studio/cloudonym/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/uranos-studio/cloudonym/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/uranos-studio/cloudonym/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/uranos-studio/cloudonym/releases/tag/v0.1.0
