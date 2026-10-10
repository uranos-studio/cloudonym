// 부모 ↔ 딸린 리소스 호환표 (D62) — 데이터. 자식 이름은 부모의 최종 이름에 접미를 더한 것이다(엔진 attachName).
// 붙을 수 있는 부모는 이 표의 규칙뿐이다 — 새 짝은 같은 꼴의 행을 더한다
import type { CoreMessage } from '../messages';
import { SEQ_PATTERN, type SelectionItem } from '../selection';

/** 딸린 것의 종류 — 이름의 접미 글자와 같다 */
export type AttachKind = 'boot' | 'data' | 'ip' | 'ipi';
export const ATTACH_KINDS: readonly AttachKind[] = ['boot', 'data', 'ip', 'ipi'];
/** 한 슬롯의 데이터 디스크 수 상한 */
export const MAX_DATA_DISKS = 9;

/** 한 행 — 부모 규칙 id · 접미 · 자식 규칙 id · 순번 여부(data 만 · 값은 슬롯이 든다) */
export interface AttachmentRow { parent: string; attach: AttachKind; child: string; seq: boolean }

/** boot 는 켠 슬롯에만(GCE 기본은 부트 디스크 이름 = VM 이름) · ip 는 예약 고정 외부 주소 · ipi 는 예약 고정 내부 주소.
 *  임시 주소는 이름 있는 리소스가 아니라 표에 없다. 자식에는 지역 자리가 따로 없다 — 부모 이름에 든 리전을 잇는다 */
export const ATTACHMENTS: readonly AttachmentRow[] = [
  { parent: 'gcp.compute_instance', attach: 'boot', child: 'gcp.disk', seq: false },
  { parent: 'gcp.compute_instance', attach: 'data', child: 'gcp.disk', seq: true },
  { parent: 'gcp.compute_instance', attach: 'ip', child: 'gcp.address', seq: false },
  { parent: 'gcp.compute_instance', attach: 'ipi', child: 'gcp.address', seq: false },
];

export function attachmentRow(parentRuleId: string, attach: AttachKind): AttachmentRow | undefined {
  return ATTACHMENTS.find((r) => r.parent === parentRuleId && r.attach === attach);
}

/** 검사 결과 하나 — tail 은 pick 위치 뒤에 붙는 꼬리(`.instances[1].attach.data[0]` · pick 자체면 '') */
export interface AttachmentIssue { tail: string; message: CoreMessage }

const shown = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return String(v);
  } catch {
    return typeof v;
  }
};

/** 한 항목(pick)의 딸린 것 검사 (§4-5 ⑷) — 마법사 모델 검사(validatePlan)가 pick 마다 부른다. index 는 그 pick 의 자리.
 *  attach 는 객체 · 호환표에 있는 부모에만(없으면 pick 에 한 번) · data 는 순번 배열 1~MAX_DATA_DISKS개 · 각 순번 SEQ_PATTERN · 고유.
 *  입력은 검사 전 값이라 타입을 믿지 않는다 */
export function checkAttachments(item: SelectionItem, index = 0): AttachmentIssue[] {
  const out: AttachmentIssue[] = [];
  const instances: readonly unknown[] = Array.isArray(item.instances) ? item.instances : [];
  let unsupported = false;
  instances.forEach((slot, i) => {
    if (slot === null || typeof slot !== 'object' || !('attach' in slot)) return;
    const attach: unknown = (slot as { attach: unknown }).attach;
    if (attach === undefined) return;
    const at = `.instances[${i}].attach`;
    if (attach === null || typeof attach !== 'object' || Array.isArray(attach)) {
      out.push({ tail: at, message: { code: 'wizard.attach_not_object', params: { index } } });
      return;
    }
    const given = ATTACH_KINDS.filter((k) => (attach as Record<string, unknown>)[k] !== undefined);
    if (given.some((k) => !attachmentRow(item.rule.id, k))) {
      if (!unsupported) out.push({ tail: '', message: { code: 'wizard.children_not_supported', params: { index, type: item.rule.resourceType } } });
      unsupported = true;
      return;
    }
    const data: unknown = (attach as Record<string, unknown>).data;
    if (data === undefined) return;
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_DATA_DISKS) {
      out.push({ tail: `${at}.data`, message: { code: 'wizard.attach_out_of_range', params: { index, max: MAX_DATA_DISKS } } });
      return;
    }
    const seen = new Set<string>();
    data.forEach((seq: unknown, j) => {
      if (typeof seq !== 'string' || !SEQ_PATTERN.test(seq)) {
        out.push({ tail: `${at}.data[${j}]`, message: { code: 'wizard.invalid_data_seq', params: { index, value: shown(seq), pattern: SEQ_PATTERN.source } } });
      } else if (seen.has(seq)) {
        out.push({ tail: `${at}.data[${j}]`, message: { code: 'wizard.duplicate_seq', params: { index, value: `data/${seq}` } } });
      } else {
        seen.add(seq);
      }
    });
  });
  return out;
}
