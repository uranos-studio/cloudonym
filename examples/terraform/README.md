# Cloudonym Terraform example (GCP) · Terraform 예제

## English

`main.tf` sends the five context values to Cloudonym's `/v1/generate` and creates a
`google_compute_instance` with the returned GCP VM name and labels.

- The call is a `POST` from `data "http"` (hashicorp/http `~> 3.6`). Naming rules live in the API, not in this file.
- Response paths: `version` (`{ engine, rules }`), `data.gcp.compute_instance.name`, `data.gcp.compute_instance.valid`,
  `data.gcp.compute_instance.violations` / `.steps` (lists of `{ code, field?, params?, message }`),
  `metadata.generated_labels.gcp`, `metadata.label_violations.gcp`.
- **Apply is blocked** unless `valid` is `true` and there are no label violations (`lifecycle { precondition }`).
  This check runs in API mode only — see *Pinned mode* below.
  If the API answers 400 or 409, the `postcondition` on `data "http"` surfaces the API's error body
  (`{ "success": false, "errors": [{ "code", "message", … }] }`).
- `region` is the Cloudonym region code used in the name (`kr`, `us`, `jp`, `eu`, `global`); the GCP location is `gcp_zone`.
- `cloudonym_api_url` has no default. Set it to your deployed Worker URL (or the URL `npm run dev` prints), without a trailing `/` or `/v1`.

### Outputs

| Output | Value |
|---|---|
| `instance_name` | The VM's real name (`google_compute_instance.this.name`) |
| `cloudonym_valid` | Cloudonym's verdict on the candidate name; `null` in pinned mode (not checked) |
| `cloudonym_candidate_name` | The name Cloudonym proposes now, or the pinned name |
| `cloudonym_steps` | How the name was built (`steps[].message`) |
| `cloudonym_version` | `{ engine, rules }` that produced the name |

### Name stability

The `http` data source is read on every plan. A later rules revision can return a different name for the same
context, and renaming a VM means destroy + create. Three things keep the name stable:

1. **`ignore_changes = [name]`** in the VM's `lifecycle` block — an existing VM keeps its name even when
   `cloudonym_candidate_name` changes. To rename on purpose, remove that line and apply.
   `ignore_changes` does not skip the precondition: in API mode it still evaluates the **new** candidate name on
   every plan. If a later rules revision rejects your context, apply is blocked even though the VM would keep its
   old name — switch to pinned mode (3) to keep going.
2. **`rules_version`** — set it to `cloudonym_version.rules`. When Cloudonym's rules change, the API answers
   409 `request.rules_version_mismatch` instead of silently returning a different name.
3. **Pinned mode** — set `pinned = { name = "...", labels = { ... } }` to the values you already created.
   Cloudonym is not called at all (`count = 0`). Use it after a 409, or when the API is unreachable.
   Cloudonym never serves old rules revisions: keeping your created names is the way to stay on them.
   **Pinned names are not checked by Cloudonym.** The precondition is skipped and `cloudonym_valid` is `null` —
   the example makes no claim that a pinned name is valid. Pin only names you already created successfully.

```hcl
pinned = {
  name   = "payments-batch-prd-kr-vm-01"
  labels = { owner = "platform", system = "payments", purpose = "batch", environment = "prd", managed_by = "cloudonym" }
}
```

```sh
cat > terraform.tfvars <<'TFVARS'
cloudonym_api_url = "http://localhost:PORT"   # replace with the URL npm run dev prints
gcp_project       = "my-project-id"
owner             = "platform"
system            = "payments"
purpose           = "batch"
env               = "prd"
region            = "kr"
TFVARS

terraform init
terraform plan
```

Do not commit `terraform.tfvars`. PASS / `valid: true` means the name satisfies the documented naming checks of this
rules revision (length, pattern, reserved words). It does not mean the name is available or that you may create it —
uniqueness, permissions, quotas and organisation policy are not checked.

## 한국어

`main.tf` 는 Cloudonym `/v1/generate` 에 다섯 문맥값(owner · system · purpose · env · region)을 보내고,
돌아온 GCP VM 이름과 라벨로 `google_compute_instance` 를 만든다.

- 호출은 `data "http"`(hashicorp/http `~> 3.6`) 의 `POST` 다. 이름 규칙은 API 에 있고 이 파일에는 없다
- 응답 경로 — 버전 `version` · 이름 `data.gcp.compute_instance.name` · 판정 `.valid` ·
  위반 · 단계 `.violations` · `.steps`(`{ code, field?, params?, message }` 목록) ·
  라벨 `metadata.generated_labels.gcp` · 라벨 위반 `metadata.label_violations.gcp`
- **apply 차단** — `valid` 가 `true` 이고 라벨 위반이 없을 때만 VM 을 만든다(`lifecycle { precondition }`). API 모드에서만 본다 — 아래 핀 모드 참고
  API 가 400 · 409 를 돌려주면 `data "http"` 의 `postcondition` 이 API 의 오류 본문을 그대로 보여 준다
- `region` 은 이름에 들어가는 Cloudonym 코드(`kr` · `us` · `jp` · `eu` · `global`)다. VM 이 놓일 GCP 위치는 `gcp_zone` 으로 따로 준다
- `cloudonym_api_url` 에는 기본값이 없다 — 배포한 Worker 의 URL(또는 로컬 `npm run dev` 가 찍는 URL)을 넣는다. 끝에 `/` 와 `/v1` 을 붙이지 않는다

### 이름 안정성

`data "http"` 는 plan 마다 다시 불린다. 규칙이 바뀌면 같은 문맥에서 다른 이름이 나올 수 있고, VM 이름이 바뀌면 파괴 뒤 재생성이다.

1. **`ignore_changes = [name]`** — 이미 있는 VM 은 `cloudonym_candidate_name` 이 바뀌어도 이름을 지킨다. 일부러 바꾸려면 그 줄을 빼고 apply 한다.
   `ignore_changes` 가 precondition 을 건너뛰게 하지는 않는다 — API 모드에서는 plan 마다 **새 후보 이름**으로 검사한다. 나중 규칙 버전이 문맥을 거부하면 VM 이름은 그대로여도 apply 가 막힌다. 그때는 핀 모드(3)로 넘어간다
2. **`rules_version`** — `cloudonym_version.rules` 값을 넣는다. 규칙이 바뀌면 API 가 다른 이름을 조용히 주지 않고 409 `request.rules_version_mismatch` 로 알린다
3. **핀 모드** — `pinned = { name, labels }` 에 이미 만든 값을 넣으면 Cloudonym 을 부르지 않는다(`count = 0`). 409 를 받았거나 API 에 닿지 않을 때의 복구 경로다. Cloudonym 은 옛 규칙 버전을 서빙하지 않는다.
   **핀 값은 Cloudonym 이 검사하지 않는다** — precondition 을 건너뛰고 `cloudonym_valid` 는 `null` 이다. 예제는 핀 이름이 유효하다고 말하지 않는다. 이미 만들어 둔 이름만 핀으로 넣는다

`terraform.tfvars` 는 커밋하지 않는다(`.gitignore`). GCP 자격은 `gcloud auth application-default login` 등 google provider 의 방식을 따른다.
PASS(`valid: true`)는 이 규칙 버전의 이름 검사(길이 · 형식 · 예약어)를 통과했다는 뜻이지 그 이름을 쓸 수 있다는 뜻이 아니다 — 고유성 · 권한 · 할당량 · 조직 정책은 검사하지 않는다.
