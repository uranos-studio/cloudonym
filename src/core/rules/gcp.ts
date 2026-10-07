// GCP 규칙 표 — constraints.ts 가 aws · azure 와 합쳐 RULES 로 낸다 (파일을 나눠도 이름 · 판정 불변)
import type { ResourceRule, Token } from '../types';
import { GCP_INTAKE_ROWS } from './gcp-intake';
import { GCP_MANUAL_RULES } from './gcp-manual';
import { GCP_CATALOG } from './gcp-catalog';

/** Compute 디스커버리 문서 — insert.path 가 범위(global · regions/{region} · zones/{zone})를 준다 */
const GCP_COMPUTE_DISCOVERY = 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest';
/** RFC 1035 라벨 — GCP compute_instance · vpc_network · subnet */
const RFC1035 = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

const GCP_HAND_RULES: Record<string, ResourceRule> = {
  'gcp.project_id': {
    id: 'gcp.project_id', provider: 'gcp', resourceType: 'project_id',
    displayName: 'Project ID', slug: '', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    forbidden: { contains: ['google', 'ssl'] },
    template: ['owner', 'system', 'purpose', 'env'], optional: ['owner'],
    scope: 'gcp:namespace', entity: 'cloudresourcemanager.projects', category: 'management', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/resource-manager/docs/creating-managing-projects#identifiers',
    // undefined · null 은 문서가 "Avoid"(권고)라 적었다 — 금지가 아니므로 넣지 않는다
  },
  'gcp.service_account': {
    id: 'gcp.service_account', provider: 'gcp', resourceType: 'service_account',
    displayName: 'Service Account', slug: 'sa', minLength: 6, maxLength: 30,
    pattern: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['owner', 'system', 'purpose', 'env', 'region', 'slug', 'role'], optional: ['region', 'owner'],
    scope: 'gcp:project', entity: 'iam.serviceAccounts', category: 'identity', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/create',
  },
  'gcp.compute_instance': {
    id: 'gcp.compute_instance', provider: 'gcp', resourceType: 'compute_instance',
    displayName: 'Compute Engine Instance', slug: 'vm', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    // 디스커버리 insert.path 는 zones/{zone}/instances 지만 naming-resources 가 「vmDnsSetting 이 ZonalOnly 가 아니면 프로젝트 안 유일」이라 해 프로젝트 범위에 둔다
    scope: 'gcp:project', entity: 'compute.instances', category: 'compute', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/compute/docs/naming-resources',
    notes: [{ code: 'note.gcp_vm_project_unique' }],
  },
  'gcp.vpc_network': {
    id: 'gcp.vpc_network', provider: 'gcp', resourceType: 'vpc_network',
    displayName: 'VPC Network', slug: 'vpc', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'slug', 'seq'], optional: [],
    scope: 'gcp:project_global', entity: 'compute.networks', category: 'networking', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/networks#Network.FIELDS.name',
  },
  'gcp.subnet': {
    id: 'gcp.subnet', provider: 'gcp', resourceType: 'subnet',
    displayName: 'Subnet', slug: 'subnet', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'gcp:project_region', entity: 'compute.subnetworks', category: 'networking', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/subnetworks#Subnetwork.FIELDS.name',
  },
  'gcp.cloud_sql_instance': {
    id: 'gcp.cloud_sql_instance', provider: 'gcp', resourceType: 'cloud_sql_instance',
    displayName: 'Cloud SQL Instance', slug: 'db', minLength: 1, maxLength: 67,
    pattern: /^[a-z]([a-z0-9-]*[a-z0-9])?$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'gcp:project', entity: 'sqladmin.instances', category: 'database', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/sql/docs/mysql/instance-settings',
    notes: [{ code: 'note.cloud_sql_combined_limit' }],
  },
  'gcp.storage_bucket': {
    id: 'gcp.storage_bucket', provider: 'gcp', resourceType: 'storage_bucket',
    displayName: 'Cloud Storage Bucket', slug: 'bucket', minLength: 3, maxLength: 63,
    pattern: /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: false, endsWithAlnum: true,
    forbidden: { prefixes: ['goog'], contains: ['google', 'g00gle', '..'], ipv4: true },
    template: ['owner', 'system', 'purpose', 'env', 'slug'], optional: ['owner'],
    scope: 'gcp:namespace', entity: 'storage.buckets', category: 'storage', uniqueness: 'csp',
    docUrl: 'https://docs.cloud.google.com/storage/docs/buckets#naming',
    notes: [{ code: 'note.gcs_dotted_names_222' }],
  },
  // 2026-10-06 추가 11종 — "The name must be 1-63 characters long, and comply with RFC1035" (REST 참조 name 필드) · 디스커버리 Firewall.name · Disk.name pattern 이 RFC1035 와 같다
  'gcp.firewall_rule': {
    id: 'gcp.firewall_rule', provider: 'gcp', resourceType: 'firewall_rule',
    displayName: 'VPC Firewall Rule', slug: 'fw', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    // 전역 리소스(global/firewalls)라 region 토큰을 넣지 않는다 — vpc_network 와 같은 꼴
    template: ['system', 'purpose', 'env', 'slug', 'seq'], optional: [],
    scope: 'gcp:project_global', entity: 'compute.firewalls', category: 'networking', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/firewalls#Firewall.FIELDS.name',
  },
  'gcp.disk': {
    id: 'gcp.disk', provider: 'gcp', resourceType: 'disk',
    displayName: 'Persistent Disk', slug: 'disk', minLength: 1, maxLength: 63,
    pattern: RFC1035, allowed: 'lower-digit-hyphen', separator: '-', caseRule: 'lower',
    startsWithLetter: true, endsWithAlnum: true,
    template: ['system', 'purpose', 'env', 'region', 'slug', 'seq'], optional: ['region'],
    scope: 'gcp:project_zone', entity: 'compute.disks', category: 'compute', uniqueness: 'csp', uniquenessDocUrl: GCP_COMPUTE_DISCOVERY,
    docUrl: 'https://docs.cloud.google.com/compute/docs/reference/rest/v1/disks#Disk.FIELDS.name',
  },
};

// ─── 들인 행 (D43) — rules/gcp-intake.ts 의 행을 규칙으로 편다 ──────────────
// 생성 꼴은 손으로 쓴 규칙을 따른다: 전역(global) 리소스는 vpc_network 꼴(region 없음), 지역 · 영역 · 위치 리소스는 subnet 꼴(region 선택).
const GLOBAL_TEMPLATE: Token[] = ['system', 'purpose', 'env', 'slug', 'seq'];
const PLACED_TEMPLATE: Token[] = ['system', 'purpose', 'env', 'region', 'slug', 'seq'];

function fromIntakeRow(r: (typeof GCP_INTAKE_ROWS)[number]): ResourceRule {
  const template = r.scope === 'gcp:project_global' ? GLOBAL_TEMPLATE : PLACED_TEMPLATE;
  const rfc = r.chars === 'rfc1035';
  return {
    id: r.id, provider: 'gcp', resourceType: r.id.slice('gcp.'.length), displayName: r.displayName, slug: r.slug,
    minLength: r.min, maxLength: r.max,
    // 원문 정규식은 앵커가 없다 — 이름 전체에 맞도록 감싼다
    pattern: new RegExp(`^(?:${r.pattern})$`),
    allowed: rfc ? 'lower-digit-hyphen' : 'alnum-hyphen-underscore', separator: '-', caseRule: rfc ? 'lower' : 'any',
    startsWithLetter: rfc, endsWithAlnum: rfc,
    template, optional: template.includes('region') ? ['region'] : [],
    scope: r.scope, entity: r.entity, category: r.category, uniqueness: 'csp',
    ...(r.uniquenessDocUrl ? { uniquenessDocUrl: r.uniquenessDocUrl } : {}),
    docUrl: r.docUrl,
  };
}

/** catalog 를 덮기 전 규칙 표 — 손으로 쓴 규칙 다음에 들인 행 · 손으로 넣은 행(생성기 순서). 시험이 덮은 뒤와 대어 본다 */
export const GCP_BASE_RULES: Record<string, ResourceRule> = {
  ...GCP_HAND_RULES,
  ...Object.fromEntries(GCP_INTAKE_ROWS.map((r) => [r.id, fromIntakeRow(r)])),
  ...GCP_MANUAL_RULES,
};

/** 규칙 id → catalog 행 · 그 규칙의 칸 */
const CATALOG_BY_RULE = new Map(GCP_CATALOG.flatMap((row) => Object.entries(row.rules).map(([id, spec]) => [id, { row, spec }] as const)));

/** catalog 가 규칙 위에 덮는다 (D47) — 약어 · entity(행에 있을 때) · 지역 토큰 종류 · 종류 표.
 *  지역 토큰이 none 이면 템플릿과 optional 에서 region 을 함께 뺀다(optional 은 template 에 있는 토큰만).
 *  종류 토큰을 이름에 넣는 일 · 존 규칙의 optional 은 여기서 하지 않는다. category 는 덮지 않는다 — 합친 행의 category 는 첫 규칙을 따른다 */
export function applyCatalog(rule: ResourceRule): ResourceRule {
  const hit = CATALOG_BY_RULE.get(rule.id);
  if (!hit) throw new Error(`GCP rule not in catalog: ${rule.id}`);
  const { row, spec } = hit;
  const dropRegion = (ts: readonly Token[]): Token[] => (spec.regionToken === 'none' ? ts.filter((t) => t !== 'region') : [...ts]);
  return {
    ...rule,
    slug: row.slug.value,
    entity: row.entity ?? rule.entity,
    template: dropRegion(rule.template),
    optional: dropRegion(rule.optional),
    regionToken: spec.regionToken,
    ...(row.kind && spec.kinds ? {
      kinds: { rule: row.kind.rule, default: spec.kinds.default, allowed: spec.kinds.allowed, tokens: row.kind.tokens, omitValues: row.kind.omitValues },
    } : {}),
  };
}

/** GCP 규칙 표 — catalog 를 덮은 뒤 */
export const GCP_RULES: Record<string, ResourceRule> = Object.fromEntries(Object.entries(GCP_BASE_RULES).map(([id, r]) => [id, applyCatalog(r)]));
