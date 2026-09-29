// 엔진 공개 타입 — 이후 모듈(normalize · compose · truncate · validate · engine · labels)이 이 이름을 쓴다

export type Provider = 'aws' | 'gcp' | 'azure';
export const PROVIDERS: readonly Provider[] = ['aws', 'gcp', 'azure'];
export type Env = 'prd' | 'stg' | 'dev' | 'sbx';
export type Region = 'kr' | 'us' | 'jp' | 'eu' | 'global';

export interface NamingContext {
  owner: string; system: string; purpose: string; env: Env; region: Region;
}
/** 사용자가 보낸 그대로 — env/region 은 별칭일 수 있다 */
export interface RawContext {
  owner?: unknown; system?: unknown; purpose?: unknown; env?: unknown; region?: unknown;
}

export type Token = 'owner' | 'system' | 'purpose' | 'env' | 'region' | 'slug' | 'seq' | 'role';
/** 축소에서 손대지 않는 토큰 (D13) */
export const PROTECTED: readonly Token[] = ['slug', 'seq', 'role', 'env'];
/** 축소 뒤 가변 토큰의 최소 길이 (D13) */
export const MIN_TOKEN = 2;

/** 생성에 쓰는 문자 집합 (house style · D14) */
export type Allowed = 'lower-digit' | 'lower-digit-hyphen' | 'alnum-hyphen' | 'alnum-hyphen-underscore' | 'alnum-hyphen-underscore-period-paren';

export interface Forbidden {
  prefixes?: string[];      // 이 문자열로 시작하면 안 된다
  suffixes?: string[];
  contains?: string[];      // 어디에든 있으면 안 된다
  exact?: string[];         // 이 이름 자체가 금지
  words?: string[];         // 단어로 쓰면 안 된다 — 이름 안에서 앞뒤가 영문 글자가 아닌 자리(이름 끝 포함)에 있으면 위반
  ignoreCase?: boolean;     // 위 목록 전부를 대소문자 없이 본다 (목록은 소문자로 적는다)
  ipv4?: boolean;           // 192.168.0.1 꼴 금지 (S3 · GCS)
}

export interface ResourceRule {
  id: string;                 // 'gcp.service_account'
  provider: Provider;
  resourceType: string;       // 'service_account'
  displayName: string;        // 'Service Account'
  slug: string;               // 'sa' · 'st' · 'vm' … 이름에 들어가는 표준 약어 ('' 이면 slug 토큰이 없다)
  minLength: number;
  maxLength: number;
  pattern: RegExp;            // CSP 물리 규칙 — 최종 이름 전체가 만족해야 한다
  forbidden?: Forbidden;      // CSP 예약어 · 금지 접두사 (문서에 명시된 것만 · D19)
  noConsecutiveSeparator?: boolean; // CSP 가 '--' 를 금지하는 규칙에만 true
  allowed: Allowed;           // 생성 정제용
  separator: '' | '-';
  caseRule: 'lower' | 'any';
  startsWithLetter: boolean;
  endsWithAlnum: boolean;
  template: Token[];          // 조립 순서 — 예: ['system','purpose','env','slug','role']
  optional: Token[];          // 축소 1단계에서 적힌 순서대로 떼는 토큰. template 에 있는 것만
  scope: 'global' | 'account' | 'region' | 'project' | 'zone' | 'subscription' | 'resource_group' | 'virtual_network' | 'managed_cluster';
  docUrl: string;             // 공식 문서 URL — 숫자의 근거
  note?: string;              // 보수적 한도 등 설명 (D20)
}

export interface NameResult {
  ruleId: string;
  resourceType: string;
  displayName: string;
  name: string;               // valid:false 여도 마지막 시도 이름(빈 필수 토큰이면 '')
  valid: boolean;
  isTruncated: boolean;       // 축소 1·2단계를 거쳤다
  isTransformed: boolean;     // 정제에서 문자가 바뀌었거나 구분자가 빠졌다 (D15)
  original: string;           // 정제 전 · 축소 전 조립 이름
  violations: string[];       // valid:false 일 때 이유(한국어)
  steps: string[];            // 축소 · 변환 기록 ('region 생략' · 'trade→trd' · '균등 축소 B=7' · '하이픈 제거')
  // pattern 은 RegExp.source, patternFlags 는 RegExp.flags — 소비자는 new RegExp(pattern, patternFlags) 로 다시 만든다 (리소스 그룹의 \p{L} 은 'u' 가 없으면 리터럴 p 가 된다)
  rule: { minLength: number; maxLength: number; pattern: string; patternFlags: string; allowed: Allowed; docUrl: string; note?: string };
}

export type GenerateOutput = Partial<Record<Provider, Record<string, NameResult>>>;

export interface LabelSet {
  labels: Record<string, string>;
  violations: string[];       // 키·값 한도 초과 (TC-AWS-02)
  transformed: string[];      // GCP 규격으로 바꾼 값 ('owner: Ac.Mex→acmex')
}
