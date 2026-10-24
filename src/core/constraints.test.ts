import { describe, it, expect } from 'vitest';
import { AZURE_INTAKE_ROWS } from './rules/azure-intake';
import { GCP_INTAKE_ROWS } from './rules/gcp-intake';
import { AWS_INTAKE_ROWS } from './rules/aws-intake';
import { AWS_NAME_TAG_GENERAL } from './rules/aws';
import { GCP_MANUAL_RULES } from './rules/gcp-manual';
import { AWS_MANUAL_RULES } from './rules/aws-manual';
import { AZURE_MANUAL_ROWS } from './rules/azure-manual';
import { RULES, rulesFor, getRule, LABEL_LIMITS, AWS_TAG_VALUE_DOC_URL, WINDOWS_COMPUTER_NAME_DOC_URL, AZURE_RESERVED_DOC_URL, AWS_NAME_TAG } from './constraints';
import { PROVIDERS } from './types';
import { GCP_BASE_RULES, GCP_RULES } from './rules/gcp';
import { rowOf } from './catalog';

describe('RULES 표 무결성', () => {
  it('모든 규칙에 docUrl(https) · 길이 순서 · id 형식이 있다', () => {
    for (const r of Object.values(RULES)) {
      expect(r.docUrl).toMatch(/^https:\/\//);
      expect(r.minLength).toBeGreaterThan(0);
      expect(r.maxLength).toBeGreaterThanOrEqual(r.minLength);
      expect(r.id).toBe(`${r.provider}.${r.resourceType}`);
      expect(r.template.length).toBeGreaterThan(0);
    }
  });
  it('optional 은 template 에 있는 토큰만, slug 가 있으면 template 에 slug 가 있다', () => {
    for (const r of Object.values(RULES)) {
      for (const t of r.optional) expect(r.template).toContain(t);
      if (r.slug) expect(r.template).toContain('slug');
      else expect(r.template).not.toContain('slug');
    }
  });
  it('구분자 없는 규칙의 allowed 는 lower-digit 다', () => {
    for (const r of Object.values(RULES)) if (r.separator === '') expect(r.allowed).toBe('lower-digit');
  });
  it('rulesFor 는 그 provider 의 규칙만, 각 CSP 6개 이상', () => {
    for (const p of PROVIDERS) {
      const rs = rulesFor(p);
      expect(rs.length).toBeGreaterThanOrEqual(6);
      for (const r of rs) expect(r.provider).toBe(p);
    }
  });
  it('세 CSP 모두 VM · VPC · Subnet · DB · 저장소 · 자격 여섯 부류를 덮는다 (D18)', () => {
    const want: Record<string, string[]> = {
      gcp: ['compute_instance', 'vpc_network', 'subnet', 'cloud_sql_instance', 'storage_bucket', 'service_account'],
      aws: ['ec2_instance', 'vpc', 'subnet', 'rds_instance', 's3_bucket', 'iam_role'],
      azure: ['virtual_machine', 'virtual_network', 'subnet', 'sql_server', 'storage_account', 'managed_identity'],
    };
    for (const p of PROVIDERS) for (const t of want[p]) expect(getRule(p, t), `${p}.${t}`).toBeDefined();
  });
  it('getRule 은 모르는 유형에 undefined', () => {
    expect(getRule('gcp', 'service_account')?.maxLength).toBe(30);
    expect(getRule('gcp', 'nope')).toBeUndefined();
    expect(getRule('gcp', 'constructor')).toBeUndefined();
  });
});

describe('LABEL_LIMITS', () => {
  it('세 CSP 모두 키 · 값 한도가 양수이고 docUrl 이 https 다', () => {
    for (const p of PROVIDERS) {
      const l = LABEL_LIMITS[p];
      expect(l.key).toBeGreaterThan(0);
      expect(l.value).toBeGreaterThan(0);
      expect(l.docUrl).toMatch(/^https:\/\//);
    }
  });
  it('AWS 태그 값 문자 규칙의 docUrl 은 태그 한도와 같은 쪽의 #tag-conventions 다', () => {
    expect(AWS_TAG_VALUE_DOC_URL).toBe(LABEL_LIMITS.aws.docUrl);
    expect(AWS_TAG_VALUE_DOC_URL).toMatch(/^https:\/\/docs\.aws\.amazon\.com\/.*#tag-conventions$/);
  });
});

describe('공식 문서 대조로 고친 값 ', () => {
  it('S3 금지 접미사에 -an 이 있다 (계정 지역 네임스페이스 전용)', () => {
    expect(RULES['aws.s3_bucket'].forbidden?.suffixes).toContain('-an');
  });
  it('AKS Linux 노드풀 예약 이름 aksmanagedap 을 막는다', () => {
    expect(RULES['azure.aks_nodepool_linux'].forbidden?.exact).toContain('aksmanagedap');
  });
  it('Windows VM 의 숫자만 금지는 Windows ComputerName 문서가 근거이고 notes 에 그 URL 이 실린다', () => {
    expect(WINDOWS_COMPUTER_NAME_DOC_URL).toMatch(/^https:\/\/learn\.microsoft\.com\/en-us\/windows-hardware\/.*computername$/);
    expect(RULES['azure.virtual_machine_windows'].notes).toContainEqual({ code: 'note.windows_no_all_digits', params: { doc_url: WINDOWS_COMPUTER_NAME_DOC_URL } });
    expect(RULES['azure.virtual_machine_windows'].pattern.test('12345')).toBe(false);
    expect(JSON.stringify(RULES['azure.virtual_machine'].notes ?? [])).not.toContain(WINDOWS_COMPUTER_NAME_DOC_URL);
  });
  it('리소스 그룹 pattern 은 십진 숫자(Nd)만 받는다', () => {
    const p = RULES['azure.resource_group'].pattern;
    expect(p.test('개발-1')).toBe(true);
    expect(p.test('rg-٣')).toBe(true); // U+0663 Nd
    expect(p.test('rg-²')).toBe(false); // U+00B2 No
    expect(p.test('rg-Ⅻ')).toBe(false); // U+216B Nl
  });
  it('Azure 예약어는 공개 엔드포인트가 있거나 모호한 규칙에만 걸리고 notes 에 근거 URL 이 실린다', () => {
    expect(AZURE_RESERVED_DOC_URL).toBe('https://learn.microsoft.com/en-us/azure/azure-resource-manager/troubleshooting/error-reserved-resource-name');
    const on = ['storage_account', 'key_vault', 'sql_server', 'virtual_machine', 'virtual_machine_windows', 'aks_nodepool_linux', 'aks_nodepool_windows'];
    for (const r of rulesFor('azure')) {
      const has = (r.forbidden?.words ?? []).includes('azure');
      // 들인 행은 전역 범위(이름이 엔드포인트)만 건다 — rules/azure.ts
      const intakeReserved = AZURE_INTAKE_ROWS.some((x) => x.id === r.id && x.reserved === true);
      // 손으로 넣은 행은 reserved 로 표시한 것만 — rules/azure-manual.ts
      const manualReserved = AZURE_MANUAL_ROWS.some((x) => x.id === r.id && x.reserved);
      expect(has, r.id).toBe(on.includes(r.resourceType) || intakeReserved || manualReserved);
      if (has) {
        expect(r.forbidden?.contains, r.id).toEqual(expect.arrayContaining(['microsoft', 'windows']));
        expect(r.forbidden?.prefixes, r.id).toContain('login');
        expect(r.forbidden?.ignoreCase, r.id).toBe(true);
        expect(r.notes?.map((n) => ('params' in n ? n.params : undefined)), r.id).toContainEqual({ doc_url: AZURE_RESERVED_DOC_URL });
      }
    }
  });
  it('ignoreCase 규칙의 금지 목록은 전부 소문자다 — validate 가 이름만 소문자로 바꾸므로', () => {
    for (const r of Object.values(RULES)) {
      const f = r.forbidden;
      if (!f?.ignoreCase) continue;
      for (const v of [...(f.prefixes ?? []), ...(f.suffixes ?? []), ...(f.contains ?? []), ...(f.exact ?? []), ...(f.words ?? [])]) {
        expect(v, `${r.id} ${v}`).toBe(v.toLowerCase());
      }
    }
  });
  it('Azure 서브넷 scope 는 virtual_network · AKS 노드풀 scope 는 managed_cluster', () => {
    expect(RULES['azure.subnet'].scope).toBe('azure:virtual_network');
    expect(RULES['azure.aks_nodepool_linux'].scope).toBe('azure:managed_cluster');
    expect(RULES['azure.aks_nodepool_windows'].scope).toBe('azure:managed_cluster');
  });
});

describe('고유성 부류 · 분류 · 유일성 (D31 · D37 · D38)', () => {
  it('entity 는 비어 있지 않고 Azure 는 Microsoft. 로 시작한다', () => {
    for (const r of Object.values(RULES)) {
      expect(r.entity.length, r.id).toBeGreaterThan(0);
      if (r.provider === 'azure') expect(r.entity, r.id).toMatch(/^Microsoft\./);
    }
  });
  it('Linux · Windows VM 은 같은 부류 · AKS 노드풀 둘도 같은 부류다', () => {
    expect(RULES['azure.virtual_machine'].entity).toBe('Microsoft.Compute/virtualMachines');
    expect(RULES['azure.virtual_machine_windows'].entity).toBe(RULES['azure.virtual_machine'].entity);
    expect(RULES['azure.aks_nodepool_linux'].entity).toBe('Microsoft.ContainerService/managedClusters/agentPools');
    expect(RULES['azure.aks_nodepool_windows'].entity).toBe(RULES['azure.aks_nodepool_linux'].entity);
  });
  it("uniqueness 'none' 인 규칙은 AWS Name 태그와 GCP 프로젝트 이름(D85)뿐이다 — 그 역도 같다", () => {
    for (const r of Object.values(RULES)) expect(r.uniqueness === 'none', r.id).toBe(r.pattern === AWS_NAME_TAG || r.pattern === AWS_NAME_TAG_GENERAL || r.id === 'gcp.project_name');
    const tagIntake = AWS_INTAKE_ROWS.filter((x) => x.kind === 'b').map((x) => x.id);
    expect(Object.values(RULES).filter((r) => r.uniqueness === 'none').map((r) => r.id).sort()).toEqual(['aws.ebs_volume', 'aws.ec2_instance', 'aws.internet_gateway', 'aws.route_table', 'aws.subnet', 'aws.vpc', 'gcp.project_name', ...tagIntake].sort());
  });
  it('uniquenessDocUrl 이 있으면 https 이고 docUrl 과 다르다', () => {
    for (const r of Object.values(RULES)) {
      if (r.uniquenessDocUrl === undefined) continue;
      expect(r.uniquenessDocUrl, r.id).toMatch(/^https:\/\//);
      expect(r.uniquenessDocUrl, r.id).not.toBe(r.docUrl);
    }
  });
  it('resourceType 은 40자 이하 — 공유 hash 상한(D42)이 이 수에 기댄다', () => {
    for (const r of Object.values(RULES)) expect(r.resourceType.length, r.id).toBeLessThanOrEqual(40);
  });
  it('GCP VM 은 프로젝트 범위 — ZonalOnly 가 아니면 프로젝트 안 유일이라는 note 가 실린다', () => {
    expect(RULES['gcp.compute_instance'].scope).toBe('gcp:project');
    expect(RULES['gcp.compute_instance'].notes).toContainEqual({ code: 'note.gcp_vm_project_unique' });
  });
});

describe('표시 이름 · notes (D24 · 문구 코드화)', () => {
  it('모든 displayName 에 한글이 없다 — 규칙 표의 표시 이름은 데이터라 영어로 둔다', () => {
    const hangul = /\p{Script=Hangul}/u;
    expect(hangul.test('힣') && hangul.test('ㄱ') && !hangul.test('A')).toBe(true); // 검사기 자체
    expect(Object.values(RULES).filter((r) => hangul.test(r.displayName)).map((r) => r.id)).toEqual([]);
  });
  it('Windows VM 의 notes 는 호스트명 · 숫자만 금지 · 예약어(모호) 세 코드', () => {
    expect(RULES['azure.virtual_machine_windows'].notes?.map((n) => n.code)).toEqual(['note.azure_vm_hostname_rule', 'note.windows_no_all_digits', 'note.azure_reserved_ambiguous']);
  });
});

describe('2026-10-06 추가 11종 — 범위 · 부류 · 분류 · 근거', () => {
  const want: [string, string, string, string, 'csp' | 'none'][] = [
    ['aws.internet_gateway', 'aws:region', 'ec2.internetGateway.NameTag', 'networking', 'none'],
    ['aws.route_table', 'aws:vpc', 'ec2.routeTable.NameTag', 'networking', 'none'],
    ['aws.ebs_volume', 'aws:region', 'ec2.volume.NameTag', 'storage', 'none'],
    ['aws.security_group', 'aws:vpc', 'ec2.securityGroup', 'networking', 'csp'],
    ['aws.key_pair', 'aws:region', 'ec2.keyPair', 'compute', 'csp'],
    ['gcp.firewall_rule', 'gcp:project_global', 'compute.firewalls', 'networking', 'csp'],
    ['gcp.disk', 'gcp:project_zone', 'compute.disks', 'compute', 'csp'],
    ['azure.public_ip', 'azure:resource_group', 'Microsoft.Network/publicIPAddresses', 'networking', 'csp'],
    ['azure.network_security_group', 'azure:resource_group', 'Microsoft.Network/networkSecurityGroups', 'networking', 'csp'],
    ['azure.network_interface', 'azure:resource_group', 'Microsoft.Network/networkInterfaces', 'networking', 'csp'],
    ['azure.os_disk', 'azure:resource_group', 'Microsoft.Compute/disks', 'compute', 'csp'],
  ];
  it.each(want)('%s — scope %s · entity %s · category %s · uniqueness %s', (id, scope, entity, category, uniqueness) => {
    const r = RULES[id];
    expect(r, id).toBeDefined();
    expect({ scope: r!.scope, entity: r!.entity, category: r!.category, uniqueness: r!.uniqueness }).toEqual({ scope, entity, category, uniqueness });
    expect(r!.docUrl).toMatch(/^https:\/\//);
    expect(r!.template).toContain('seq');
  });
  it('규칙 수 — provider 마다 손으로 쓴 규칙 + 들인 행 + 손으로 넣은 규칙(rules/*-manual.ts)', () => {
    expect([rulesFor('aws').length, rulesFor('gcp').length, rulesFor('azure').length]).toEqual([11 + AWS_INTAKE_ROWS.length + Object.keys(AWS_MANUAL_RULES).length, 10 + GCP_INTAKE_ROWS.length + Object.keys(GCP_MANUAL_RULES).length, 15 + AZURE_INTAKE_ROWS.length + AZURE_MANUAL_ROWS.length]);
  });
  it('docUrl 은 숫자가 적힌 쪽의 앵커다', () => {
    expect(RULES['gcp.firewall_rule']!.docUrl).toBe('https://docs.cloud.google.com/compute/docs/reference/rest/v1/firewalls#Firewall.FIELDS.name');
    expect(RULES['gcp.disk']!.docUrl).toBe('https://docs.cloud.google.com/compute/docs/reference/rest/v1/disks#Disk.FIELDS.name');
    expect(RULES['aws.security_group']!.docUrl).toBe('https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html');
    expect(RULES['aws.key_pair']!.docUrl).toBe('https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateKeyPair.html');
    for (const id of ['azure.public_ip', 'azure.network_security_group', 'azure.network_interface']) expect(RULES[id]!.docUrl, id).toMatch(/#microsoftnetwork$/);
    expect(RULES['azure.os_disk']!.docUrl).toMatch(/#microsoftcompute$/);
  });
  it('보안 그룹의 금지 접두사는 소문자 sg- 하나이고 대소문자 없이 본다 · Azure 넷은 예약어를 걸지 않는다', () => {
    expect(RULES['aws.security_group']!.forbidden).toEqual({ prefixes: ['sg-'], ignoreCase: true });
    for (const id of ['azure.public_ip', 'azure.network_security_group', 'azure.network_interface', 'azure.os_disk']) expect(RULES[id]!.forbidden, id).toBeUndefined();
  });
  it('키 페어는 범위(리전)가 미확인이라는 note 를 싣는다', () => {
    expect(RULES['aws.key_pair']!.notes?.map((n) => n.code)).toEqual(['note.aws_key_pair_scope_unconfirmed']);
  });
});

describe('catalog 를 GCP 규칙에 덮는다 (D47)', () => {
  const specOf = (id: string) => rowOf(id)!.rules[id]!;

  it('GCP 규칙 약어 = catalog 약어 · 지역 토큰 종류 = catalog', () => {
    for (const r of rulesFor('gcp')) {
      expect(r.slug, r.id).toBe(rowOf(r.id)!.slug.value);
      expect(r.regionToken, r.id).toBe(specOf(r.id).regionToken);
    }
  });

  it('함수 1 · 2세대는 entity 가 같다 — cloudfunctions.functions', () => {
    expect(RULES['gcp.cloud_function_gen1']!.entity).toBe('cloudfunctions.functions');
    expect(RULES['gcp.cloud_function']!.entity).toBe('cloudfunctions.functions');
  });

  it('regionToken none 이면 템플릿과 optional 둘 다 region 이 없다 — gcp:project_global 규칙 전부 · 전역 NEG · D77 의 21(D119 의 Cloud Build 저장소 · D132 의 BigQuery 테이블 포함) · D79 의 3 포함', () => {
    const none = rulesFor('gcp').filter((r) => r.regionToken === 'none');
    expect(none).toHaveLength(67);
    for (const r of none) {
      expect(r.template, r.id).not.toContain('region');
      expect(r.optional, r.id).not.toContain('region');
    }
    const global = rulesFor('gcp').filter((r) => r.scope === 'gcp:project_global');
    expect(global).toHaveLength(34);
    for (const r of global) expect(r.template, r.id).not.toContain('region');
    expect(RULES['gcp.global_network_endpoint_group']!.template).toEqual(['system', 'purpose', 'env', 'slug', 'kind', 'tier', 'seq']);
  });

  it('종류 표가 있는 행의 규칙만 kinds 가 있고, 그 규칙만 템플릿의 slug 바로 뒤에 kind 가 있다 · optional 에는 없다 (D52)', () => {
    for (const r of rulesFor('gcp')) {
      const row = rowOf(r.id)!;
      expect(r.kinds !== undefined, r.id).toBe(row.kind !== null);
      if (r.kinds) {
        expect(r.kinds.allowed, r.id).toEqual(specOf(r.id).kinds!.allowed);
        expect(r.kinds.default, r.id).toBe(specOf(r.id).kinds!.default);
        expect(r.kinds.tokens, r.id).toEqual(row.kind!.tokens);
        expect(r.kinds.omitValues, r.id).toEqual(row.kind!.omitValues);
        expect(r.kinds.rule, r.id).toBe(row.kind!.rule);
      }
      const at = r.template.indexOf('kind');
      if (r.kinds) expect(at, r.id).toBe(r.template.indexOf('slug') + 1);
      else expect(at, r.id).toBe(-1);
      expect(r.optional, r.id).not.toContain('kind');
      // 덮기 전 템플릿에서 region(none 이면) · kind · tier 만 다르다
      // 프로젝트 ID 는 덮기 전부터 tier(접미사 · D85)를 갖는다
      expect(r.template.filter((t) => t !== 'kind' && t !== 'tier'), r.id).toEqual(GCP_BASE_RULES[r.id]!.template.filter((t) => (r.regionToken !== 'none' || t !== 'region') && t !== 'tier'));
    }
  });

  it('덮기 전 · 뒤 규칙 표의 차이는 slug · entity · template · optional · regionToken · kinds 뿐이다', () => {
    const allowed = new Set(['slug', 'entity', 'template', 'optional', 'regionToken', 'kinds']);
    expect(Object.keys(GCP_BASE_RULES)).toEqual(Object.keys(GCP_RULES));
    for (const id of Object.keys(GCP_RULES)) {
      const before = GCP_BASE_RULES[id]! as unknown as Record<string, unknown>;
      const after = GCP_RULES[id]! as unknown as Record<string, unknown>;
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) || String(before[k]) !== String(after[k]));
      expect(changed.filter((k) => !allowed.has(k)), id).toEqual([]);
    }
  });

  it('용도 토큰 tier — 세 CSP 의 count 규칙 전부 seq 바로 앞 · 종류 토큰이 있으면 그 뒤 (D60) · GCP 의 순번 없는 규칙은 종류(없으면 약어) 바로 뒤 · 역할 규칙 · AWS/Azure 의 나머지에는 없다 (D74) · 프로젝트 ID 는 끝에 접미사로 (D85)', () => {
    expect(RULES['gcp.project_id']!.template).toEqual(['owner', 'system', 'purpose', 'env', 'tier']);
    expect(RULES['gcp.project_id']!.optional).not.toContain('tier');
    expect(RULES['gcp.project_name']!.template).not.toContain('tier');
    for (const r of Object.values(RULES)) {
      if (r.id === 'gcp.project_id') continue;
      const seq = r.template.indexOf('seq');
      if (seq < 0) {
        const plain = r.provider === 'gcp' && !r.template.includes('role') && r.template.includes('slug');
        if (!plain) { expect(r.template, r.id).not.toContain('tier'); continue; }
        const after = r.template.includes('kind') ? 'kind' : 'slug';
        expect(r.template.indexOf('tier'), r.id).toBe(r.template.indexOf(after) + 1);
        expect(r.template.filter((t) => t === 'tier').length, r.id).toBe(1);
        expect(r.optional, r.id).not.toContain('tier');
        continue;
      }
      expect(r.template.indexOf('tier'), r.id).toBe(seq - 1);
      expect(r.template.filter((t) => t === 'tier').length, r.id).toBe(1);
      if (r.template.includes('kind')) expect(r.template.indexOf('kind'), r.id).toBe(seq - 2);
      expect(r.optional, r.id).not.toContain('tier');
    }
    expect(RULES['gcp.compute_instance']!.template).toEqual(['system', 'purpose', 'env', 'region', 'slug', 'tier', 'seq']);
    expect(RULES['aws.ec2_instance']!.template).toEqual(['system', 'purpose', 'env', 'region', 'slug', 'tier', 'seq']);
    expect(RULES['azure.virtual_machine']!.template).toEqual(['system', 'purpose', 'env', 'region', 'slug', 'tier', 'seq']);
    expect(RULES['gcp.storage_bucket']!.template).toEqual(['owner', 'system', 'purpose', 'env', 'region', 'slug', 'tier']);
    expect(RULES['gcp.bigquery_dataset']!.template).toEqual(['system', 'purpose', 'env', 'region', 'slug', 'tier']);
    expect(RULES['gcp.spanner_instance_config']!.template).toEqual(['slug', 'tier', 'system', 'purpose', 'env']);
    expect(RULES['gcp.iam_custom_role']!.template).toEqual(['slug', 'tier', 'system', 'purpose', 'env']);
    expect(RULES['gcp.project_name']!.template).not.toContain('tier');
    expect(RULES['gcp.service_account']!.template).not.toContain('tier');
    expect(RULES['gcp.cloud_sql_user']!.template).not.toContain('tier');
  });

  it('AWS · Azure 규칙은 덮지 않는다', () => {
    for (const r of [...rulesFor('aws'), ...rulesFor('azure')]) {
      expect(r.regionToken, r.id).toBeUndefined();
      expect(r.kinds, r.id).toBeUndefined();
    }
  });
});

describe('Cloud Run 서비스 (D65)', () => {
  const r = RULES['gcp.run_service']!;
  it('docUrl 은 생성 API · 범위 근거는 배포 안내서 · 길이 1~49 · RFC 1035 꼴 pattern', () => {
    expect(r).toBeDefined();
    expect(r.docUrl).toBe('https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/create');
    expect(r.uniquenessDocUrl).toBe('https://docs.cloud.google.com/run/docs/deploying');
    expect([r.minLength, r.maxLength]).toEqual([1, 49]);
    expect(r.pattern.source).toBe('^[a-z]([a-z0-9-]*[a-z0-9])?$');
    expect(r.allowed).toBe('lower-digit-hyphen');
  });
  it('문자 집합은 보조 출처라 note.secondary_source 하나 — 좁힌 규칙(narrower)이 아니다', () => {
    expect(r.notes?.map((n) => n.code)).toEqual(['note.secondary_source']);
  });
  it('범위 · 부류 · 분류 · 약어 · 지역 토큰', () => {
    expect({ scope: r.scope, entity: r.entity, category: r.category, slug: r.slug, regionToken: r.regionToken })
      .toEqual({ scope: 'gcp:project_location', entity: 'run.services', category: 'compute', slug: 'run', regionToken: 'region' });
  });
});

describe('문서 문장이 아닌 근거 (D80)', () => {
  const withEvidence = Object.values(RULES).filter((r) => r.evidence !== undefined);
  it('evidence 가 있는 규칙은 Cloud Run job · Artifact Registry 저장소 · Cloud Build 연결 · 저장소(D118 · D119) — 안내서 docUrl · note.observed_server_rule 을 함께 싣는다', () => {
    expect(withEvidence.map((r) => r.id).sort()).toEqual(['gcp.artifact_registry_repository', 'gcp.cloudbuild_connection', 'gcp.cloudbuild_repository', 'gcp.run_job']);
    for (const r of withEvidence) {
      expect(r.docUrl, r.id).toMatch(/^https:\/\/docs\.cloud\.google\.com\//);
      expect(r.notes?.map((n) => n.code), r.id).toContain('note.observed_server_rule');
      expect(r.evidence!.some((e) => e.kind === 'api_error'), r.id).toBe(true);
    }
  });
  it('근거마다 종류 · 날짜 · 원문이 있고 api_error 의 요청 경로는 프로젝트 ID 를 <project> 로 가린다', () => {
    for (const r of withEvidence) {
      for (const e of r.evidence!) {
        expect(['sdk', 'api_error'], r.id).toContain(e.kind);
        expect(e.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.quote.length, r.id).toBeGreaterThan(10);
        if (e.kind === 'api_error') expect(e.source, r.id).toMatch(/^(?:POST|GET) https:\/\/[a-z]+\.googleapis\.com\/v\d\/projects\/<project>\/locations\//);
      }
    }
  });
  it('두 규칙은 RFC1035 꼴 1-63 · 위치마다 유일 · 지역 토큰이 있다', () => {
    for (const id of ['gcp.run_job', 'gcp.artifact_registry_repository']) {
      const r = RULES[id]!;
      expect({ min: r.minLength, max: r.maxLength, scope: r.scope, regionToken: r.regionToken }, id).toEqual({ min: 1, max: 63, scope: 'gcp:project_location', regionToken: 'region' });
    }
    expect(RULES['gcp.run_job']!.slug).toBe('crj');
    expect(RULES['gcp.artifact_registry_repository']!.slug).toBe('ar');
  });
});

describe('Cloud Build 2세대 연결 (D118)', () => {
  const r = RULES['gcp.cloudbuild_connection']!;
  const ok = (name: string) => r.pattern.test(name) && name.length >= r.minLength && name.length <= r.maxLength;
  it('REST 참조의 글자(영숫자와 -._~%!$&\'()*+,;=@) · 위치마다 유일 · 지역 토큰 · 약어', () => {
    expect({ scope: r.scope, entity: r.entity, category: r.category, regionToken: r.regionToken, slug: r.slug })
      .toEqual({ scope: 'gcp:project_location', entity: 'cloudbuild.connections', category: 'management', regionToken: 'region', slug: 'conn' });
    expect(r.docUrl).toBe('https://docs.cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections/create#body.QUERY_PARAMETERS.connection_id');
    for (const name of ['a', 'Abc', '1abc', '-a', 'a-', 'a_b', 'a.b', "a~%!$&'()*+,;=@b"]) expect(ok(name), name).toBe(true);
    for (const name of ['a:b', 'a b', 'a#b', 'a/b', '']) expect(ok(name), name).toBe(false);
  });
  it('길이 1-59 (D119 가 D118 의 158 을 고친다) — 저장소 만들기는 연결 + 저장소 + 지역이 141 자를 넘으면 거절한다. 가장 긴 지역 23 자를 빼면 118 자를 연결과 저장소가 반씩 나눈다', () => {
    expect([r.minLength, r.maxLength]).toEqual([1, 59]);
    expect(ok('a'.repeat(59))).toBe(true);
    expect(ok('a'.repeat(60))).toBe(false);
    expect(r.notes?.map((n) => n.code)).toEqual(expect.arrayContaining(['note.observed_server_rule', 'note.narrower_source_used']));
    expect(r.evidence?.map((e) => e.source.split(' ')[0])).toEqual(['POST', 'GET', 'POST']);
  });
  it('생성은 소문자 · 숫자 · 하이픈 — 넓은 글자는 검사만 받는다', () => {
    expect({ allowed: r.allowed, caseRule: r.caseRule, separator: r.separator }).toEqual({ allowed: 'lower-digit-hyphen', caseRule: 'lower', separator: '-' });
  });
});

describe('Cloud Build 2세대 저장소 (D119)', () => {
  const r = RULES['gcp.cloudbuild_repository']!;
  const conn = RULES['gcp.cloudbuild_connection']!;
  const ok = (name: string) => r.pattern.test(name) && name.length >= r.minLength && name.length <= r.maxLength;
  it('연결 안에서 유일 — 부모 범위 gcp:cloudbuild_connection · 지역 토큰 없음(D77 — 부모의 위치를 물려받는다) · 약어 repo', () => {
    expect({ scope: r.scope, entity: r.entity, category: r.category, regionToken: r.regionToken, slug: r.slug })
      .toEqual({ scope: 'gcp:cloudbuild_connection', entity: 'cloudbuild.connections.repositories', category: 'management', regionToken: 'none', slug: 'repo' });
    expect(r.docUrl).toBe('https://docs.cloud.google.com/build/docs/api/reference/rest/v2/projects.locations.connections.repositories/create#body.QUERY_PARAMETERS.repository_id');
    for (const name of ['a', 'Abc', '1abc', '-a', 'a-', 'a_b', 'a.b', "a~%!$&'()*+,;=@b"]) expect(ok(name), name).toBe(true);
    for (const name of ['a:b', 'a b', 'a#b', 'a/b', '']) expect(ok(name), name).toBe(false);
  });
  it('길이 1-59 — 가장 긴 연결과 가장 긴 지역에서도 만들기 한계 141 안이다', () => {
    expect([r.minLength, r.maxLength]).toEqual([1, 59]);
    expect(conn.maxLength + r.maxLength + 23).toBeLessThanOrEqual(141);
    expect(r.notes?.map((n) => n.code)).toEqual(expect.arrayContaining(['note.observed_server_rule', 'note.narrower_source_used']));
  });
});

describe('BigQuery 테이블 · 뷰 (D132)', () => {
  const r = RULES['gcp.bigquery_table']!;
  const ok = (name: string) => r.pattern.test(name) && name.length >= r.minLength && name.length <= r.maxLength;
  it('데이터세트 안에서 유일 — 부모 범위 gcp:bigquery_dataset · 지역 토큰 없음(D77) · 약어 tbl', () => {
    expect({ scope: r.scope, entity: r.entity, category: r.category, regionToken: r.regionToken, slug: r.slug })
      .toEqual({ scope: 'gcp:bigquery_dataset', entity: 'bigquery.tables', category: 'database', regionToken: 'none', slug: 'tbl' });
    expect(r.docUrl).toBe('https://docs.cloud.google.com/bigquery/docs/reference/rest/v2/TableReference#FIELDS.table_id');
    expect(r.uniquenessDocUrl).toBe('https://docs.cloud.google.com/bigquery/docs/tables#table_naming');
  });
  it('글자 — 원문 범주(L · M · N · Pc · Pd · Zs) 가운데 ASCII 만: 영숫자 · 밑줄 · 하이픈 · 공백. 그 밖은 받지 않는다(NARROWER)', () => {
    for (const name of ['a', 'A', '1abc', '_a', 'table 01', 'sample_table', 'my-table']) expect(ok(name), name).toBe(true);
    for (const name of ['étudiant-01', 'a.b', 'sample_table$20190123', 'a/b', 'a@b', '']) expect(ok(name), name).toBe(false);
    expect(r.notes?.map((n) => n.code)).toEqual(['note.narrower_source_used']);
  });
  it('길이 1-1024 — 안내서의 1,024 UTF-8 바이트와 같다(ASCII 는 한 글자가 한 바이트)', () => {
    expect([r.minLength, r.maxLength]).toEqual([1, 1024]);
    expect(ok('a'.repeat(1024))).toBe(true);
    expect(ok('a'.repeat(1025))).toBe(false);
  });
  it('생성은 데이터세트와 같이 밑줄로 잇는다', () => {
    expect({ allowed: r.allowed, separator: r.separator, caseRule: r.caseRule }).toEqual({ allowed: 'lower-digit-underscore', separator: '_', caseRule: 'any' });
    expect(r.template).not.toContain('region');
  });
});

describe('Cloud Logging 싱크 · 버킷 · 로그 기반 지표 (D133)', () => {
  const ok = (id: string, name: string) => { const r = RULES[id]!; return r.pattern.test(name) && name.length >= r.minLength && name.length <= r.maxLength; };
  it('범위 · 지역 토큰 · 약어 — 싱크와 지표는 프로젝트에 하나(위치 없음), 버킷은 위치 아래', () => {
    const pick = (id: string) => { const r = RULES[id]!; return { scope: r.scope, entity: r.entity, regionToken: r.regionToken, slug: r.slug, min: r.minLength, max: r.maxLength }; };
    expect(pick('gcp.logging_sink')).toEqual({ scope: 'gcp:project', entity: 'logging.sinks', regionToken: 'none', slug: 'sink', min: 1, max: 100 });
    expect(pick('gcp.logging_bucket')).toEqual({ scope: 'gcp:project_location', entity: 'logging.buckets', regionToken: 'region', slug: 'log', min: 1, max: 100 });
    expect(pick('gcp.logging_metric')).toEqual({ scope: 'gcp:project', entity: 'logging.metrics', regionToken: 'none', slug: 'lbm', min: 1, max: 100 });
    expect(RULES['gcp.logging_bucket']!.notes?.map((n) => n.code)).toEqual(['note.scope_unconfirmed']);
    for (const id of ['gcp.logging_sink', 'gcp.logging_bucket', 'gcp.logging_metric']) expect(RULES[id]!.docUrl, id).toMatch(/^https:\/\/docs\.cloud\.google\.com\/logging\/docs\/reference\/v2\/rest\/v2\//);
  });
  it('싱크 · 버킷 — 영숫자로 시작 · 영숫자 · 밑줄 · 하이픈 · 마침표 · 100자', () => {
    for (const id of ['gcp.logging_sink', 'gcp.logging_bucket']) {
      for (const name of ['a', 'A1', 'my-syslog-errors-to-pubsub', 'a_b.c-', 'a'.repeat(100)]) expect(ok(id, name), `${id} ${name}`).toBe(true);
      for (const name of ['_Default', '-a', '.a', 'a b', 'a/b', 'a'.repeat(101), '']) expect(ok(id, name), `${id} ${name}`).toBe(false);
    }
  });
  it('지표 — 영숫자와 _-.,+!*\',()%/ · 슬래시로 시작하지 않는다 · 100자', () => {
    for (const name of ['error_count', 'nginx/requests', "a-b.c,d+e!f*g'h(i)j%k", '_a', 'a'.repeat(100)]) expect(ok('gcp.logging_metric', name), name).toBe(true);
    for (const name of ['/a', 'a b', 'a:b', 'a@b', 'a'.repeat(101), '']) expect(ok('gcp.logging_metric', name), name).toBe(false);
  });
});

describe('Workflows (D134)', () => {
  const r = RULES['gcp.workflow']!;
  const ok = (name: string) => r.pattern.test(name) && name.length >= r.minLength && name.length <= r.maxLength;
  it('위치마다 유일 · 지역 토큰 · 약어 wf · 길이 1-64', () => {
    expect({ scope: r.scope, entity: r.entity, regionToken: r.regionToken, slug: r.slug, min: r.minLength, max: r.maxLength })
      .toEqual({ scope: 'gcp:project_location', entity: 'workflows.workflows', regionToken: 'region', slug: 'wf', min: 1, max: 64 });
    expect(r.docUrl).toBe('https://docs.cloud.google.com/workflows/docs/reference/rest/v1/projects.locations.workflows/create#body.QUERY_PARAMETERS.workflow_id');
  });
  it('글자로 시작 · 영숫자로 끝 · 그 사이 영숫자 · 밑줄 · 하이픈', () => {
    for (const name of ['a', 'A', 'a1', 'my_workflow', 'my-workflow', `a${'b'.repeat(63)}`]) expect(ok(name), name).toBe(true);
    for (const name of ['1a', '_a', '-a', 'a-', 'a_', 'a.b', 'a b', `a${'b'.repeat(64)}`, '']) expect(ok(name), name).toBe(false);
  });
});
