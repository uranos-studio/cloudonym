#!/usr/bin/env bash
# 배포 전 확인 — 배포 URL 하나를 받아 공개 표면을 실측하고, 하나라도 틀리면 non-zero 로 끝난다.
#   scripts/release-check.sh [--skip-ratelimit] https://<worker-url>
# 빠른 검사를 전부 돌린 뒤, 모두 통과했을 때만 마지막에 요청 제한 단계(약 80초)를 돈다.
# 요청 제한은 「제한 발생과 회복」만 본다 — 바인딩은 최종 일관성이라 정확한 60/61 경계는 security.test.ts 의 fake limiter 가 고정한다.
# https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy
# --skip-ratelimit 은 로컬용이다. 건너뛴 단계는 SKIPPED 로 적고 통과로 세지 않는다.
# 필요한 것: curl · jq · perl
# 환경변수 CLOUDONYM_TELEMETRY_SKIP_TOKEN 이 있으면 모든 요청에 x-cloudonym-telemetry-skip 헤더를 달아 계측에서 뺀다 (D99) —
# 값은 Worker 비밀 TELEMETRY_SKIP_TOKEN 과 같아야 한다. 없으면 경고만 하고 계속한다(이 점검의 요청이 사용량에 섞여 세어진다).
# 값은 어디에도 찍지 않는다
set -u -o pipefail

usage() { echo "usage: $0 [--skip-ratelimit] <base-url>" >&2; exit 2; }

skip_ratelimit=0
base=''
for arg in "$@"; do
  case "${arg}" in
    --skip-ratelimit) skip_ratelimit=1 ;;
    -h|--help) usage ;;
    -*) echo "unknown option: ${arg}" >&2; usage ;;
    *) [ -z "${base}" ] || usage; base="${arg%/}" ;;
  esac
done
[ -n "${base}" ] || usage
for bin in curl jq perl; do
  command -v "${bin}" >/dev/null || { echo "missing dependency: ${bin}" >&2; exit 2; }
done

# /v1/names 의 기대 이름 — 규칙 버전 2026-10-22.1 의 엔진 출력이다(2026-10-13.3 과 같다 — 2026-10-22.1 은 AWS 약어만 바꿨다). 규칙이 바뀌면 이 검사가 실패하고, 그때 아래 요청을
# 새 빌드에 보내 값을 다시 적는다(조용히 통과하지 않는다)
NAMES_REQUEST='{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3"},"resources":[{"type":"vpc_network"},{"type":"storage_bucket"},{"type":"service_account","role":"db"}]}'
NAMES_EXPECTED='{"service_account_db":"payments-batch-prod-sa-db","storage_bucket":"platform-payments-batch-prod-ane3-gcs","vpc_network_01":"payments-batch-prod-vpc-01"}'
# /v1/wizard 의 기대 항목(순서 그대로 key=name) — 규칙 버전 2026-10-12.2 의 엔진 출력이다. 프로젝트 ID 가 먼저, 서비스마다 부모 뒤에 딸린 것.
# 규칙이 바뀌면 이 검사가 실패하고, 그때 아래 요청을 새 빌드에 보내 값을 다시 적는다
WIZARD_REQUEST='{"provider":"gcp","project":{"owner":"platform","system":"billing","env":"prod","region":"asia-northeast3"},"services":[{"purpose":"shop","picks":[{"preset":"web","instances":[{"id":"a","seq":"01","attach":{"boot":true,"data":["01"]}}]}]},{"purpose":"pay","picks":[{"preset":"web","instances":[{"id":"b","seq":"01","attach":{"boot":true}}]}]}]}'
WIZARD_EXPECTED='["project/-/project_id/-/-/-=platform-billing-prod","service/shop/compute_instance/-/web/01=billing-shop-prod-ane3-gce-web-01","service/shop/compute_instance/-/web/01/boot/-=billing-shop-prod-ane3-gce-web-01-boot","service/shop/compute_instance/-/web/01/data/01=billing-shop-prod-ane3-gce-web-01-data-01","service/pay/compute_instance/-/web/01=billing-pay-prod-ane3-gce-web-01","service/pay/compute_instance/-/web/01/boot/-=billing-pay-prod-ane3-gce-web-01-boot"]'
VALIDATE_REQUEST='{"provider":"gcp","resource_type":"storage_bucket","name":"payments-prod-bucket"}'
# public/_headers 의 CSP 와 같은 글자다
CSP="default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://storage.googleapis.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

work="$(mktemp -d)"
trap 'rm -f "${work}"/*; rmdir "${work}"' EXIT
hdr="${work}/headers"
body="${work}/body"

# 점검 헤더 — 값을 명령줄에 올리지 않도록(ps 에 보인다) 0600 파일에 쓰고 curl -H @파일 로 읽힌다. 파일은 끝날 때 trap 이 지운다
skip_args=()
if [ -n "${CLOUDONYM_TELEMETRY_SKIP_TOKEN:-}" ]; then
  (umask 077 && printf 'x-cloudonym-telemetry-skip: %s\n' "${CLOUDONYM_TELEMETRY_SKIP_TOKEN:-}" > "${work}/skip-header")
  skip_args=(-H "@${work}/skip-header")
fi

passed=0
failed=0
pass() { passed=$((passed + 1)); echo "PASS  $1"; }
fail() { failed=$((failed + 1)); echo "FAIL  $1 — $2"; }
info() { echo "INFO  $1"; }

# fetch <method> <route> [curl 인자…] — 헤더 · 본문을 파일에 쓰고 상태 코드를 돌려준다. 연결 실패는 000
fetch() {
  local method="$1" route="$2"
  shift 2
  : > "${hdr}"; : > "${body}"
  curl -sS --max-time 20 -X "${method}" -D "${hdr}" -o "${body}" -w '%{http_code}' ${skip_args[@]+"${skip_args[@]}"} "$@" "${base}${route}" 2>/dev/null || true
}
# header <이름> — 마지막 응답의 그 헤더 값(대소문자 무시, CR 제거)
header() { grep -i "^$1:" "${hdr}" | tail -1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'; }
# expect_status <검사 이름> <받은 코드> <기대 코드> — 맞으면 0
expect_status() {
  if [ "$2" = "$3" ]; then return 0; fi
  if [ "$2" = "000" ]; then fail "$1" "connection failed"; else fail "$1" "status $2, expected $3"; fi
  return 1
}

echo "release-check ${base}"
if [ "${#skip_args[@]}" -gt 0 ]; then
  echo "INFO  telemetry skip header sent — not counted only if it matches the Worker secret TELEMETRY_SKIP_TOKEN"
else
  echo "WARN  CLOUDONYM_TELEMETRY_SKIP_TOKEN is not set — these requests will be counted as usage"
fi
code="$(fetch GET /v1/health)"
if [ "${code}" = "200" ]; then
  info "version $(jq -c '.version' "${body}" 2>/dev/null)"
else
  info "/v1/health returned ${code}"
fi

# 1. 화면 — 200 · text/html · 한글 0 · 보안 헤더(화면 HTML 은 Worker 가 만들고 _headers 의 /* 줄을 그대로 단다 — D106)
name='GET /'
code="$(fetch GET /)"
if expect_status "${name}" "${code}" 200; then
  ctype="$(header content-type)"
  if [[ "${ctype}" != text/html* ]]; then fail "${name}" "content-type '${ctype}'"
  elif [ ! -s "${body}" ]; then fail "${name}" "empty body"
  elif ! grep -q 'id="root"' "${body}"; then fail "${name}" "no id=\"root\" mount point"
  elif ! perl -CSD -ne '$h = 1 if /\p{Script=Hangul}/; END { exit($h ? 1 : 0) }' "${body}"; then fail "${name}" "Hangul in body"
  else pass "${name} (200, ${ctype}, id=\"root\", no Hangul)"; fi
  cp "${body}" "${work}/root.html"
  name='_headers on /'
  if [ "$(header content-security-policy)" != "${CSP}" ]; then fail "${name}" "Content-Security-Policy is '$(header content-security-policy)'"
  elif [ "$(header x-content-type-options)" != "nosniff" ]; then fail "${name}" "X-Content-Type-Options is '$(header x-content-type-options)'"
  elif [ "$(header x-frame-options)" != "DENY" ]; then fail "${name}" "X-Frame-Options is '$(header x-frame-options)'"
  else pass "${name} (CSP, nosniff, X-Frame-Options: DENY)"; fi
fi

# 2. /llms.txt — 200 · text/plain · 하루 캐시 · CORS * · 첫 줄 · 소절은 AWS · GCP 만
name='GET /llms.txt'
code="$(fetch GET /llms.txt)"
if expect_status "${name}" "${code}" 200; then
  ctype="$(header content-type)"
  first="$(head -1 "${body}" | tr -d '\r')"
  sub_gcp="$(grep -c '^### GCP$' "${body}")"
  sub_aws="$(grep -c '^### AWS$' "${body}")"
  sub_other="$(grep -ciE '^### Azure' "${body}")"
  if [[ "${ctype}" != text/plain* ]]; then fail "${name}" "content-type '${ctype}'"
  elif [[ "$(header cache-control)" != *max-age=86400* ]]; then fail "${name}" "Cache-Control is '$(header cache-control)'"
  elif [ "$(header access-control-allow-origin)" != "*" ]; then fail "${name}" "Access-Control-Allow-Origin is '$(header access-control-allow-origin)'"
  elif [ "${first}" != "# Cloudonym" ]; then fail "${name}" "first line is '${first}'"
  elif [ "${sub_other}" != "0" ]; then fail "${name}" "${sub_other} Azure section(s)"
  elif [ "${sub_aws}" = "0" ]; then fail "${name}" "no '### AWS' section"
  elif [ "${sub_gcp}" = "0" ]; then fail "${name}" "no '### GCP' section"
  else pass "${name} (text/plain, max-age=86400, CORS *, '# Cloudonym', ${sub_aws} '### AWS' · ${sub_gcp} '### GCP' sections, no Azure)"; fi
fi

# 3. /catalog.json — 200 · provider 는 aws · gcp · aws 170행 · gcp 125행(run_service — D65 · 작은 스택 규칙 11개 — D72 · run_job · artifact_registry_repository — D80 · cloudbuild_connection — D118 · cloudbuild_repository — D119 · bigquery_table — D132 · Logging 셋 — D133 · workflow — D134 · tag_key · tag_value — D135 · network_firewall_policy — D136)
name='GET /catalog.json'
code="$(fetch GET /catalog.json)"
if expect_status "${name}" "${code}" 200; then
  providers="$(jq -c '.providers | keys' "${body}" 2>/dev/null)"
  rows="$(jq '.providers.gcp.rows | length' "${body}" 2>/dev/null)"
  aws_rows="$(jq '.providers.aws.rows | length' "${body}" 2>/dev/null)"
  if [ "${providers}" != '["aws","gcp"]' ]; then fail "${name}" "providers ${providers:-<not JSON>}"
  elif [ "${rows}" != "125" ]; then fail "${name}" "gcp rows ${rows:-<none>}, expected 125"
  elif [ "${aws_rows}" != "170" ]; then fail "${name}" "aws rows ${aws_rows:-<none>}, expected 170"
  else pass "${name} (providers [\"aws\",\"gcp\"], aws 170 · gcp 125 rows)"; fi
fi

# 4. /openapi.json — provider enum 셋이 모두 ["aws","gcp"]
name='GET /openapi.json'
code="$(fetch GET /openapi.json)"
if expect_status "${name}" "${code}" 200; then
  enums="$(jq -c '[.components.schemas.GenerateRequest.properties.providers.items.enum,
                   .components.schemas.NamesRequest.properties.provider.enum,
                   .components.schemas.ValidateRequest.properties.provider.enum]' "${body}" 2>/dev/null)"
  if [ "${enums}" != '[["aws","gcp"],["aws","gcp"],["aws","gcp"]]' ]; then fail "${name}" "provider enums (generate, names, validate) are ${enums:-<not JSON>}"
  else pass "${name} (provider enums [\"aws\",\"gcp\"] in generate, names, validate)"; fi
fi

# 5. 화면 경로 (D106 · D129 — 소개 페이지 / · 마법사 /aws · /gcp) — Worker 가 경로마다 head 를 넣는다: 200 · 제 <title> · canonical 은 그 경로 · 보안 헤더(CSP · DENY).
#    없는 경로 /does-not-exist-<랜덤> 은 404 · noindex · canonical 없음. 쪽의 내용(React 가 그리는 것)은 화면 시험이 본다
for route in / /aws /gcp /pick /docs/naming /docs/api /privacy /about; do
  name="GET ${route} head"
  code="$(fetch GET "${route}")"
  if expect_status "${name}" "${code}" 200; then
    title="$(grep -o '<title>[^<]*</title>' "${body}" | head -1)"
    canonical="$(grep -o '<link rel="canonical" href="[^"]*">' "${body}" | head -1)"
    if [[ "${title}" != '<title>Cloudonym — '* ]]; then fail "${name}" "title '${title}'"
    elif [ "${canonical}" != "<link rel=\"canonical\" href=\"${base}${route}\">" ]; then fail "${name}" "canonical '${canonical}'"
    elif grep -q 'noindex' "${body}"; then fail "${name}" "noindex on an indexed page"
    elif [ "$(header content-security-policy)" != "${CSP}" ]; then fail "${name}" "Content-Security-Policy is '$(header content-security-policy)'"
    elif [ "$(header x-frame-options)" != "DENY" ]; then fail "${name}" "X-Frame-Options is '$(header x-frame-options)'"
    else pass "${name} (200, ${title}, canonical ${base}${route}, CSP, DENY)"; fi
  fi
done
control="/does-not-exist-${RANDOM}${RANDOM}"
name="GET ${control} (unknown path)"
code="$(fetch GET "${control}")"
if expect_status "${name}" "${code}" 404; then
  if ! grep -q '<meta name="robots" content="noindex">' "${body}"; then fail "${name}" "no noindex"
  elif grep -q 'rel="canonical"' "${body}"; then fail "${name}" "canonical on a 404 page"
  elif ! grep -q 'id="root"' "${body}"; then fail "${name}" "no id=\"root\" mount point"
  elif [ "$(header content-security-policy)" != "${CSP}" ]; then fail "${name}" "Content-Security-Policy is '$(header content-security-policy)'"
  else pass "${name} (404, noindex, no canonical, CSP)"; fi
fi

# 5b. /robots.txt · /sitemap.xml (D106) — 절대 URL 은 요청 origin(= base)
name='GET /robots.txt'
code="$(fetch GET /robots.txt)"
if expect_status "${name}" "${code}" 200; then
  if [[ "$(header content-type)" != text/plain* ]]; then fail "${name}" "content-type '$(header content-type)'"
  elif ! grep -qx "Sitemap: ${base}/sitemap.xml" "${body}"; then fail "${name}" "no 'Sitemap: ${base}/sitemap.xml'"
  elif ! grep -qx 'Disallow: /v1/' "${body}"; then fail "${name}" "no 'Disallow: /v1/'"
  else pass "${name} (text/plain, Sitemap ${base}/sitemap.xml, Disallow /v1/)"; fi
fi
name='GET /sitemap.xml'
code="$(fetch GET /sitemap.xml)"
if expect_status "${name}" "${code}" 200; then
  locs="$(grep -o '<loc>[^<]*</loc>' "${body}" | sed -e 's#<loc>##' -e 's#</loc>##' | tr '\n' ' ')"
  want="${base}/ ${base}/aws ${base}/gcp ${base}/pick ${base}/docs/naming ${base}/docs/api ${base}/privacy ${base}/about "
  if [[ "$(header content-type)" != application/xml* ]]; then fail "${name}" "content-type '$(header content-type)'"
  elif [ "${locs}" != "${want}" ]; then fail "${name}" "locs '${locs}', expected '${want}'"
  else pass "${name} (application/xml, 8 URLs)"; fi
fi

# 6. POST /v1/names — 이름 셋 글자 그대로
name='POST /v1/names'
code="$(fetch POST /v1/names -H 'content-type: application/json' --data "${NAMES_REQUEST}")"
if expect_status "${name}" "${code}" 200; then
  valid="$(jq '.data.gcp.valid' "${body}" 2>/dev/null)"
  got="$(jq -cS '[.data.gcp.items[] | {(.key): .name}] | add' "${body}" 2>/dev/null)"
  if [ "${valid}" != "true" ]; then fail "${name}" "data.gcp.valid is ${valid:-<none>}"
  elif [ "${got}" != "${NAMES_EXPECTED}" ]; then fail "${name}" "names ${got:-<none>}, expected ${NAMES_EXPECTED}"
  else pass "${name} (3 names exact)"; fi
fi

# 6b. POST /v1/wizard — 대표 요청 하나(서비스 둘 · web VM · boot · data): 항목 여섯의 순서 · key · 이름 글자 그대로
name='POST /v1/wizard'
code="$(fetch POST /v1/wizard -H 'content-type: application/json' --data "${WIZARD_REQUEST}")"
if expect_status "${name}" "${code}" 200; then
  valid="$(jq '.data.gcp.valid' "${body}" 2>/dev/null)"
  got="$(jq -c '[.data.gcp.items[] | "\(.key)=\(.name)"]' "${body}" 2>/dev/null)"
  if [ "${valid}" != "true" ]; then fail "${name}" "data.gcp.valid is ${valid:-<none>}"
  elif [ "${got}" != "${WIZARD_EXPECTED}" ]; then fail "${name}" "items ${got:-<none>}, expected ${WIZARD_EXPECTED}"
  else pass "${name} (6 items exact, in order)"; fi
fi

# 7. OPTIONS /v1/names — preflight 204 · CORS 셋(요청 헤더를 보내야 Allow-Headers 가 의미가 있다)
name='OPTIONS /v1/names'
code="$(fetch OPTIONS /v1/names -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type')"
if expect_status "${name}" "${code}" 204; then
  methods="$(header access-control-allow-methods)"
  if [ "$(header access-control-allow-origin)" != "*" ]; then fail "${name}" "Access-Control-Allow-Origin is '$(header access-control-allow-origin)'"
  elif [[ ",${methods}," != *,POST,* ]]; then fail "${name}" "Access-Control-Allow-Methods is '${methods}'"
  elif [[ "$(header access-control-allow-headers | tr '[:upper:]' '[:lower:]')" != *content-type* ]]; then fail "${name}" "Access-Control-Allow-Headers is '$(header access-control-allow-headers)'"
  else pass "${name} (204, Allow-Origin *, Allow-Methods ${methods}, Allow-Headers content-type)"; fi
fi

# 8. POST /v1/generate providers:["aws"] — 0.2.0 에서 연 AWS 는 200 · data 에 aws 만
name='POST /v1/generate aws'
code="$(fetch POST /v1/generate -H 'content-type: application/json' \
  --data '{"providers":["aws"],"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"ap-northeast-2"}}')"
if expect_status "${name}" "${code}" 200; then
  keys="$(jq -c '.data | keys' "${body}" 2>/dev/null)"
  s3="$(jq -r '.data.aws.s3_bucket.name' "${body}" 2>/dev/null)"
  if [ "${keys}" != '["aws"]' ]; then fail "${name}" "data keys ${keys:-<none>}"
  elif [ "${s3}" != 'platform-payments-batch-prod-s3' ]; then fail "${name}" "s3_bucket ${s3:-<none>}"
  else pass "${name} (200, data [\"aws\"], s3_bucket ${s3})"; fi
fi

# 8b. POST /v1/generate providers:["azure"] — 아직 열지 않은 provider 는 400 · supported 는 켜진 둘
name='POST /v1/generate azure'
code="$(fetch POST /v1/generate -H 'content-type: application/json' \
  --data '{"providers":["azure"],"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"koreacentral"}}')"
if expect_status "${name}" "${code}" 400; then
  ecode="$(jq -r '.errors[0].code' "${body}" 2>/dev/null)"
  supported="$(jq -c '.supported' "${body}" 2>/dev/null)"
  if [ "${ecode}" != "request.provider_not_enabled" ]; then fail "${name}" "error code ${ecode:-<none>}"
  elif [ "${supported}" != '["aws","gcp"]' ]; then fail "${name}" "supported ${supported:-<none>}"
  else pass "${name} (400 request.provider_not_enabled, supported [\"aws\",\"gcp\"])"; fi
fi

# 9. POST /v1/events — Fetch Metadata 헤더가 없으면 403
name='POST /v1/events without Sec-Fetch-Site'
code="$(fetch POST /v1/events -H 'content-type: application/json' --data '{"event":"ui_copy","target":"name"}')"
if expect_status "${name}" "${code}" 403; then
  ecode="$(jq -r '.errors[0].code' "${body}" 2>/dev/null)"
  if [ "${ecode}" != "request.same_origin_only" ]; then fail "${name}" "error code ${ecode:-<none>}"
  else pass "${name} (403 request.same_origin_only)"; fi
fi

# 10. 요청 제한 — 마지막에 · 같은 공인 IP · 같은 연결에서 POST /v1/validate 90건 → 429 가 한 번이라도 · 70초 뒤 200
name='rate limit'
if [ "${skip_ratelimit}" = "1" ]; then
  echo "SKIP  ${name} — --skip-ratelimit (not counted as PASS)"
elif [ "${failed}" != "0" ]; then
  echo "SKIP  ${name} — earlier checks failed"
else
  # 한도는 Cloudflare 위치(colo)마다 따로 센다. 요청마다 curl 을 새로 띄우면 연결이 여러 colo 로 흩어져
  # 어느 colo 도 60 을 넘지 못한다(2026-10-13 실측: 48 · 29 · 13). 90건을 curl 하나 · 연결 하나(--next)로 보낸다
  n200=0; n429=0; nother=0
  rl_args=()
  for _ in $(seq 1 90); do
    # curl 은 --next 마다 헤더를 비운다 — 점검 헤더를 묶음 하나하나에 단다
    rl_args+=(-X POST -H 'content-type: application/json' ${skip_args[@]+"${skip_args[@]}"} --data "${VALIDATE_REQUEST}" -o /dev/null -w '%{http_code}\n' "${base}/v1/validate" --next)
  done
  rl_args+=(${skip_args[@]+"${skip_args[@]}"} -o /dev/null "${base}/v1/health")
  rl_codes="$(curl -sS --max-time 120 "${rl_args[@]}" 2>/dev/null || true)"
  for code in ${rl_codes}; do
    case "${code}" in 200) n200=$((n200 + 1)) ;; 429) n429=$((n429 + 1)) ;; *) nother=$((nother + 1)) ;; esac
  done
  info "${name}: 90 × POST /v1/validate on one connection → 200: ${n200}, 429: ${n429}, other: ${nother}"
  if [ "${n429}" = "0" ]; then
    fail "${name}" "no 429 in 90 requests — the limiter did not trigger"
  else
    pass "${name} triggered (${n429} × 429; count is not asserted)"
    info "${name}: waiting 70 s for the window to pass"
    sleep 70
    code="$(fetch POST /v1/validate -H 'content-type: application/json' --data "${VALIDATE_REQUEST}")"
    if expect_status "${name} recovery" "${code}" 200; then pass "${name} recovered (200 after 70 s)"; fi
  fi
fi

echo "release-check: ${passed} passed, ${failed} failed$([ "${skip_ratelimit}" = "1" ] && echo ', rate limit SKIPPED')"
[ "${failed}" = "0" ]
