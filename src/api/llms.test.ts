import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLlmsText, formulaOf, kindLines } from './llms';
import { RULES } from '../core/constraints';
import { app } from './index';
import { req, fakeKv } from './test-support';
import { VERSION } from '../version';
import { en } from '../messages/en';
import { SCOPES } from '../core/scopes';
import { SCOPE_MEANING, UNIQUENESS_MEANING } from './llms';
import { inputKind } from '../core/tree';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';
import { REGIONS } from '../core/regions-data';
import { regionTokenOfRule } from '../core/compose';
import { rulesFor } from '../core/constraints';
import { AZURE_INTAKE_ROWS } from '../core/rules/azure-intake';
import { GCP_INTAKE_ROWS } from '../core/rules/gcp-intake';
import { AWS_INTAKE_ROWS } from '../core/rules/aws-intake';
import { GCP_MANUAL_RULES } from '../core/rules/gcp-manual';
import { AWS_MANUAL_RULES } from '../core/rules/aws-manual';
import { GCP_CATALOG, GCP_KIND_CHECKED } from '../core/rules/gcp-catalog';
import { AZURE_MANUAL_ROWS } from '../core/rules/azure-manual';

const rules = Object.values(RULES);
// 공개 본문 — 켜진 CSP 만 (D45)
const text = buildLlmsText(rules, VERSION);
const lines = text.split('\n');
const enabledRules = rules.filter((r) => ENABLED_PROVIDERS.includes(r.provider));
// 형식 시험용 — 세 CSP 를 모두 펼친 본문. 꺼진 CSP 의 규칙 줄 꼴(플래그 · 금지형 · note)이 켜질 때 그대로 나오는지 본다
const allText = buildLlmsText(rules, VERSION, en, PROVIDERS);
const allLines = allText.split('\n');

describe('buildLlmsText — RULES 에서 만든다 (D9)', () => {
  it('첫 줄은 # Cloudonym', () => expect(lines[0]).toBe('# Cloudonym'));
  it('켜진 CSP 만 — GCP 절만 있고 공식 줄 수는 GCP 규칙 수 · AWS · Azure 는 「planned」 한 줄 (D45)', () => {
    expect(lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l))).toHaveLength(enabledRules.length);
    expect(enabledRules).toHaveLength(rulesFor('gcp').length);
    expect(rulesFor('gcp')).toHaveLength(121);
    expect(lines.filter((l) => l.startsWith('### ')).every((l) => l === '### GCP' || l === '### env' || l === '### region')).toBe(true);
    expect(lines.filter((l) => l === '### GCP')).toHaveLength(5); // 공식 · 지역 · 종류 · 제약 · 트리
    expect(text).not.toMatch(/`(aws|azure)\.[a-z0-9_]+`/);
    expect(lines.filter((l) => l.includes('planned'))).toEqual(['> AWS and Azure: planned — not enabled yet. The API answers 400 `request.provider_not_enabled` for them.']);
    expect(text).toContain('"providers"?: ["gcp"]');
  });
  it('공식 줄이 규칙 수(손 35 + 들인 행)만큼 있고 template 을 그대로 펼친다 (세 CSP 를 펼친 본문)', () => {
    expect(allLines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l))).toHaveLength(rules.length);
    expect(rules).toHaveLength(35 + AZURE_INTAKE_ROWS.length + GCP_INTAKE_ROWS.length + AWS_INTAKE_ROWS.length + Object.keys(GCP_MANUAL_RULES).length + Object.keys(AWS_MANUAL_RULES).length + AZURE_MANUAL_ROWS.length);
    expect(formulaOf(RULES['gcp.service_account']!)).toBe('<owner>-<system>-<purpose>-<env>-<region>-sa-<role>');
    expect(formulaOf(RULES['azure.storage_account']!)).toBe('st<system><purpose><env>');
    expect(text).toContain('- `gcp.service_account`: `<owner>-<system>-<purpose>-<env>-<region>-sa-<role>` · optional: region, owner');
  });
  it('제약 줄이 규칙 수만큼 있고 docUrl 이 전부 들어 있다', () => {
    expect(lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+` \(/.test(l))).toHaveLength(enabledRules.length);
    for (const r of enabledRules) expect(text, r.id).toContain(`docs: ${r.docUrl}`);
    expect(allLines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+` \(/.test(l))).toHaveLength(rules.length);
    for (const r of rules) expect(allText, r.id).toContain(`docs: ${r.docUrl}`);
    expect(allText).toContain('- `aws.s3_bucket` (S3 Bucket): 3-63 chars');
    expect(allText).toContain('forbidden: prefixes xn-- sthree- amzn-s3-demo-');
    const st = allLines.find((l) => l.startsWith('- `azure.storage_account` ('))!;
    expect(st).toMatch(/forbidden: prefixes login; contains microsoft windows; words access [^;]* azure /);
    expect(st).toContain('case-insensitive');
  });
  it('허용값 절은 ENV_ALIASES 의 표준값과 별칭 · region 은 「## Regions」 절을 가리키고 global 을 적는다', () => {
    expect(text).toContain('- `prod` — aliases: prd, production, real, live');
    const region = lines.slice(lines.indexOf('### region') + 1, lines.indexOf('## Regions')).filter((l) => l.startsWith('- '));
    expect(region).toEqual(['- a region or a zone of the provider, by name or by code — see `## Regions`', '- `global`']);
    expect(text).not.toContain('- `kr`');
  });
  it('「## Regions」 절 — 코드 규칙 · 켜진 CSP 마다 리전 한 줄(이름 · 코드 · 위치 · 존) · 존 규칙 문장 (D49 · D50)', () => {
    const start = lines.indexOf('## Regions');
    expect(start).toBeGreaterThan(lines.indexOf('## Canonical Allowed Values'));
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    const section = lines.slice(start, end);
    const rows = section.filter((l) => /^- `[a-z0-9-]+` · `[a-z0-9]+` — /.test(l));
    expect(REGIONS.gcp).toHaveLength(43);
    expect(rows).toHaveLength(REGIONS.gcp.length);
    expect(rows).toContain('- `asia-northeast3` · `ane3` — Seoul, South Korea, APAC · zones: `asia-northeast3-a` `ane3a`, `asia-northeast3-b` `ane3b`, `asia-northeast3-c` `ane3c`');
    for (const r of REGIONS.gcp) expect(rows.some((l) => l.startsWith(`- \`${r.region}\` · \`${r.code}\` — ${r.label}`)), r.region).toBe(true);
    const body = section.join('\n');
    // 코드 규칙 · 받는 꼴 · 거부하는 옛 값 · global
    expect(body).toContain('zone code is the region code followed by the zone letter');
    expect(body).toContain('`kr`, `us`, `jp` and `eu` are rejected');
    expect(body).toContain('`global` puts no region token');
    // 존 규칙 문장 — 규칙 표에서 존 토큰 규칙을 세어 적는다
    const zonal = enabledRules.filter((r) => regionTokenOfRule(r) === 'zone').map((r) => `\`${r.id}\``);
    expect(zonal).toHaveLength(14);
    const sentence = section.find((l) => l.startsWith('Zonal resources'))!;
    expect(sentence).toContain('`name.zone_required`');
    expect(sentence).toContain(zonal.join(', '));
  });
  it('「## Kind tokens」 절 — 종류 표가 있는 19행 · 행마다 값 → 토큰 · 규칙(범위)마다 기본값과 허용 값 · 기본값 근거 · 확인일 (D52)', () => {
    const start = lines.indexOf('## Kind tokens');
    expect(start).toBeGreaterThan(lines.indexOf('## Regions'));
    const end = lines.indexOf('## Provider Constraints');
    expect(end).toBeGreaterThan(start);
    const section = lines.slice(start, end);
    const kindRows = GCP_CATALOG.filter((r) => r.kind !== null);
    expect(kindRows).toHaveLength(19);
    const rowLines = section.filter((l) => l.startsWith('- `gcp.'));
    expect(rowLines).toHaveLength(19);
    for (const row of kindRows) {
      const at = section.findIndex((l) => l.startsWith(`- \`${row.key}\``));
      expect(at, row.key).toBeGreaterThan(-1);
      const head = section[at]!;
      for (const [v, t] of Object.entries(row.kind!.tokens)) expect(head, `${row.key} ${v}`).toContain(t === null ? `\`${v}\` (no token)` : `\`${v}\` → \`${t}\``);
      expect(head).toContain(`basis: ${row.kind!.defaultBasis}`);
      expect(head).toContain(`checked ${GCP_KIND_CHECKED[row.key]}`);
      // 규칙(범위)마다 들여쓴 한 줄 — 기본값과 허용 값
      for (const [id, spec] of Object.entries(row.rules)) {
        const sub = section.find((l) => l.startsWith(`  - \`${id}\``));
        expect(sub, id).toBeDefined();
        expect(sub, id).toContain(spec.kinds!.default === null ? 'no default' : `default \`${spec.kinds!.default}\``);
        expect(sub, id).toContain(`accepts ${spec.kinds!.allowed.map((v) => `\`${v}\``).join(', ')}`);
      }
    }
    expect(section.join('\n')).toContain('`gcp.resource_policy`');
    expect(section.join('\n')).toMatch(/needs a kind/);
  });
  it('「## Kind tokens」 — 종류 표가 있는 행인데 규칙 하나에 kinds 가 없으면 그 규칙 줄만 빼고 던지지 않는다', () => {
    const row = GCP_CATALOG.find((r) => r.key === 'gcp.cloud_sql_instance')!;
    const [id, spec] = Object.entries(row.rules)[0]!;
    const broken = { ...row, rules: { [id]: { scope: spec.scope, regionToken: spec.regionToken } } };
    const out = kindLines(['gcp'], () => [broken]);
    expect(out.some((l) => l.startsWith(`- \`${row.key}\``))).toBe(true);
    expect(out.some((l) => l.startsWith(`  - \`${id}\``))).toBe(false);
  });
  it('/v1/names 줄에 kind · /v1/generate 는 종류 · 존이 필요한 규칙을 valid:false 로 돌려준다는 한 줄 (D52)', () => {
    expect(text).toContain('"kind"?: string');
    expect(text).toContain('`name.kind_required`');
    expect(text).toMatch(/come back `valid: false` there .*use `\/v1\/names`/);
  });
  it('공식에 종류 자리가 있다 — 종류 표가 있는 규칙만 <kind> 가 약어 바로 뒤', () => {
    expect(lines.some((l) => l.startsWith(`- \`gcp.cloud_sql_instance\`: \`${formulaOf(RULES['gcp.cloud_sql_instance']!)}\``))).toBe(true);
    expect(formulaOf(RULES['gcp.cloud_sql_instance']!)).toBe('<system>-<purpose>-<env>-<region>-sql-<kind>-<seq>');
    expect(formulaOf(RULES['gcp.vpc_network']!)).not.toContain('<kind>');
  });
  it('플래그가 있는 pattern 은 플래그를 같이 적는다 — azure.resource_group 은 u', () => {
    const rg = allLines.find((l) => l.startsWith('- `azure.resource_group` ('))!;
    expect(rg).toContain('(flags: u)');
    const flagged = rules.filter((r) => r.pattern.flags !== '');
    // 들인 Azure 행의 금지형 · 들인 AWS 행 중 EC2 밖 Name 태그와 「[^…]」 꼴 — 보이지 않는 글자 정의(invisible.mjs 의 \p{…})를 쓰는 u.
    // 손으로 쓴 규칙은 resource_group(\p{L}) 과 같은 정의를 쓰는 금지형 손 규칙(Logs 둘 · Azure policy 넷 · tagNames · Synapse SQL pool)
    const intake = new Set([...AZURE_INTAKE_ROWS.map((r) => r.id), ...AWS_INTAKE_ROWS.map((r) => r.id)]);
    expect(flagged.filter((r) => !intake.has(r.id)).map((r) => r.id).sort()).toEqual([
      'aws.logs_log_stream', 'aws.logs_subscription_filter',
      'azure.authorization_policy_assignments', 'azure.authorization_policy_definitions', 'azure.authorization_policy_exemptions', 'azure.authorization_policy_set_definitions',
      'azure.resource_group', 'azure.resources_tag_names', 'azure.synapse_workspaces_sql_pools',
    ]);
    const s3 = allLines.find((l) => l.startsWith('- `aws.s3_bucket` ('))!;
    expect(s3).not.toContain('(flags:');
  });
  it('제목 아래 엔진 · 규칙 버전 한 줄 (D26)', () => {
    expect(lines[2]).toBe(`> Engine ${VERSION.engine} · rules revision ${VERSION.rules}`);
  });
  it('What PASS means 절 — 문장은 사전의 ui.pass_meaning 그대로 (D28)', () => {
    const at = lines.indexOf('## What PASS means');
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 2]).toBe(en.ui.pass_meaning);
  });
  it('규칙 설명(note)은 사전이 만든 영어 · 여러 개면 「; 」로 잇는다 · 한글 0', () => {
    const win = allLines.find((l) => l.startsWith('- `azure.virtual_machine_windows` ('))!;
    expect(win).toContain('note: Follows the host-name rule');
    expect(win).toContain('; A name made only of digits is not allowed (https://learn.microsoft.com/');
    const vpc = allLines.find((l) => l.startsWith('- `aws.vpc` ('))!;
    expect(vpc).toContain('(VPC (Name tag))');
    expect(/\p{Script=Hangul}/u.test(text)).toBe(false);
    expect(/\p{Script=Hangul}/u.test(allText)).toBe(false);
  });
  it('「## Resource tree」 절 — provider 마다 범위 노드(id · docUrl) 아래 규칙마다 들여쓴 한 줄(id · input) · scope/uniqueness 문장은 openapi 와 같다', () => {
    // 공개 본문은 켜진 CSP 의 범위 · 규칙만
    const pubAt = lines.indexOf('## Resource tree');
    const pub = lines.slice(pubAt, lines.findIndex((l, i) => i > pubAt && l.startsWith('## ')));
    expect(pub.filter((l) => /^ +- `[a-z]+\.[a-z0-9_]+` · input: /.test(l))).toHaveLength(enabledRules.length);
    expect(pub.some((l) => /\(`(aws|azure):/.test(l))).toBe(false);
    const at = allLines.indexOf('## Resource tree');
    const end = allLines.findIndex((l, i) => i > at && l.startsWith('## '));
    expect(at).toBeGreaterThan(0);
    const section = allLines.slice(at, end);
    expect(section).toContain(SCOPE_MEANING);
    expect(section).toContain(UNIQUENESS_MEANING);
    for (const s of Object.values(SCOPES)) expect(section.some((l) => l.includes(`(\`${s.id}\`)`) && l.includes(s.docUrl)), s.id).toBe(true);
    const ruleLines = section.filter((l) => /^ +- `[a-z]+\.[a-z0-9_]+` · input: /.test(l));
    expect(ruleLines).toHaveLength(rules.length);
    for (const r of rules) expect(ruleLines.some((l) => l.includes(`\`${r.id}\` · input: ${inputKind(r)}`)), r.id).toBe(true);
    // Azure subnet 은 global › subscription › resource_group › virtual_network 아래 — 들여쓰기 깊이 4 단계(8칸)
    expect(section).toContain('        - `azure.subnet` · input: count');
    expect(section).toContain('        - `aws.ec2_instance` · input: count · uniqueness: none');
  });
  it('seq · role 설명과 /v1/names 줄 · 한 요청 = 한 부모 범위 · 충돌의 뜻', () => {
    expect(text).toContain('`<seq>` defaults to `01` (`count` on `/v1/names` gives `01`…`99`), `<role>` defaults to `sync` (`role` on `/v1/names`), `<kind>` is empty unless `kind` on `/v1/names` picks a value with a token (see `## Kind tokens`).');
    expect(text).toContain('- `POST /v1/names` — body');
    expect(text).toContain('One `/v1/names` request stands for one instance of each parent scope');
    expect(text).toContain('`name.conflict`');
  });
  it('API 절에 rules_version · version · 실패 꼴 · health', () => {
    expect(text).toContain('"rules_version"?: string');
    expect(text).toContain('`version: { engine, rules }`');
    expect(text).toContain('409 `request.rules_version_mismatch`');
    expect(text).toContain('`GET /v1/health`');
  });
  it('API 절에 GET /catalog.json 한 줄 — 켜진 CSP 의 행과 리전 · version (D46)', () => {
    const api = text.slice(text.indexOf('## API'));
    const line = api.split('\n').find((l) => l.startsWith('- `GET /catalog.json`'));
    expect(line).toBeDefined();
    expect(line).toMatch(/enabled providers/);
    expect(line).toMatch(/region/);
    expect(line).toContain('`version: { engine, rules }`');
  });
  it('D19 문장이 있고 우리 도메인을 박지 않는다', () => {
    expect(text).toContain("does not replace the provider's final verdict");
    expect(text).not.toMatch(/cloudnaming|cloudonym\.(dev|io|ai|com)/);
    expect(text).toContain('`POST /v1/generate`');
  });
});

describe('GET /llms.txt — Worker 라우트 (D17)', () => {
  it('200 · text/plain; charset=utf-8 · Cache-Control · 첫 줄 · 카운터 llms_txt_accessed', async () => {
    const { kv, store } = fakeKv();
    const { res, promises } = await req(app, '/llms.txt', undefined, { CLOUDONYM_KV: kv });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain;\s*charset=utf-8$/i);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');   // 다른 origin 의 에이전트 도구가 읽는다
    expect((await res.text()).split('\n')[0]).toBe('# Cloudonym');
    expect(promises).toHaveLength(1);
    await promises[0];
    expect([...store.keys()][0]).toMatch(/^stats:llms_txt_accessed:/);
  });
  it('HEAD /llms.txt 도 같은 헤더 둘 (curl -I)', async () => {
    const { res } = await req(app, '/llms.txt', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/i);
  });
  it('HEAD /llms.txt 는 llms_txt_accessed 를 세지 않는다 — 헤더는 GET 과 같다', async () => {
    const { kv, store } = fakeKv();
    const { res, promises } = await req(app, '/llms.txt', { method: 'HEAD' }, { CLOUDONYM_KV: kv });
    const { res: getRes } = await req(app, '/llms.txt');
    expect(promises).toHaveLength(0);
    expect(store.size).toBe(0);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(getRes.headers.get('content-type'));
    expect(res.headers.get('cache-control')).toBe(getRes.headers.get('cache-control'));
  });
  it('wrangler.jsonc run_worker_first 에 /llms.txt 가 있다', () => {
    const cfg = readFileSync(join(import.meta.dirname, '../../wrangler.jsonc'), 'utf-8');
    expect(cfg).toMatch(/"run_worker_first"\s*:\s*\[[^\]]*"\/llms\.txt"/);
  });
  it('app.routes 는 정확히 일곱 경로 + secureHeaders 의 ALL /* · cors 의 ALL /v1/* 하나씩 · /v1/v1 없음', () => {
    const routes = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes.filter((r) => !r.startsWith('ALL ')).sort()).toEqual(['GET /catalog.json', 'GET /llms.txt', 'GET /v1/health', 'POST /v1/events', 'POST /v1/generate', 'POST /v1/names', 'POST /v1/validate']);
    expect(routes.filter((r) => r.startsWith('ALL ')).sort()).toEqual(['ALL /*', 'ALL /v1/*']);
    expect(routes.some((r) => r.includes('/v1/v1'))).toBe(false);
  });
});
