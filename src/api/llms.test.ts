import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLlmsText, formulaOf, kindLines, PROBES, SHORT_NAME_LIMIT } from './llms';
import { SHORT_WORDS } from '../core/shorten';
import { MIN_TOKEN, PROTECTED } from '../core/types';
import { RULES } from '../core/constraints';
import { app } from './index';
import { req, fakeKv } from './test-support';
import { VERSION } from '../version';
import { en } from '../messages/en';
import { SCOPES } from '../core/scopes';
import { ENV_VALUES } from '../core/normalize';
import { SCOPE_MEANING, UNIQUENESS_MEANING } from './llms';
import { inputKind } from '../core/tree';
import { ENABLED_PROVIDERS, PROVIDERS } from '../core/types';
import { REGIONS } from '../core/regions-data';
import { rulesFor } from '../core/constraints';
import { AZURE_INTAKE_ROWS } from '../core/rules/azure-intake';
import { GCP_INTAKE_ROWS } from '../core/rules/gcp-intake';
import { AWS_INTAKE_ROWS } from '../core/rules/aws-intake';
import { GCP_MANUAL_RULES } from '../core/rules/gcp-manual';
import { AWS_MANUAL_RULES } from '../core/rules/aws-manual';
import { GCP_CATALOG, GCP_KIND_CHECKED } from '../core/rules/gcp-catalog';
import { AZURE_MANUAL_ROWS } from '../core/rules/azure-manual';
import { TIER_PATTERN } from '../core/types';
import { RESERVED_TIERS } from '../core/tier';
import { PRESETS, PRESET_TIERS, presetsFor } from '../core/wizard/presets';
import { ATTACHMENTS } from '../core/wizard/attachments';
import { MAX_BODY_BYTES } from './v1';
import { resourceCount } from '../components/resourceCount';
import { RATE_LIMIT } from './ratelimit';
import { MAX_ECHO_CHARS, MAX_GENERATE_ERRORS, MAX_WIZARD_ERRORS } from './errors';
import { MAX_FIELD_CHARS } from './schemas';
import { MAX_CONTEXT_CHARS } from '../core/engine';
import { MAX_ITEMS, MAX_NAMES } from '../core/selection';
import { CATALOG_LIMITS, catalogAttachments, catalogPresets } from './catalog';
import { PLAN_FILE_MAX_BYTES } from '../components/planFile';
import { API_DOC_LIMITED_ROOT, API_DOC_UNLIMITED } from '../components/apiDocModel';
import { main as cliMain, EXIT } from '../../cli/lib/main.mjs';

const rules = Object.values(RULES);
// 공개 본문 — 켜진 CSP 만 (D45)
const text = buildLlmsText(rules, VERSION);
const lines = text.split('\n');
/** 절 하나 — 제목 줄부터 다음 「## 」 앞까지 */
const section = (title: string): string[] => {
  const at = lines.indexOf(title);
  expect(at, title).toBeGreaterThan(0);
  const end = lines.findIndex((l, i) => i > at && l.startsWith('## '));
  return lines.slice(at, end < 0 ? undefined : end);
};
const enabledRules = rules.filter((r) => ENABLED_PROVIDERS.includes(r.provider));
// 형식 시험용 — 세 CSP 를 모두 펼친 본문. 꺼진 CSP 의 규칙 줄 꼴(플래그 · 금지형 · note)이 켜질 때 그대로 나오는지 본다
const allText = buildLlmsText(rules, VERSION, en, PROVIDERS);
const allLines = allText.split('\n');

describe('「## For AI coding agents」 — 직접 짓지 말고 API 를 부른다 · 축소 순서 · 약어 · 규약을 그대로 쓰면 깨지는 규칙', () => {
  // 수집 단계라 section() 의 expect 를 쓰지 않는다 — 절이 없으면 아래 「머리말 바로 뒤」 시험이 실패한다
  const at = lines.indexOf('## For AI coding agents');
  const sec = at < 0 ? [] : lines.slice(at, lines.findIndex((l, i) => i > at && l.startsWith('## ')));
  const body = sec.join('\n');
  it('머리말 바로 뒤 · 공식 절 앞에 있다', () => {
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(lines.indexOf('## Naming Formulas'));
    expect(lines.slice(0, lines.indexOf('## For AI coding agents')).filter((l) => l.startsWith('## '))).toEqual([]);
  });
  it('이름을 직접 짓지 말고 /v1/generate · /v1/names 를 부르고 · 이미 있는 이름은 /v1/validate → suggested_name', () => {
    expect(body).toContain('Do not compose resource names yourself');
    expect(body).toContain('`POST /v1/generate`');
    expect(body).toContain('`POST /v1/names`');
    expect(body).toContain('`POST /v1/validate`');
    expect(body).toContain('use `suggested_name` if there is one');
    expect(body).toContain('`warnings` never makes a name invalid');
  });
  it('축소 순서 넷 — 보호 토큰 · 최소 길이는 엔진 상수 그대로', () => {
    const steps = sec.filter((l) => /^\d\. /.test(l));
    expect(steps).toHaveLength(4);
    for (const t of PROTECTED) expect(steps[1]).toContain(`\`${t}\``);
    expect(steps[2]).toContain(`never below ${MIN_TOKEN} characters`);
    expect(steps[3]).toContain('`name.cannot_fit`');
  });
  it('약어 줄은 SHORT_WORDS 그대로 — 손으로 쓴 약어가 없다', () => {
    const abbr = sec.filter((l) => /^- `[a-z]+` → `[a-z]+`$/.test(l));
    expect(abbr).toEqual(Object.entries(SHORT_WORDS).map(([w, a]) => `- \`${w}\` → \`${a}\``));
  });
  it('지역은 코드로 — 켜진 CSP 마다 지역 표의 첫 행을 예로 든다', () => {
    const r = REGIONS.gcp[0]!;
    expect(body).toContain(`\`${r.region}\` → \`${r.code}\``);
    expect(body).toContain('never the region name');
  });
  it('깨지는 규칙 목록은 규칙 표에서 — 구분자 · 짧은 최대 길이 · 전역 고유', () => {
    const gcp = rulesFor('gcp');
    const noHyphen = sec.find((l) => l.startsWith('- GCP, no hyphen between tokens: '))!;
    for (const r of gcp) expect(noHyphen.includes(`\`${r.id}\` (`), r.id).toBe(r.separator !== '-');
    const short = sec.find((l) => l.startsWith(`- GCP, at most ${SHORT_NAME_LIMIT} characters`))!;
    for (const r of gcp) expect(short.includes(`\`${r.id}\` ${r.maxLength}`), r.id).toBe(r.maxLength <= SHORT_NAME_LIMIT);
    expect(short).toContain('`gcp.project_id` 30');
    const global = sec.find((l) => l.startsWith('- GCP, unique across every customer'))!;
    expect(global).toContain('`gcp.project_id`');
    expect(global).toContain('`gcp.storage_bucket`');
    expect(global).not.toContain('`gcp.project_name`'); // 이름은 고유하지 않다(uniqueness none)
  });
  it('문자 줄의 수는 탐침으로 센 값 — 같은 길이의 소문자 이름을 받는 규칙 가운데', () => {
    const gcp = rulesFor('gcp');
    const plain = gcp.filter((r) => r.pattern.test(PROBES.control));
    const n = (probe: string) => plain.filter((r) => !r.pattern.test(probe)).length;
    expect(plain.length).toBeGreaterThan(gcp.length / 2);
    const chars = sec.find((l) => l.startsWith('- GCP, characters: '))!;
    expect(chars).toContain(`of the ${plain.length} rules that accept a plain lower-case name, \`_\` is rejected by ${n(PROBES.underscore)}, \`.\` by ${n(PROBES.dot)} and capital letters by ${n(PROBES.upper)}`);
    // 탐침은 control 과 길이가 같다 — 길이 때문에 세어지는 규칙이 없다
    for (const p of [PROBES.underscore, PROBES.dot, PROBES.upper]) expect(p).toHaveLength(PROBES.control.length);
  });
  it('세 CSP 를 펼치면 CSP 마다 넷씩 — 꺼진 CSP 도 같은 꼴', () => {
    const at = allLines.indexOf('## For AI coding agents');
    const all = allLines.slice(at, allLines.findIndex((l, i) => i > at && l.startsWith('## ')));
    for (const label of ['GCP', 'AWS', 'Azure']) expect(all.filter((l) => l.startsWith(`- ${label}, `)), label).toHaveLength(4);
    expect(all.join('\n')).toContain('`azure.storage_account` (joined with nothing)');
  });
});

describe('buildLlmsText — RULES 에서 만든다 (D9)', () => {
  it('첫 줄은 # Cloudonym', () => expect(lines[0]).toBe('# Cloudonym'));
  it('켜진 CSP 만 — GCP · AWS 절이 있고 공식 줄 수는 두 CSP 규칙 수 · Azure 는 「planned」 한 줄 (D45)', () => {
    expect(lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l))).toHaveLength(enabledRules.length);
    expect(enabledRules).toHaveLength(rulesFor('gcp').length + rulesFor('aws').length);
    expect(rulesFor('gcp')).toHaveLength(153);
    expect(lines.filter((l) => l.startsWith('### ')).every((l) => l === '### GCP' || l === '### AWS' || l === '### env' || l === '### region')).toBe(true);
    expect(lines.filter((l) => l === '### GCP')).toHaveLength(5); // 공식 · 지역 · 종류 · 제약 · 트리
    expect(lines.filter((l) => l === '### AWS')).toHaveLength(4); // 공식 · 지역 · 제약 · 트리 — AWS 는 종류 표가 아직 없다
    expect(text).toMatch(/`aws\.[a-z0-9_]+`/);
    expect(text).not.toMatch(/`azure\.[a-z0-9_]+`/);
    expect(lines.filter((l) => l.includes('planned'))).toEqual(['> Azure: planned — not enabled yet. The API answers 400 `request.provider_not_enabled` for them.']);
    expect(text).toContain('"providers"?: ["gcp", "aws"]');
  });
  it('공식 줄이 규칙 수(손 36 + 들인 행)만큼 있고 template 을 그대로 펼친다 (세 CSP 를 펼친 본문)', () => {
    expect(allLines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l))).toHaveLength(rules.length);
    expect(rules).toHaveLength(36 + AZURE_INTAKE_ROWS.length + GCP_INTAKE_ROWS.length + AWS_INTAKE_ROWS.length + Object.keys(GCP_MANUAL_RULES).length + Object.keys(AWS_MANUAL_RULES).length + AZURE_MANUAL_ROWS.length);
    expect(formulaOf(RULES['gcp.service_account']!)).toBe('<system>-<purpose>-<env>-sa-<role>');
    expect(formulaOf(RULES['azure.storage_account']!)).toBe('st<system><purpose><env>');
    expect(text).toContain('- `gcp.service_account`: `<system>-<purpose>-<env>-sa-<role>`\n');
    expect(text).toContain(`- \`gcp.compute_instance\`: \`${formulaOf(RULES['gcp.compute_instance']!)}\` · optional: region\n`);
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
  it('「## Regions」 절 — 코드 규칙 · 켜진 CSP 마다 리전 한 줄(이름 · 코드 · 위치 · 존) · 존은 리전으로 풀린다 (D49 · D50 revised)', () => {
    const start = lines.indexOf('## Regions');
    expect(start).toBeGreaterThan(lines.indexOf('## Canonical Allowed Values'));
    const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
    const section = lines.slice(start, end);
    const rows = section.filter((l) => /^- `[a-z0-9-]+` · `[a-z0-9]+` — /.test(l));
    expect(REGIONS.gcp).toHaveLength(43);
    expect(REGIONS.aws).toHaveLength(34);
    expect(rows).toHaveLength(REGIONS.gcp.length + REGIONS.aws.length);
    // 지역 표는 입력 표다 — 존 이름 · 존 코드를 받으므로 그대로 둔다
    expect(rows).toContain('- `asia-northeast3` · `ane3` — Seoul, South Korea, APAC · zones: `asia-northeast3-a` `ane3a`, `asia-northeast3-b` `ane3b`, `asia-northeast3-c` `ane3c`');
    for (const r of [...REGIONS.gcp, ...REGIONS.aws]) expect(rows.some((l) => l.startsWith(`- \`${r.region}\` · \`${r.code}\` — ${r.label}`)), r.region).toBe(true);
    expect(rows).toContain('- `ap-northeast-2` · `apne2` — Asia Pacific (Seoul)');
    const body = section.join('\n');
    expect(body).toContain('`kr` and `jp` are rejected');
    // 멀티 · 이중 리전 위치 (D78) — 줄마다 받는 resourceType 과 공식 위치 문서
    expect(body).toContain('- `US` · `us` — multi-region · Data centers in the United States · for `storage_bucket`, `bigquery_dataset`, `logging_bucket` · https://docs.cloud.google.com/storage/docs/locations#location-mr · https://docs.cloud.google.com/bigquery/docs/locations#multi-regions · https://docs.cloud.google.com/logging/docs/region-support#eu-and-us');
    expect(body).toContain('- `NAM4` · `nam4` — dual-region · Iowa + South Carolina (us-central1 + us-east1) · for `storage_bucket` · https://docs.cloud.google.com/storage/docs/locations#predefined');
    expect(body).toContain('`global` puts no region token');
    expect(body).toContain('a zone name is accepted and resolved to its region');
    // 존 코드가 이름에 든다는 문장 · 존을 요구하는 문장이 없다
    expect(body).not.toMatch(/carry the zone code|need a zone|zone code is the region code followed/i);
    expect(text).not.toContain('name.zone_required');
    expect(text).not.toMatch(/Zonal resources/);
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
    expect(formulaOf(RULES['gcp.cloud_sql_instance']!)).toBe('<system>-<purpose>-<env>-<region>-sql-<kind>[-<tier>]-<seq>');
    expect(formulaOf(RULES['gcp.vpc_network']!)).not.toContain('<kind>');
  });
  it('용도 토큰 tier 는 공식에 [-<tier>] 로 — 약어 · 종류 뒤 · 순번 앞 (D60) · 순번 없는 규칙은 약어 · 종류 바로 뒤 (D74)', () => {
    expect(RULES['gcp.cloud_sql_instance']!.template).toContain('tier');
    const formulas = lines.filter((l) => /^- `[a-z]+\.[a-z0-9_]+`: `/.test(l));
    for (const r of enabledRules) {
      const f = formulaOf(r);
      // 구분자는 규칙 것이다 — 밑줄 규칙(D72)은 [_<tier>]_<seq>
      const s = r.separator;
      expect(f.includes(`[${s}<tier>]`), r.id).toBe(r.template.includes('tier'));
      if (r.template.includes('tier') && r.template.includes('seq')) expect(f.endsWith(`[${s}<tier>]${s}<seq>`), r.id).toBe(true);
      if (r.template.includes('tier') && !r.template.includes('seq')) expect(f, r.id).toContain(`${r.slug}[${s}<tier>]`);
    }
    expect(formulaOf(RULES['gcp.storage_bucket']!)).toBe(`<owner>-<system>-<purpose>-<env>-<region>-${RULES['gcp.storage_bucket']!.slug}[-<tier>]`);
    expect(formulaOf(RULES['gcp.compute_instance']!)).toBe(`<system>-<purpose>-<env>-<region>-${RULES['gcp.compute_instance']!.slug}[-<tier>]-<seq>`);
    expect(formulas.filter((l) => l.includes('<tier>')).length).toBeGreaterThan(0);
    // 구분자 없는 규칙은 괄호 안에 구분자도 없다
    const noSep = rules.find((r) => r.separator === '' && r.template.includes('tier'));
    if (noSep) expect(formulaOf(noSep)).toContain('[<tier>]');
  });
  it('절 목록 — 마법사 절 셋(Tiers · Attached resources · Wizard presets)이 Kind tokens 뒤에 있다', () => {
    expect(lines.filter((l) => l.startsWith('## '))).toEqual([
      '## For AI coding agents', '## Naming Formulas', '## Canonical Allowed Values', '## Regions', '## Kind tokens', '## Tiers', '## Attached resources', '## Wizard presets', '## Wizard cards',
      '## Provider Constraints', '## Resource tree', '## What PASS means', '## API', '## Limits', '## Plan file', '## catalog.json fields', '## CLI',
    ]);
  });
  it('「## Tiers」 — 꼴 문법 한 줄 · 예약어 전부 · 프리셋 토큰 · 예시 이름', () => {
    const sec = section('## Tiers');
    expect(sec).toContain(`- \`<tier>\` = \`${TIER_PATTERN.source}\``);
    const reserved = sec.find((l) => l.startsWith('- reserved: '))!;
    expect(reserved.slice('- reserved: '.length).split(' ').map((w) => w.replace(/`/g, ''))).toEqual([...RESERVED_TIERS].sort());
    expect(sec.find((l) => l.startsWith('- preset tokens: '))).toBe(`- preset tokens: ${PRESET_TIERS.map((t) => `\`${t}\``).join(' ')}`);
    expect(sec.join('\n')).toContain('`billing-shop-prod-ane3-gce-web-01`');
    expect(sec.join('\n')).toContain('`wizard.tier_reserved`');
  });
  it('「## Attached resources」 — 접미 넷 · 호환표 행마다 한 줄 · 상속 · 줄이지 않는다', () => {
    const sec = section('## Attached resources');
    const rows = sec.filter((l) => /^- `-(boot|data|ip|ipi)/.test(l));
    expect(rows).toHaveLength(ATTACHMENTS.length);
    for (const a of ATTACHMENTS) expect(rows.some((l) => l.includes(`\`${a.parent}\``) && l.includes(`\`${a.child}\``) && l.includes(`\`${a.attach}\``)), a.attach).toBe(true);
    const body = sec.join('\n');
    expect(body).toContain('`name.parent_invalid`');
    expect(body).toContain('`name.cannot_fit`');
    expect(body).toMatch(/never shortened/);
  });
  it('「## Wizard presets」 — GCP 묶음 서른아홉 · AWS 묶음 열하나(0.2) · 프리셋 id 전부 · HA 규칙', () => {
    const sec = section('## Wizard presets');
    const split = sec.findIndex((l) => l.startsWith('On `provider: "aws"`'));
    expect(split).toBeGreaterThan(0);
    const rows = sec.slice(0, split).filter((l) => l.startsWith('- '));
    const awsRows = sec.slice(split).filter((l) => l.startsWith('- '));
    expect(rows).toHaveLength(39);
    expect(awsRows).toHaveLength(11);
    for (const p of PRESETS) expect(rows.join('\n'), p.id).toContain(`\`${p.id}\``);
    for (const p of presetsFor('aws')) expect(awsRows.join('\n'), p.id).toContain(`\`${p.id}\` (${p.label}) → \`${p.ruleId}\``);
    expect(rows.filter((l) => l.includes('HA'))).toHaveLength(1);
    expect(awsRows.filter((l) => l.includes('HA'))).toHaveLength(1);
    expect(rows.join('\n')).toContain('`gcp.run_service`');
    expect(awsRows.join('\n')).toContain('`aws.lambda_function`');
  });
  it('「## Wizard cards」 (D93 · D114) — 카드 열 · 서비스 부품과 project 부품 · API 에는 카드가 없다고 말한다', () => {
    const sec = section('## Wizard cards');
    const rows = sec.filter((l) => l.startsWith('- '));
    expect(rows.map((l) => /^- `([a-z-]+)`/.exec(l)?.[1])).toEqual(['website', 'serverless-web', 'static-site', 'website-mig', 'vm-app', 'https-lb', 'data-warehouse', 'gke', 'event-pipeline', 'ci-cd', 'batch-job', 'task-queue']);
    expect(rows[7]).toContain('project: `vpc`, `subnet`');
    expect(rows[8]).toContain('`dlq`');
    // D128 — 2026-10-23 실배포로 https-lb · task-queue · website-mig 까지 열둘 전부 만들어 보았다
    for (const r of rows) expect(r).toContain('built and tested on Google Cloud');
    expect(rows.join('\n')).not.toContain('rules verified, the set not yet applied');
    expect(rows[0]).toContain('project: `firewall` tier `web`, `firewall` tier `lbhc`');
    // D126 — 역할 부품은 role 을 밝힌다
    expect(rows[9]).toContain('`sa` role `build`');
    expect(rows[1]).toContain('`neg`');
    expect(rows[1]).not.toContain('`hc`');
    expect(sec.join('\n')).toContain('Cards are not part of `/v1/wizard`');
  });
  it('API 절 — POST /v1/wizard 한 줄 · 재현 문장 · 머리말에도', () => {
    const api = section('## API').join('\n');
    expect(api).toContain('- `POST /v1/wizard` — body');
    expect(api).toContain('"project_picks"');
    expect(api).toContain('project_picks[0].instances[0].attach.data[1]');
    expect(text).toContain('the wizard response is reproduced by repeating the same wizard request with its `rules_version`; `/v1/names` is a separate, flat endpoint');
    expect(lines.find((l) => l.startsWith('> For humans'))).toContain('`POST /v1/wizard`');
  });
  it('API 절 — /v1/validate 의 응답 칸 · warnings 는 valid 를 바꾸지 않는다 (D112)', () => {
    const v = section('## API').find((l) => l.startsWith('- `POST /v1/validate`'))!;
    expect(v).toContain('`{ valid, version, violations, warnings?, suggested_name?, suggested_warnings? }`');
    expect(v).toContain('warnings never change `valid`');
    expect(v).toContain('`suggested_warnings` when `suggested_name` has one');
    expect(text).toContain('`violations`, `warnings`, `steps`, `errors`, `rule.notes` and the label lists are arrays of');
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
  it('「## Resource tree」 절의 Supported resources — 켜진 CSP 마다 화면과 같은 수(resourceCount)', () => {
    const line = lines.find((l) => l.startsWith('Supported resources: '));
    expect(line).toBe(`Supported resources: ${ENABLED_PROVIDERS.map((p) => `${p} ${resourceCount(p)}`).join(' · ')} (rows of the tree below, counted from the catalog)`);
    expect(lines.indexOf(line!)).toBeGreaterThan(lines.indexOf('## Resource tree'));
  });
  it('「## Resource tree」 절 — provider 마다 범위 노드(id · docUrl) 아래 규칙마다 들여쓴 한 줄(id · input) · scope/uniqueness 문장은 openapi 와 같다', () => {
    // 공개 본문은 켜진 CSP 의 범위 · 규칙만
    const pubAt = lines.indexOf('## Resource tree');
    const pub = lines.slice(pubAt, lines.findIndex((l, i) => i > pubAt && l.startsWith('## ')));
    expect(pub.filter((l) => /^ +- `[a-z]+\.[a-z0-9_]+` · input: /.test(l))).toHaveLength(enabledRules.length);
    expect(pub.some((l) => /\(`aws:/.test(l))).toBe(true);
    expect(pub.some((l) => /\(`azure:/.test(l))).toBe(false);
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

describe('API 를 쓰는 데 필요한 나머지 — 한도 · 계획 파일 · catalog 칸 · CLI (D100 · D101 · D102 · D103)', () => {
  it('머리말에 사람용 안내 /docs/api 한 줄', () => {
    expect(lines.slice(0, 12).find((l) => l.includes('`/docs/api`'))).toBeDefined();
  });
  it('「## Limits」 — 본문 상한 · 요청 제한(받는 경로 · 받지 않는 경로) · 429 + Retry-After · 413 · 필드 · 항목 · 오류 수 · 되돌린 값 길이가 상수와 같다', () => {
    const sec = section('## Limits').join('\n');
    expect(sec).toContain(`${MAX_BODY_BYTES} bytes`);
    expect(sec).toContain('413 `request.body_too_large`');
    expect(sec).toContain(`${RATE_LIMIT.limit} requests per ${RATE_LIMIT.period} seconds per client IP`);
    expect(sec).toContain('429 `request.rate_limited`');
    expect(sec).toContain(`\`Retry-After: ${RATE_LIMIT.period}\``);
    for (const p of API_DOC_LIMITED_ROOT) expect(sec, p).toContain(`\`GET ${p}\``);
    for (const p of API_DOC_UNLIMITED) expect(sec, p).toContain(`\`GET ${p}\``);
    expect(sec).toContain(`at most ${MAX_CONTEXT_CHARS} characters`);
    expect(sec).toContain(`at most ${MAX_FIELD_CHARS}`);
    expect(sec).toContain(`At most ${MAX_ITEMS} resources and ${MAX_NAMES} names`);
    expect(MAX_WIZARD_ERRORS).toBe(MAX_GENERATE_ERRORS);
    expect(sec).toContain(`at most the first ${MAX_WIZARD_ERRORS} errors`);
    expect(sec).toContain('`request.errors_truncated`');
    expect(sec).toContain(`cut to ${MAX_ECHO_CHARS} characters`);
    // 오류 수 상한 문장은 한 곳(Limits)에만 — API 절의 경로 줄에서 옮겼다
    expect(section('## API').join('\n')).not.toContain('errors_truncated');
  });
  it('「## Plan file」 — 칸은 plan.schema.json 과 같다 · environments 는 API 가 무시 · 환경마다 한 번 · Save plan · Open plan · 파일 상한 · /plan.schema.json', () => {
    const sec = section('## Plan file').join('\n');
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/plan.schema.json'), 'utf-8')) as { properties: Record<string, unknown> };
    for (const k of Object.keys(schema.properties).filter((k) => k !== '$schema')) expect(sec, k).toContain(`\`${k}\``);
    expect(sec).toContain('`GET /plan.schema.json`');
    expect(sec).toMatch(/API ignores `environments`/);
    expect(sec).toMatch(/one request per environment/);
    expect(sec).toContain('**Save plan**');
    expect(sec).toContain('**Open plan**');
    expect(sec).toContain(`${PLAN_FILE_MAX_BYTES.toLocaleString('en-US')} bytes`);
    expect(sec).toContain(`${MAX_BODY_BYTES} bytes`);
  });
  it('「## catalog.json fields」 — 규칙 칸 셋 · 프리셋 · 딸린 것 · limits 의 키가 /catalog.json 과 같다', () => {
    const sec = section('## catalog.json fields').join('\n');
    for (const k of ['env_values', 'input', 'tier', 'locations', 'presets', 'attachments', 'limits', 'scopes']) expect(sec, k).toContain(`\`${k}\``);
    for (const e of ENV_VALUES) expect(sec, e).toContain(`\`${e}\``);
    for (const v of ['count', 'role', 'none']) expect(sec, v).toContain(`\`${v}\``);
    for (const k of Object.keys(CATALOG_LIMITS)) expect(sec, k).toContain(`\`${k}\``);
    const presetKeys = new Set(catalogPresets('gcp').flatMap((p) => Object.keys(p)));
    for (const k of presetKeys) expect(sec, k).toContain(`\`${k}\``);
    for (const k of Object.keys(catalogAttachments('gcp')[0]!)) expect(sec, k).toContain(`\`${k}\``);
  });
  it('「## CLI」 — 저장소에서 node cli/cloudonym.mjs · npm 공개 없음 · 서버 URL · 명령 다섯(--help 와 같다) · 파일 둘 · add 는 덧붙이기만', async () => {
    const sec = section('## CLI');
    const body = sec.join('\n');
    expect(body).toContain('`node cli/cloudonym.mjs');
    expect(body).toMatch(/not published to npm/);
    expect(body).toContain('`--server <origin>`');
    expect(body).toContain('`CLOUDONYM_SERVER`');
    const out: string[] = [];
    await cliMain(['--help'], { stdout: (x: string) => { out.push(x); } });
    const help = out.join('\n').split('\n');
    const commands = [...new Set(help.slice(help.indexOf('Commands') + 1, help.indexOf('Options')).map((l) => /^ {2}([a-z]+) /.exec(l)?.[1]).filter((c): c is string => c !== undefined))];
    expect(commands).toEqual(['new', 'init', 'add', 'names', 'validate', 'completion']);
    for (const c of commands) expect(sec.some((l) => l.startsWith(`- \`${c}\``)), c).toBe(true);
    expect(body).toContain('`cloudonym.plan.json`');
    expect(body).toContain('`cloudonym.plan.names.json`');
    expect(help.join('\n')).toContain('default cloudonym.plan.json');
    expect(body).toMatch(/writes the file only if every existing name and verdict stays the same/);
    // 종료 코드 — --help 의 줄과 글자까지 같고(그 줄은 cli/main.test.mjs [6] 이 docs/cli.md · D102 와 대어 본다), 번호는 EXIT 와 같다
    const exitLine = sec.find((l) => l.startsWith('- Exit codes: '))!;
    expect(exitLine).toBe(`- ${help.find((l) => l.startsWith('Exit codes: '))}`);
    const nums = [...exitLine.matchAll(/(?:: | · )(\d+) /g)].map((m) => Number(m[1]));
    expect(nums).toEqual(Object.values(EXIT).sort((a, b) => a - b));
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
  it('app.routes 는 정확히 열한 경로(IndexNow 키 파일 GET /:file — D120) + 화면 HTML · secureHeaders 의 ALL /* 둘 · cors 의 ALL /v1/* 하나 · /v1/v1 없음', () => {
    const routes = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(routes.filter((r) => !r.startsWith('ALL ')).sort()).toEqual(['GET /:file', 'GET /catalog.json', 'GET /llms.txt', 'GET /robots.txt', 'GET /sitemap.xml', 'GET /v1/health', 'POST /v1/events', 'POST /v1/generate', 'POST /v1/names', 'POST /v1/validate', 'POST /v1/wizard']);
    expect(routes.filter((r) => r.startsWith('ALL ')).sort()).toEqual(['ALL /*', 'ALL /*', 'ALL /v1/*']);
    expect(routes.some((r) => r.includes('/v1/v1'))).toBe(false);
  });
});
