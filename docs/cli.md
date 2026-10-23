# Command-line tool (CLI)

[Back to README](../README.md) · [한국어](#한국어)

## Command-line tool (CLI)

The repository has a small command-line tool, `cli/cloudonym.mjs` (Node 22, no dependencies). `cli/package.json` makes it a package of its own, but it is not published to npm yet; run it from a clone with `node cli/cloudonym.mjs …`, `npm run cli -- …` or, after `npm link`, `cloudonym …`. It holds no naming rules: it edits a plan file (the [Plan file](web-ui.md#plan-file--save-plan-and-open-plan) the wizard saves) and asks the API for every name and verdict, so the web, the API and the CLI give the same names for the same rules revision. What it needs to know about presets, rules, numbered resources and limits comes from `/catalog.json`.

It calls the public deployment unless you say otherwise — there is nothing to set. To call another deployment (your own Worker, or `wrangler dev` at `http://127.0.0.1:8787`), pass `--server <origin>`, set `CLOUDONYM_SERVER`, or write `{ "server": "https://…" }` to `~/.config/cloudonym/config.json` (`$XDG_CONFIG_HOME/cloudonym/config.json` when that is set, `%APPDATA%\cloudonym\config.json` on Windows); the first one given wins, in that order. A config file that is not a JSON object is ignored with a warning; a `server` that is not a usable URL stops the command (exit 64) rather than falling back to the public deployment. `cloudonym --version` prints its version on stdout and the server it would call, with where that came from, on stderr.

**On a terminal, run `cloudonym` with no command** (or `cloudonym new`). It asks who runs the system, its name, the environments, the region and what you are building, then the details each part takes (how many, high availability, kind, disks and addresses). Every choice is a numbered list from `/catalog.json`, so you need no preset ids. It saves `cloudonym.plan.json` and `cloudonym.plan.names.json` and prints the names; a wrong answer is asked again with the server's reason. Once the plan file is there, `cloudonym` shows its names and `cloudonym add` with no arguments asks what to add, then checks and saves it the way `add` does. On a terminal names are a table (`--keys` adds each key):

```text
What                            Name                                    Unique in         Check
Project ID                      demo-payment-prod                       global            PASS
VPC network 01                  payment-prod-vpc-01                     Project · Global  PASS
Subnet 01                       payment-prod-ane3-snet-01               Project · Region  PASS
Web server 01 (shop)            payment-shop-prod-ane3-gce-web-01       Project           PASS
  boot disk                     payment-shop-prod-ane3-gce-web-01-boot  Project · Zone    PASS
Web server 02 (shop)            payment-shop-prod-ane3-gce-web-02       Project           PASS
  boot disk                     payment-shop-prod-ane3-gce-web-02-boot  Project · Zone    PASS
Database (Cloud SQL) 01 (shop)  payment-shop-prod-ane3-sql-pg-01        Project           PASS
global: unique across every customer of the provider — a name that passes can still be taken by someone else.

8 names · all valid · saved cloudonym.plan.json and cloudonym.plan.names.json
```

The **Unique in** column is where each name must be unique, from the scope table in `/catalog.json`: `global` names (a project ID, a bucket) are unique across every customer of the provider, so a name that passes can still be taken by someone else. When a menu has more than 12 parts, the first question lists groups (`a Shared by the project`, `b Compute`, …): pick a letter, type part of a name to filter, or type part numbers directly — the numbers are the same with or without groups.

Piped, in CI, with `--json` or `--output json|tsv`, or with `--no-input` (or `CLOUDONYM_NO_INPUT=1`) it never asks: the commands below work as they always did, and the output keeps its `name  key` lines. Where a question would be needed, `--no-input` exits 64 and names the flags to pass.

```sh
node cli/cloudonym.mjs init --from cloudonym-plan-billing-prod.json   # or: init --owner … --system … --env prod --region asia-northeast3
node cli/cloudonym.mjs names                          # every name; kept in cloudonym.plan.names.json
node cli/cloudonym.mjs add cloud_sql_instance --service shop --kind POSTGRES
node cli/cloudonym.mjs validate                       # exit 0 when every name is valid and matches the names file
```

- **`init --from`** takes a file saved with Save plan; share links are not read yet — open the link, press Save plan, then `cloudonym new --from <file>` (the same as `init --from`).
- **`add`** appends a pick to a service (`--service <purpose>`) or the project (`--project`); the first argument is a preset (`db`), a rule id (`gcp.cloud_sql_instance`) or a resource name (`cloud_sql_instance`). If the same pick is already there and the resource is numbered, it appends servers with the next free number instead (`01 03` → `04`). It sends the plan before and after, **in every environment of the plan** (`--env` only narrows what it prints), and **writes the file only if every existing name and verdict stays the same** and every new name passes; otherwise it prints what would change and exits 1 with the file untouched. It prints only the new names. A pick counts as the same when the rule, the kind token, the tier and the role match — the server's rule; a different `--location` alone is refused (exit 2), and `--ha` is ignored when servers are added to an existing pick. `--pick '<json>'` adds one pick in the request form; `--dry-run` checks without writing.
- **`names`** prints `name  key` per line (`--json` for machines: per environment, the same name fields as the wizard's JSON export), `--new` only keys not in the names file. With `environments` in the plan, it sends one request per environment. `--no-write` writes neither the plan nor the names file (with `--repin` the plan keeps its `rules_version`).
- **Saving** — every write holds `<plan>.lock` next to the file (an exclusive create) from the last check that the file is unchanged to the replace, then removes it. While it exists another command does not write and exits 2, so two commands that read the same file cannot overwrite each other's change. A lock left by a command that was killed is not removed automatically: if no cloudonym command is running, delete it. If the file is saved but its lock cannot be removed, the command says the file is written, names the lock to delete and exits 2.
- **Exit codes** — `0` ok · `1` a name fails or `add` would change existing names or verdicts · `2` the plan, the names file or the arguments are rejected (400, 413), a file cannot be read or written, the plan changed while the command ran, or its lock could not be removed after saving · `3` the plan's `rules_version` differs from the server's (409; `names --repin` checks every environment, shows what changes and updates the plan) · `4` the server is unreachable, 429, 5xx, or a 2xx answer that is not JSON or has no `data.<provider>.items` (when every environment is unreachable, `names` shows the stored names and says they are not fresh) · `64` usage · `70` internal error. On 429 it prints `Retry-After`; `--wait` waits that long (at most 120 s; 60 s when the header is missing or unreadable) and retries **once per command**, so the longest wait of a many-environment `add` is one 120 s wait plus `--timeout` per request (at most 2147483647 ms).
- **Provider** — `init --provider gcp|aws|azure` (also `new --provider`; default `gcp`) writes the plan file's `provider`. One plan file is one provider: later commands read it from the file, and several clouds are several files (`-f aws.plan.json`). A provider the server has not enabled is refused with one line — `aws is not enabled on this server yet (this server supports gcp)` — and exit 2 (`init --provider` checks `/catalog.json` before writing).
- **Output** — `--output table|json|tsv` (`-o`); `--json` is `--output json`. `tsv` is a header line, then `env`, `what`, `name` and `check` per name (and `key` with `--keys`) — `cloudonym names -o tsv | cut -f3` gives the names alone. `--output table` prints the table even when piped.
- **Typos** — an unknown command or flag gets a suggestion (`valdate` → `Did you mean validate?`, exit 64), and an unknown resource for `add` lists the nearest preset and rule ids. `add 15` says that menu numbers work only in the questions of `cloudonym add` with no arguments, and which preset that number is.
- **Shell completion** — `cloudonym completion bash|zsh|fish` prints a completion script for the commands and flags: `source <(cloudonym completion zsh)`, `eval "$(cloudonym completion bash)"`, or `cloudonym completion fish > ~/.config/fish/completions/cloudonym.fish`.
- **Single executable** — `npm run build:cli-bin` builds a standalone `build/cli-sea/cloudonym` (Node single executable application: no Node needed to run it) with this machine's Node, checks it with `--version`, and writes a tar.gz, its sha256 and a filled Homebrew formula from `cli/packaging/homebrew/cloudonym.rb.tmpl`. Nothing is released or published; the build fetches `postject` with `npx` the first time.
- Each request carries `User-Agent: cloudonym-cli/<version>` and is counted as client class `cli` ([Privacy](../README.md#telemetry-and-privacy)). The CLI has no Terraform output: read the JSON with `jsondecode(file(...))`.

---

## 한국어

## 명령줄 도구 (CLI)

저장소에 작은 명령줄 도구 `cli/cloudonym.mjs` 가 있다(Node 22 · 의존성 없음). `cli/package.json` 이 따로 있어 npm 꾸러미 꼴은 갖췄지만 아직 npm 에 내지 않았다 — clone 한 저장소에서 `node cli/cloudonym.mjs …` · `npm run cli -- …` · `npm link` 뒤 `cloudonym …` 로 돈다. 이름 규칙을 들고 있지 않다 — 계획 파일(마법사의 Save plan 이 내려주는 파일)을 고치고 이름과 판정은 전부 API 에 묻는다. 그래서 같은 규칙 버전이면 웹 · API · CLI 가 같은 이름을 낸다. 프리셋 · 규칙 · 번호 붙는 리소스 · 상한은 `/catalog.json` 에서 읽는다.

따로 정하지 않으면 공개 배포를 부른다 — 설정할 것이 없다. 다른 배포(직접 띄운 Worker, `http://127.0.0.1:8787` 의 `wrangler dev`)를 부르려면 `--server <origin>` · 환경변수 `CLOUDONYM_SERVER` · 설정 파일 `~/.config/cloudonym/config.json`(`$XDG_CONFIG_HOME` 이 있으면 `$XDG_CONFIG_HOME/cloudonym/config.json`, 윈도우는 `%APPDATA%\cloudonym\config.json`)의 `{ "server": "https://…" }` 가운데 하나를 쓴다. 여럿이면 이 순서로 앞의 것이 이긴다. JSON 객체가 아닌 설정 파일은 경고 한 줄을 내고 건너뛰고, 쓸 수 없는 URL 의 `server` 는 공개 배포로 넘어가지 않고 명령을 멈춘다(exit 64). `cloudonym --version` 은 stdout 에 버전, stderr 에 부를 서버 URL 과 그 출처를 찍는다.

**터미널에서는 명령 없이 `cloudonym`**(또는 `cloudonym new`)만 치면 된다. 누가 운영하는지 · 시스템 이름 · 환경 · 리전 · 무엇을 만드는지를 묻고, 부품마다 받는 세부(개수 · 고가용성 · 종류 · 디스크와 주소)를 묻는다. 선택지는 전부 `/catalog.json` 에서 온 번호 목록이라 프리셋 id 를 몰라도 된다. 답하면 `cloudonym.plan.json` · `cloudonym.plan.names.json` 을 쓰고 이름을 보인다. 틀린 답은 서버가 준 이유와 함께 그 질문만 다시 묻는다. 계획 파일이 생긴 뒤에는 `cloudonym` 이 이름을 보이고, 인자 없는 `cloudonym add` 가 더할 것을 물어 `add` 와 같은 방식으로 확인하고 저장한다. 터미널에서 이름은 표다(`--keys` 는 키 칸을 더한다):

```text
What                            Name                                    Unique in         Check
Project ID                      demo-payment-prod                       global            PASS
VPC network 01                  payment-prod-vpc-01                     Project · Global  PASS
Subnet 01                       payment-prod-ane3-snet-01               Project · Region  PASS
Web server 01 (shop)            payment-shop-prod-ane3-gce-web-01       Project           PASS
  boot disk                     payment-shop-prod-ane3-gce-web-01-boot  Project · Zone    PASS
Web server 02 (shop)            payment-shop-prod-ane3-gce-web-02       Project           PASS
  boot disk                     payment-shop-prod-ane3-gce-web-02-boot  Project · Zone    PASS
Database (Cloud SQL) 01 (shop)  payment-shop-prod-ane3-sql-pg-01        Project           PASS
global: unique across every customer of the provider — a name that passes can still be taken by someone else.

8 names · all valid · saved cloudonym.plan.json and cloudonym.plan.names.json
```

**Unique in** 칸은 이름이 유일해야 하는 범위다(`/catalog.json` 의 범위 표). `global` 인 이름(프로젝트 ID · 버킷)은 그 CSP 의 모든 고객 사이에서 유일해야 하므로 PASS 여도 남이 이미 쓰고 있을 수 있다. 메뉴의 부품이 12개보다 많으면 첫 물음이 묶음(`a Shared by the project` · `b Compute` …)을 보인다 — 글자를 고르거나, 이름 일부를 쳐서 거르거나, 아는 번호를 바로 친다. 번호는 묶음이 있든 없든 같다.

파이프 · CI · `--json` · `--output json|tsv` · `--no-input`(또는 `CLOUDONYM_NO_INPUT=1`)에서는 묻지 않는다 — 아래 명령은 전과 같고, 출력도 `이름  키` 줄 그대로다. 물어야 하는 자리에서 `--no-input` 은 넘길 플래그를 알리고 64 로 끝낸다.

```sh
node cli/cloudonym.mjs init --from cloudonym-plan-billing-prod.json   # 또는 init --owner … --system … --env prod --region asia-northeast3
node cli/cloudonym.mjs names                          # 이름 전부 — cloudonym.plan.names.json 에 보관
node cli/cloudonym.mjs add cloud_sql_instance --service shop --kind POSTGRES
node cli/cloudonym.mjs validate                       # 이름이 전부 유효하고 보관 파일과 같으면 0
```

- **`init --from`** 은 Save plan 으로 받은 파일을 읽는다. 공유 링크는 아직 읽지 않는다 — 링크를 브라우저에서 열어 Save plan 을 누른 뒤 `cloudonym new --from <파일>`(`init --from` 과 같다)
- **`add`** 는 서비스(`--service <purpose>`)나 프로젝트(`--project`)에 pick 하나를 덧붙인다. 첫 인자는 프리셋(`db`) · 규칙 id(`gcp.cloud_sql_instance`) · 리소스 이름(`cloud_sql_instance`). 같은 pick 이 이미 있고 번호 붙는 리소스면 그 pick 에 다음 빈 번호로 서버를 더한다(`01 03` → `04`). 고치기 전과 뒤를 **계획의 모든 환경에서** 보내(`--env` 는 출력만 거른다) **기존 이름 · 판정이 하나도 바뀌지 않고** 새 이름이 모두 PASS 일 때만 파일을 쓴다. 아니면 바뀔 것을 보이고 파일을 그대로 둔 채 exit 1. 출력은 새 이름뿐이다. 같은 pick 은 규칙 · 종류 토큰 · tier · role 이 같은 것이다(서버의 판정). 위치만 다른 `--location` 은 거부하고(exit 2), 기존 pick 에 서버를 더할 때 `--ha` 는 쓰지 않는다. `--pick '<json>'` 은 요청 꼴 pick 하나, `--dry-run` 은 쓰지 않고 확인만
- **`names`** 는 한 줄에 `이름  키`(`--json` 은 환경마다 마법사 JSON 내보내기와 같은 칸), `--new` 는 보관 파일에 없는 키만. 계획에 `environments` 가 있으면 환경마다 한 번씩 보낸다. `--no-write` 는 계획 파일도 보관 파일도 쓰지 않는다(`--repin` 과 함께 주면 계획의 `rules_version` 도 그대로)
- **저장** — 쓸 때마다 파일 옆 `<계획>.lock` 을 배타적으로 만들어, 파일이 그대로인지 마지막으로 확인하는 때부터 바꿔 넣을 때까지 쥐고 끝나면 지운다. 잠금이 있으면 다른 명령은 쓰지 않고 exit 2 — 같은 파일을 읽은 두 명령이 서로의 변경을 덮지 않는다. 강제로 끝난 명령이 남긴 잠금은 저절로 지우지 않는다 — 도는 cloudonym 명령이 없으면 지운다. 저장은 됐는데 잠금을 못 지우면 저장됐다는 것과 지울 잠금 경로를 알리고 exit 2
- **종료 코드** — `0` 성공 · `1` FAIL 이 있거나 `add` 가 기존 이름 · 판정을 바꾼다 · `2` 계획 · 보관 파일 · 인자 거부(400 · 413), 파일을 못 읽거나 못 씀, 명령 도중 계획 파일이 바뀜, 저장 뒤 잠금을 못 지움 · `3` 계획의 `rules_version` 이 서버와 다르다(409 — `names --repin` 이 모든 환경을 확인해 바뀌는 것을 보이고 계획을 고친다) · `4` 못 닿음 · 429 · 5xx · JSON 이 아니거나 `data.<provider>.items` 가 없는 2xx 응답(모든 환경이 못 닿을 때만 `names` 가 보관 파일을 「새 값이 아님」이라 밝히고 보인다) · `64` 사용법 · `70` 내부 오류. 429 면 `Retry-After` 를 알리고, `--wait` 는 그만큼(상한 120초 · 헤더가 없거나 못 읽으면 60초) 기다려 **명령 전체에서 한 번** 다시 보낸다 — 환경이 여럿인 `add` 의 최악 대기는 120초 한 번에 요청마다 `--timeout`(상한 2147483647 ms)이다
- **provider** — `init --provider gcp|aws|azure`(`new --provider` 도 같다 · 기본 `gcp`)가 계획 파일의 `provider` 를 쓴다. 계획 파일 하나 = provider 하나다 — 그 뒤 명령은 파일에서 읽고, 여러 CSP 는 파일을 나눈다(`-f aws.plan.json`). 서버가 켜지 않은 provider 는 한 줄(`aws is not enabled on this server yet (this server supports gcp)`)과 exit 2 로 거부한다(`init --provider` 는 쓰기 전에 `/catalog.json` 을 본다)
- **출력** — `--output table|json|tsv`(`-o`) · `--json` 은 `--output json` 과 같다. `tsv` 는 머리 줄 하나 뒤에 이름마다 `env` · `what` · `name` · `check`(`--keys` 면 `key`) — `cloudonym names -o tsv | cut -f3` 이 이름만 낸다. `--output table` 은 파이프에서도 표다
- **오타** — 모르는 명령 · 플래그는 가까운 것을 제안한다(`valdate` → `Did you mean validate?` · exit 64). `add` 의 모르는 리소스는 가까운 프리셋 · 규칙 id 를 보인다. `add 15` 는 메뉴 번호가 인자 없는 `cloudonym add` 의 물음에서만 통한다는 것과 그 번호가 어느 프리셋인지 알린다
- **셸 완성** — `cloudonym completion bash|zsh|fish` 가 명령 · 플래그 완성 스크립트를 낸다: `source <(cloudonym completion zsh)` · `eval "$(cloudonym completion bash)"` · `cloudonym completion fish > ~/.config/fish/completions/cloudonym.fish`
- **단일 실행 파일** — `npm run build:cli-bin` 이 이 기계의 Node 로 `build/cli-sea/cloudonym`(Node single executable application — 돌릴 때 Node 가 필요 없다)을 만들고 `--version` 으로 확인한 뒤, tar.gz · sha256 · `cli/packaging/homebrew/cloudonym.rb.tmpl` 을 채운 Homebrew formula 를 쓴다. 릴리스 · 공개는 하지 않는다. 처음 한 번 `npx` 로 `postject` 를 받는다
- 요청마다 `User-Agent: cloudonym-cli/<버전>` 을 달고 client class `cli` 로 센다. Terraform 출력은 없다 — JSON 을 `jsondecode(file(...))` 로 읽는다
