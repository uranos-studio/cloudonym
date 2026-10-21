// AWS 를 켠 상태로 같은 시험을 돈다 (0.2 준비) — 켜진 CSP 목록만 바꿔 끼우고 시험 파일을 그대로 불러온다.
// 실제 설정(ENABLED_PROVIDERS = ['gcp'])의 시험은 각 파일이 그대로 돈다. 순서는 PROVIDERS 순서(types.test)를 따른다.
// 여기 넣는 파일은 두 설정 모두에서 통과해야 한다 — 켜는 날 기대값이 바뀌는 시험(types · llms · readme · openapi · revision)은 넣지 않는다.
// schemas · routes 는 넣지 않는다 — 「providers 생략」(GCP 지역 문맥이 aws 에서 400) · /catalog.json(AWS catalog 없음) 시험이 켜는 날 결정을 기다린다.
// 화면 쪽은 src/components/aws-enabled.test.ts 다(tsconfig 가 갈린다)
import { vi } from 'vitest';

vi.mock('../core/types', async (orig) => ({ ...(await orig<typeof import('../core/types')>()), ENABLED_PROVIDERS: ['aws', 'gcp'] }));

await import('./amplification.test');
await import('./amplification-errors.test');
await import('./validate.test');
await import('./events.test');
await import('./limits.test');
await import('./security.test');
await import('./user-data.test');
