// CSP 표시 이름 — 사전(en)의 문구. CloudPicker 의 툴팁 · ResourceTree 제목이 같이 쓴다
import type { Provider } from '../core/types';
import { en } from '../messages/en';

const LONG: Record<Provider, string> = { aws: en.ui.provider_name_aws, gcp: en.ui.provider_name_gcp, azure: en.ui.provider_name_azure };

export const providerName = (p: Provider): string => LONG[p];

/** 짧은 이름 — CloudPicker 버튼 글자 · 꺼진 CSP 링크 안내 */
const SHORT: Record<Provider, string> = { aws: 'AWS', gcp: 'GCP', azure: 'Azure' };
export const providerShort = (p: Provider): string => SHORT[p];
