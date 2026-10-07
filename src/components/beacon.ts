// 화면 비콘 (D17 · D56) — ui_visit 은 탭당 1회(sessionStorage 가드) · ui_generate 는 1초 디바운스 · ui_copy 는 복사가 된 버튼 하나.
// 문맥값은 보내지 않는다. 실패는 삼킨다 — 계측이 화면을 막지 않는다
import { COPY_TARGETS, type CopyTarget } from './copyTargets';

export type UiBeacon = 'ui_visit' | 'ui_generate' | 'ui_copy';
export interface BeaconMeta { target?: CopyTarget }
export const EVENTS_PATH = '/v1/events';
export const VISIT_KEY = 'cloudonym:ui_visit';
export const GENERATE_DEBOUNCE_MS = 1000;

export type Sender = (event: UiBeacon) => void;
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** navigator.sendBeacon — 없으면 fetch keepalive. 본문은 문자열이라 text/plain 으로 간다 (API 는 content-type 을 보지 않는다 · events.test) */
export function sendBeacon(event: UiBeacon, meta: BeaconMeta = {}): void {
  const body = JSON.stringify({ event, ...meta });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(EVENTS_PATH, body);
      return;
    }
    void fetch(EVENTS_PATH, { method: 'POST', body, keepalive: true }).catch(() => undefined);
  } catch {
    // 계측 실패는 무시한다
  }
}

/** 복사 버튼의 copyKey → target. 이름 카드의 「name:<항목 키>」 는 name 하나로 — 어느 리소스인지는 싣지 않는다. 모르는 키는 undefined(보내지 않는다) */
export function copyTarget(copyKey: string | undefined): CopyTarget | undefined {
  if (copyKey === undefined) return undefined;
  if (copyKey.startsWith('name:')) return 'name';
  return (COPY_TARGETS as readonly string[]).includes(copyKey) && copyKey !== 'name' ? (copyKey as CopyTarget) : undefined;
}

/** sessionStorage 접근은 막힌 환경(사생활 보호 · 쿠키 차단)에서 던진다 — 없으면 undefined */
export function sessionStore(): StorageLike | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/** 같은 탭에서 한 번만 보낸다. 저장소가 없거나 던지면 가드 없이 보낸다(한 번 더 세는 쪽이 안 세는 쪽보다 낫다). 보냈으면 true */
export function visitOnce(storage: StorageLike | undefined, send: Sender = sendBeacon): boolean {
  try {
    if (storage?.getItem(VISIT_KEY)) return false;
    storage?.setItem(VISIT_KEY, '1');
  } catch {
    // 저장소가 막혀 있으면 가드 없이 보낸다
  }
  send('ui_visit');
  return true;
}

/** 마지막 호출 뒤 ms 가 지나면 fn 을 한 번 실행한다 */
export function debounce(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (id !== undefined) clearTimeout(id);
    id = setTimeout(() => { id = undefined; fn(); }, ms);
  };
}
