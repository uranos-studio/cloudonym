// AWS 를 켠 상태로 같은 시험을 돈다 — 0.2 준비 때 켜진 CSP 목록만 바꿔 끼우고 시험 파일을 그대로 불러오던 묶음이다.
// 0.2.0 에서 실제 설정이 ENABLED_PROVIDERS = ['aws', 'gcp'] 가 되어 아래 mock 은 실제 값과 같다 — 지금은 각 파일을 한 번 더 도는 중복이다.
// 지울지 · Azure 를 켜는 준비 묶음(['aws', 'gcp', 'azure'])으로 바꿀지는 정하지 않았다. 순서는 PROVIDERS 순서(types.test)를 따른다.
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
await import('./schemas.test');
