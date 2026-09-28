# Cloudonym Terraform 예제 (GCP) · Terraform example

## 한국어

`main.tf` 는 Cloudonym `/v1/generate` 에 다섯 문맥값(owner · system · purpose · env · region)을 보내고,
돌아온 GCP VM 이름과 라벨로 `google_compute_instance` 를 만든다.

- 호출은 `data "http"`(hashicorp/http `~> 3.6`) 의 `POST` 다. 이름 규칙은 API 에 있고 이 파일에는 없다
- 응답 경로 — 이름 `data.gcp.compute_instance.name` · 판정 `data.gcp.compute_instance.valid` ·
  라벨 `metadata.generated_labels.gcp` · 라벨 위반 `metadata.label_violations.gcp`
- **apply 차단** — `valid` 가 `true` 이고 라벨 위반이 없을 때만 VM 을 만든다(`lifecycle { precondition }`).
  API 가 400 을 돌려주면 `data "http"` 의 `postcondition` 이 API 의 오류 문구를 그대로 보여 준다
- `region` 은 이름에 들어가는 Cloudonym 코드(`kr` · `us` · `jp` · `eu` · `global`)다. VM 이 놓일 GCP 위치는 `gcp_zone` 으로 따로 준다
- `cloudonym_api_url` 에는 기본값이 없다 — 배포한 Worker 의 URL(또는 로컬 `npm run dev` 가 찍는 URL)을 넣는다. 끝에 `/` 와 `/v1` 을 붙이지 않는다

```sh
cat > terraform.tfvars <<'TFVARS'
cloudonym_api_url = "http://localhost:PORT"   # npm run dev 가 찍는 URL 로 바꾼다
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

`terraform.tfvars` 는 커밋하지 않는다(`.gitignore`). GCP 자격은 `gcloud auth application-default login` 등 google provider 의 방식을 따른다.
Cloudonym 의 판정은 CSP 의 최종 판정을 대신하지 않는다 — 알려진 예약어만 검사하고 일부 한도는 보수적으로 잡는다.

## English

`main.tf` sends the five context values to Cloudonym's `/v1/generate` and creates a
`google_compute_instance` with the returned GCP VM name and labels.

- The call is a `POST` from `data "http"` (hashicorp/http `~> 3.6`). Naming rules live in the API, not in this file.
- Response paths: `data.gcp.compute_instance.name`, `data.gcp.compute_instance.valid`,
  `metadata.generated_labels.gcp`, `metadata.label_violations.gcp`.
- **Apply is blocked** unless `valid` is `true` and there are no label violations (`lifecycle { precondition }`).
  If the API answers 400, the `postcondition` on `data "http"` surfaces the API's error message.
- `region` is the Cloudonym region code used in the name (`kr`, `us`, `jp`, `eu`, `global`); the GCP location is `gcp_zone`.
- `cloudonym_api_url` has no default. Set it to your deployed Worker URL (or the URL `npm run dev` prints), without a trailing `/` or `/v1`.

Do not commit `terraform.tfvars`. Cloudonym does not replace the cloud provider's final check:
it only knows documented reserved words, and some limits are deliberately conservative.
