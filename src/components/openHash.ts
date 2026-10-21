// 주소창의 hash → 화면 상태 (D27 ⑵ · D42 · D50) — 첫 로드 · 새로고침 · 같은 탭 hash 이동이 모두 이것을 지난다.
// 폼은 formOf 로 만든다: 지역 칸이 존 코드를 들고 있어 다시 파싱해도 존이 남는다. 정규화된 문맥은 따로 돌려준다(비콘 key 용)
import { buildTree } from '../core/tree';
import type { NamingContext, Provider, ResourceRule } from '../core/types';
import type { SelectionItem } from '../core/selection';
import { decodeState, encodeState } from './urlState';
import { fromItems, toItems, type Picked } from './selection';
import { linkStateOf, type LinkState } from './linkRevision';
import { formOf, type FormContext } from './formContext';
import { VERSION } from '../version';

const NO_PICK: Picked = new Map();

export interface Opened {
  form: FormContext;
  /** 폼을 파싱한 것과 같은 문맥 — App 이 hashchange 때 ui_generate 를 세지 않으려고 이것의 key 를 먼저 맞춘다 */
  context: NamingContext;
  provider?: Provider;
  picked: Picked;
  /** picked 를 트리 순서로 펼친 선택 — key 를 만든 그 순서 */
  selection: SelectionItem[];
  dropped: number;
  unavailable?: Provider;
  link: LinkState;
}

/** hash 가 온전하면 그 상태 — 폼과 대어 볼 key 는 지금 규칙 버전 · 트리 순서로 만든다.
 *  hash 의 r 순서가 트리 순서와 달라도 같은 선택이면 같은 key 다 — 링크를 연 직후 hash 를 덮어쓰지 않는다.
 *  enabled — 켜진 CSP (생략하면 ENABLED_PROVIDERS · decodeState 와 같다) */
export function openHash(hash: string, rules: readonly ResourceRule[] | undefined, enabled?: readonly Provider[]): Opened | undefined {
  const d = decodeState(hash, rules, enabled);
  if (!d) return undefined;
  const picked = d.selection ? fromItems(d.selection) : NO_PICK;
  const selection = d.provider ? toItems(buildTree(d.provider, rules?.filter((r) => r.provider === d.provider)), picked) : [];
  const key = encodeState(d.context, VERSION.rules, { provider: d.provider, selection });
  return {
    form: formOf(d.context), context: d.context, provider: d.provider, picked, selection,
    dropped: d.dropped ?? 0, unavailable: d.unavailable, link: linkStateOf(d, hash, key),
  };
}
