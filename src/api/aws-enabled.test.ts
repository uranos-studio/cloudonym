// AWS 를 켠 상태로 같은 시험을 돈다 (0.2 준비) — 켜진 CSP 목록만 바꿔 끼우고 시험 파일을 그대로 불러온다.
// 실제 설정(ENABLED_PROVIDERS = ['gcp'])의 시험은 각 파일이 그대로 돈다. 순서는 PROVIDERS 순서(types.test)를 따른다
import { vi } from 'vitest';

vi.mock('../core/types', async (orig) => ({ ...(await orig<typeof import('../core/types')>()), ENABLED_PROVIDERS: ['aws', 'gcp'] }));

await import('./amplification.test');
await import('./amplification-errors.test');
