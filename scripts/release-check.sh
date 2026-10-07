#!/usr/bin/env bash
# 배포 전 확인 — 배포 URL 하나를 받아 공개 표면을 실측하고, 하나라도 틀리면 non-zero 로 끝난다.
#   scripts/release-check.sh [--skip-ratelimit] https://<worker-url>
# 빠른 검사를 전부 돌린 뒤, 모두 통과했을 때만 마지막에 요청 제한 단계(약 80초)를 돈다.
# 요청 제한은 「제한 발생과 회복」만 본다 — 바인딩은 최종 일관성이라 정확한 60/61 경계는 security.test.ts 의 fake limiter 가 고정한다.
# https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy
# --skip-ratelimit 은 로컬용이다. 건너뛴 단계는 SKIPPED 로 적고 통과로 세지 않는다.
# 필요한 것: curl · jq · perl
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

# /v1/names 의 기대 이름 — 규칙 버전 2026-10-07.11 의 엔진 출력이다. 규칙이 바뀌면 이 검사가 실패하고, 그때 아래 요청을
# 새 빌드에 보내 값을 다시 적는다(조용히 통과하지 않는다)
NAMES_REQUEST='{"provider":"gcp","context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3"},"resources":[{"type":"vpc_network"},{"type":"storage_bucket"},{"type":"service_account","role":"db"}]}'
NAMES_EXPECTED='{"service_account_db":"payments-batch-prod-sa-db","storage_bucket":"platform-payments-batch-prod-gcs","vpc_network_01":"payments-batch-prod-vpc-01"}'
VALIDATE_REQUEST='{"provider":"gcp","resource_type":"storage_bucket","name":"payments-prod-bucket"}'
# public/_headers 의 CSP 와 같은 글자다
CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

work="$(mktemp -d)"
trap 'rm -f "${work}"/*; rmdir "${work}"' EXIT
hdr="${work}/headers"
body="${work}/body"

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
  curl -sS --max-time 20 -X "${method}" -D "${hdr}" -o "${body}" -w '%{http_code}' "$@" "${base}${route}" 2>/dev/null || true
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
code="$(fetch GET /v1/health)"
if [ "${code}" = "200" ]; then
  info "version $(jq -c '.version' "${body}" 2>/dev/null)"
else
  info "/v1/health returned ${code}"
fi

# 1. 화면 — 200 · text/html · 한글 0 · 보안 헤더(_headers 는 정적 자산에만 붙는다)
name='GET /'
code="$(fetch GET /)"
if expect_status "${name}" "${code}" 200; then
  ctype="$(header content-type)"
  if [[ "${ctype}" != text/html* ]]; then fail "${name}" "content-type '${ctype}'"
  elif ! perl -CSD -ne '$h = 1 if /\p{Script=Hangul}/; END { exit($h ? 1 : 0) }' "${body}"; then fail "${name}" "Hangul in body"
  else pass "${name} (200, ${ctype}, no Hangul)"; fi
  name='_headers on /'
  if [ "$(header content-security-policy)" != "${CSP}" ]; then fail "${name}" "Content-Security-Policy is '$(header content-security-policy)'"
  elif [ "$(header x-content-type-options)" != "nosniff" ]; then fail "${name}" "X-Content-Type-Options is '$(header x-content-type-options)'"
  elif [ "$(header x-frame-options)" != "DENY" ]; then fail "${name}" "X-Frame-Options is '$(header x-frame-options)'"
  else pass "${name} (CSP, nosniff, X-Frame-Options: DENY)"; fi
fi

# 2. /llms.txt — 200 · text/plain · 하루 캐시 · CORS * · 첫 줄 · 소절은 GCP 만
name='GET /llms.txt'
code="$(fetch GET /llms.txt)"
if expect_status "${name}" "${code}" 200; then
  ctype="$(header content-type)"
  first="$(head -1 "${body}" | tr -d '\r')"
  sub_gcp="$(grep -c '^### GCP$' "${body}")"
  sub_other="$(grep -ciE '^### (AWS|Azure)' "${body}")"
  if [[ "${ctype}" != text/plain* ]]; then fail "${name}" "content-type '${ctype}'"
  elif [[ "$(header cache-control)" != *max-age=86400* ]]; then fail "${name}" "Cache-Control is '$(header cache-control)'"
  elif [ "$(header access-control-allow-origin)" != "*" ]; then fail "${name}" "Access-Control-Allow-Origin is '$(header access-control-allow-origin)'"
  elif [ "${first}" != "# Cloudonym" ]; then fail "${name}" "first line is '${first}'"
  elif [ "${sub_other}" != "0" ]; then fail "${name}" "${sub_other} AWS/Azure section(s)"
  elif [ "${sub_gcp}" = "0" ]; then fail "${name}" "no '### GCP' section"
  else pass "${name} (text/plain, max-age=86400, CORS *, '# Cloudonym', ${sub_gcp} '### GCP' sections, no AWS or Azure)"; fi
fi

# 3. /catalog.json — 200 · provider 는 gcp 하나 · 100행
name='GET /catalog.json'
code="$(fetch GET /catalog.json)"
if expect_status "${name}" "${code}" 200; then
  providers="$(jq -c '.providers | keys' "${body}" 2>/dev/null)"
  rows="$(jq '.providers.gcp.rows | length' "${body}" 2>/dev/null)"
  if [ "${providers}" != '["gcp"]' ]; then fail "${name}" "providers ${providers:-<not JSON>}"
  elif [ "${rows}" != "100" ]; then fail "${name}" "gcp rows ${rows:-<none>}, expected 100"
  else pass "${name} (providers [\"gcp\"], 100 rows)"; fi
fi

# 4. /openapi.json — provider enum 셋이 모두 ["gcp"]
name='GET /openapi.json'
code="$(fetch GET /openapi.json)"
if expect_status "${name}" "${code}" 200; then
  enums="$(jq -c '[.components.schemas.GenerateRequest.properties.providers.items.enum,
                   .components.schemas.NamesRequest.properties.provider.enum,
                   .components.schemas.ValidateRequest.properties.provider.enum]' "${body}" 2>/dev/null)"
  if [ "${enums}" != '[["gcp"],["gcp"],["gcp"]]' ]; then fail "${name}" "provider enums (generate, names, validate) are ${enums:-<not JSON>}"
  else pass "${name} (provider enums [\"gcp\"] in generate, names, validate)"; fi
fi

# 5. 화면 라우트
for route in /docs/naming /privacy; do
  code="$(fetch GET "${route}")"
  if expect_status "GET ${route}" "${code}" 200; then pass "GET ${route} (200)"; fi
done

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

# 8. POST /v1/generate providers:["aws"] — 아직 열지 않은 provider 는 400
name='POST /v1/generate aws'
code="$(fetch POST /v1/generate -H 'content-type: application/json' \
  --data '{"providers":["aws"],"context":{"owner":"platform","system":"payments","purpose":"batch","env":"prod","region":"asia-northeast3"}}')"
if expect_status "${name}" "${code}" 400; then
  ecode="$(jq -r '.errors[0].code' "${body}" 2>/dev/null)"
  supported="$(jq -c '.supported' "${body}" 2>/dev/null)"
  if [ "${ecode}" != "request.provider_not_enabled" ]; then fail "${name}" "error code ${ecode:-<none>}"
  elif [ "${supported}" != '["gcp"]' ]; then fail "${name}" "supported ${supported:-<none>}"
  else pass "${name} (400 request.provider_not_enabled, supported [\"gcp\"])"; fi
fi

# 9. POST /v1/events — Fetch Metadata 헤더가 없으면 403
name='POST /v1/events without Sec-Fetch-Site'
code="$(fetch POST /v1/events -H 'content-type: application/json' --data '{"event":"ui_copy","target":"name"}')"
if expect_status "${name}" "${code}" 403; then
  ecode="$(jq -r '.errors[0].code' "${body}" 2>/dev/null)"
  if [ "${ecode}" != "request.same_origin_only" ]; then fail "${name}" "error code ${ecode:-<none>}"
  else pass "${name} (403 request.same_origin_only)"; fi
fi

# 10. 요청 제한 — 마지막에 · 같은 공인 IP 에서 POST /v1/validate 90건 → 429 가 한 번이라도 · 70초 뒤 200
name='rate limit'
if [ "${skip_ratelimit}" = "1" ]; then
  echo "SKIP  ${name} — --skip-ratelimit (not counted as PASS)"
elif [ "${failed}" != "0" ]; then
  echo "SKIP  ${name} — earlier checks failed"
else
  n200=0; n429=0; nother=0
  for _ in $(seq 1 90); do
    code="$(fetch POST /v1/validate -H 'content-type: application/json' --data "${VALIDATE_REQUEST}")"
    case "${code}" in 200) n200=$((n200 + 1)) ;; 429) n429=$((n429 + 1)) ;; *) nother=$((nother + 1)) ;; esac
  done
  info "${name}: 90 × POST /v1/validate → 200: ${n200}, 429: ${n429}, other: ${nother}"
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
