// 부모 ↔ 딸린 리소스 호환표 · 딸린 것 입력 검사 (D62)
import { describe, it, expect } from 'vitest';
import { ATTACHMENTS, ATTACH_KINDS, MAX_DATA_DISKS, attachmentRow, checkAttachments, type AttachmentIssue } from './attachments';
import { RULES, getRule } from '../constraints';
import { inputKind } from '../tree';
import { REGIONS } from '../regions-data';
import { ENV_VALUES } from '../normalize';
import { GCP_CATALOG } from '../rules/gcp-catalog';
import { SEQ_PATTERN, type SelectionItem } from '../selection';

const vm = getRule('gcp', 'compute_instance')!;
const sql = getRule('gcp', 'cloud_sql_instance')!;
const item = (instances: unknown[], rule = vm): SelectionItem => ({ rule, count: 1, instances: instances as SelectionItem['instances'] });

/** §5-5 의 위치 꼴 — 프로젝트 · 서비스 pick 이 같은 꼬리를 쓴다 */
const TAIL = String.raw`(\.instances\[\d+\](\.attach(\.(boot|ip|ipi|data(\[\d+\])?))?)?)?`;
const PATH = new RegExp(String.raw`^(services\[\d+\](\.picks\[\d+\]${TAIL})?|projectPicks(\[\d+\]${TAIL})?)$`);

describe('호환표 (D62 · §4-5)', () => {
  it('행은 CSP 마다 넷 — VM 의 boot · data(순번) · ip · ipi (AWS 는 EBS · EIP · ENI)', () => {
    expect(ATTACHMENTS.map((r) => [r.parent, r.attach, r.child, r.seq])).toEqual([
      ['gcp.compute_instance', 'boot', 'gcp.disk', false],
      ['gcp.compute_instance', 'data', 'gcp.disk', true],
      ['gcp.compute_instance', 'ip', 'gcp.address', false],
      ['gcp.compute_instance', 'ipi', 'gcp.address', false],
      ['aws.ec2_instance', 'boot', 'aws.ebs_volume', false],
      ['aws.ec2_instance', 'data', 'aws.ebs_volume', true],
      ['aws.ec2_instance', 'ip', 'aws.ec2_eip', false],
      ['aws.ec2_instance', 'ipi', 'aws.ec2_network_interface', false],
    ]);
    expect(ATTACH_KINDS).toEqual(['boot', 'data', 'ip', 'ipi']);
    expect(MAX_DATA_DISKS).toBe(9);
  });
  it('⑴ 부모 · 자식 규칙 id 가 규칙 표에 있다 ⑵ 부모는 count 규칙이다', () => {
    for (const r of ATTACHMENTS) {
      expect(RULES[r.parent], r.parent).toBeDefined();
      expect(RULES[r.child], r.child).toBeDefined();
      expect(inputKind(RULES[r.parent]!), r.parent).toBe('count');
    }
  });
  it('⑶ 접미 ↔ 지역 코드 · 환경 값 겹침 0 · 약어와는 ip 하나만(주소 약어 — 자리로 구분) · 종류 토큰과 0', () => {
    const regions = new Set(REGIONS.gcp.flatMap((r) => [r.code, ...r.zones.map((z) => z.code)]));
    const slugs = new Set(GCP_CATALOG.map((r) => r.slug.value));
    const kinds = new Set(GCP_CATALOG.flatMap((r) => Object.values(r.kind?.tokens ?? {})));
    const envs: readonly string[] = [...ENV_VALUES, 'prd'];
    expect(ATTACH_KINDS.filter((a) => regions.has(a) || envs.includes(a))).toEqual([]);
    expect(ATTACH_KINDS.filter((a) => slugs.has(a))).toEqual(['ip']);
    expect(ATTACH_KINDS.filter((a) => kinds.has(a))).toEqual([]);
  });
  it('attachmentRow — 표에 있는 짝만', () => {
    expect(attachmentRow('gcp.compute_instance', 'data')?.child).toBe('gcp.disk');
    expect(attachmentRow('gcp.cloud_sql_instance', 'boot')).toBeUndefined();
  });
  it('SEQ_PATTERN — 01~99 만 · 00 · 7 · 100 · ab 거부', () => {
    for (const s of ['01', '09', '10', '99']) expect(SEQ_PATTERN.test(s), s).toBe(true);
    for (const s of ['00', '7', '100', 'ab', '']) expect(SEQ_PATTERN.test(s), s).toBe(false);
  });
});

describe('checkAttachments (D62 · §4-5 ⑷)', () => {
  it('딸린 것이 없거나 올바르면 빈 배열 · 슬롯이 없는 항목도', () => {
    expect(checkAttachments({ rule: vm, count: 2 })).toEqual([]);
    expect(checkAttachments(item([{ seq: '01' }, { seq: '03', attach: {} }]))).toEqual([]);
    expect(checkAttachments(item([{ seq: '01', attach: { boot: true, data: ['01', '02'], ip: true, ipi: true } }]))).toEqual([]);
    // 하나를 지운 뒤 — 남은 순번은 그대로다
    expect(checkAttachments(item([{ seq: '01', attach: { data: ['02'] } }]))).toEqual([]);
    expect(checkAttachments(item([{ seq: '01', attach: { data: Array.from({ length: 9 }, (_, i) => `0${i + 1}`) } }]))).toEqual([]);
  });
  it('attach 가 객체가 아니면 attach_not_object — 배열 · null · 문자열', () => {
    const out = checkAttachments(item([{ seq: '01', attach: ['boot'] }, { seq: '02', attach: null }, { seq: '03', attach: 'boot' }]), 4);
    expect(out).toEqual([
      { tail: '.instances[0].attach', message: { code: 'wizard.attach_not_object', params: { index: 4 } } },
      { tail: '.instances[1].attach', message: { code: 'wizard.attach_not_object', params: { index: 4 } } },
      { tail: '.instances[2].attach', message: { code: 'wizard.attach_not_object', params: { index: 4 } } },
    ]);
  });
  it('호환표에 없는 부모 — children_not_supported 한 번(슬롯이 여럿이어도) · 위치는 pick', () => {
    const out = checkAttachments(item([{ seq: '01', attach: { boot: true } }, { seq: '02', attach: { data: ['01'] } }], sql), 3);
    expect(out).toEqual([{ tail: '', message: { code: 'wizard.children_not_supported', params: { index: 3, type: 'cloud_sql_instance' } } }]);
  });
  it('호환표에 없는 부모 — 빈 객체 attach 도 children_not_supported (attach 가 오는 것 자체가 잘못)', () => {
    expect(checkAttachments(item([{ seq: '01', attach: {} }], sql), 1)).toEqual([
      { tail: '', message: { code: 'wizard.children_not_supported', params: { index: 1, type: 'cloud_sql_instance' } } },
    ]);
  });
  it('data 범위 — 비었다 · 10개 · 배열 아님 → attach_out_of_range { max: 9 } · 위치는 attach.data', () => {
    const ten = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
    const out = checkAttachments(item([{ seq: '01', attach: { data: [] } }, { seq: '02', attach: { data: ten } }, { seq: '03', attach: { data: '01' } }]));
    expect(out).toEqual([0, 1, 2].map((i) => ({ tail: `.instances[${i}].attach.data`, message: { code: 'wizard.attach_out_of_range', params: { index: 0, max: 9 } } })));
  });
  it('data 순번 꼴 — SEQ_PATTERN 아니면 invalid_data_seq · 위치는 그 디스크 하나', () => {
    const out = checkAttachments(item([{ seq: '01', attach: { data: ['01', '00', '7', '100', 'ab', 3] } }]), 1);
    expect(out).toEqual(['00', '7', '100', 'ab', '3'].map((value, k) => ({
      tail: `.instances[0].attach.data[${k + 1}]`,
      message: { code: 'wizard.invalid_data_seq', params: { index: 1, value, pattern: SEQ_PATTERN.source } },
    })));
  });
  it('data 순번 중복 — duplicate_seq 값 data/NN · 두 번째 자리', () => {
    const out = checkAttachments(item([{ seq: '01', attach: { data: ['01', '03', '01'] } }]), 2);
    expect(out).toEqual([{ tail: '.instances[0].attach.data[2]', message: { code: 'wizard.duplicate_seq', params: { index: 2, value: 'data/01' } } }]);
  });
  it('모든 위치 꼬리가 §5-5 의 path 꼴을 지난다(서비스 · 프로젝트 둘 다) — 검사식 자체도 시험한다', () => {
    expect(PATH.test('services[0].picks[0].instances[1].attach.data[0]')).toBe(true);
    expect(PATH.test('services[0].picks[0].instances[1].attach.disk')).toBe(false);
    expect(PATH.test('services[0].picks[0].attach')).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(2, '0'));
    const issues: AttachmentIssue[] = [
      ...checkAttachments(item([{ seq: '01', attach: ['x'] }, { seq: '02', attach: { data: [] } }, { seq: '03', attach: { data: ten } },
                                { seq: '04', attach: { data: ['01', '00', '01'] } }])),
      ...checkAttachments(item([{ seq: '01', attach: { boot: true } }], sql)),
    ];
    expect(new Set(issues.map((i) => i.message.code))).toEqual(new Set([
      'wizard.attach_not_object', 'wizard.attach_out_of_range', 'wizard.invalid_data_seq', 'wizard.duplicate_seq', 'wizard.children_not_supported',
    ]));
    for (const { tail } of issues) {
      expect(PATH.test(`services[0].picks[0]${tail}`), tail).toBe(true);
      expect(PATH.test(`projectPicks[0]${tail}`), tail).toBe(true);
    }
  });
});
