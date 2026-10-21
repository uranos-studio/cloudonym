// AWS 를 켠 상태로 같은 시험을 돈다 (0.2 준비) — src/api/aws-enabled.test.ts 의 화면 쪽 짝
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
