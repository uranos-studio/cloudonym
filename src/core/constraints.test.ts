import { describe, it, expect } from 'vitest';
import { AZURE_INTAKE_ROWS } from './rules/azure-intake';
import { GCP_INTAKE_ROWS } from './rules/gcp-intake';
import { AWS_INTAKE_ROWS } from './rules/aws-intake';
import { AWS_NAME_TAG_GENERAL } from './rules/aws';
import { RULES, rulesFor, getRule, LABEL_LIMITS, AWS_TAG_VALUE_DOC_URL, WINDOWS_COMPUTER_NAME_DOC_URL, AZURE_RESERVED_DOC_URL, AWS_NAME_TAG } from './constraints';
import { PROVIDERS } from './types';

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

describe('공식 문서 대조로 고친 값 (Task 1-2)', () => {
  it('S3 금지 접미사에 -an 이 있다 (계정 지역 네임스페이스 전용)', () => {
    expect(RULES['aws.s3_bucket'].forbidden?.suffixes).toContain('-an');
  });
  it('AKS Linux 노드풀 예약 이름 aksmanagedap 을 막는다', () => {
    expect(RULES['azure.aks_nodepool_linux'].forbidden?.exact).toContain('aksmanagedap');
  });
  it('codex P1: Windows VM 의 숫자만 금지는 Windows ComputerName 문서가 근거이고 notes 에 그 URL 이 실린다', () => {
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
      expect(has, r.id).toBe(on.includes(r.resourceType) || intakeReserved);
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
  it("uniqueness 'none' 인 규칙은 전부 AWS Name 태그다 — 그 역도 같다", () => {
    for (const r of Object.values(RULES)) expect(r.uniqueness === 'none', r.id).toBe(r.pattern === AWS_NAME_TAG || r.pattern === AWS_NAME_TAG_GENERAL);
    const tagIntake = AWS_INTAKE_ROWS.filter((x) => x.kind === 'b').map((x) => x.id);
    expect(Object.values(RULES).filter((r) => r.uniqueness === 'none').map((r) => r.id).sort()).toEqual(['aws.ebs_volume', 'aws.ec2_instance', 'aws.internet_gateway', 'aws.route_table', 'aws.subnet', 'aws.vpc', ...tagIntake].sort());
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

describe('조사 11종 (Task 5) — 범위 · 부류 · 분류 · 근거', () => {
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
  it('규칙 수 — AWS 손 11 + 들인 행 · GCP 손 9 + 들인 행 · Azure 손 15 + 들인 행', () => {
    expect([rulesFor('aws').length, rulesFor('gcp').length, rulesFor('azure').length]).toEqual([11 + AWS_INTAKE_ROWS.length, 9 + GCP_INTAKE_ROWS.length, 15 + AZURE_INTAKE_ROWS.length]);
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
