// AWS 를 켠 상태로 같은 시험을 돈다 — src/api/aws-enabled.test.ts 의 화면 쪽 짝.
// 0.2.0 에서 실제 ENABLED_PROVIDERS 가 ['aws', 'gcp'] 가 되어 mock 은 실제 값과 같다 — 지금은 각 파일을 한 번 더 도는 중복이다
import { vi } from 'vitest';

vi.mock('../core/types', async (orig) => ({ ...(await orig<typeof import('../core/types')>()), ENABLED_PROVIDERS: ['aws', 'gcp'] }));

await import('./urlState.test');
await import('./cloudSwitch.test');
await import('./linkRevision.test');
await import('./roundtrip.test');
await import('./wizardState.test');
await import('./wizardBundles.test');
await import('./wizardCustom.test');
await import('./wizardProjectGate.test');
await import('./wizardSelection.test');
await import('./namingDoc.test');
