// 엔진 공개 타입 — 이후 모듈(normalize · compose · truncate · validate · engine · labels)이 이 이름을 쓴다
import type { CoreMessage } from './messages';
import type { ScopeId } from './scopes';
export type { CoreMessage, ScopeId };

export type Provider = 'aws' | 'gcp' | 'azure';
export const PROVIDERS: readonly Provider[] = ['aws', 'gcp', 'azure'];
/** 켜진 CSP (D45) — 화면 · API · llms.txt · openapi.json 이 이 목록만 연다. 규칙 · 시험 · 기준선은 PROVIDERS 셋을 그대로 돈다.
 *  꺼진 CSP 는 데이터를 남기고 노출만 끈다. 다음 CSP 를 여는 것은 이 배열에 더하는 것이다 */
export const ENABLED_PROVIDERS: readonly Provider[] = ['gcp'];
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

/** 트리의 표시 분류 (D37) */
export type Category = 'compute' | 'networking' | 'storage' | 'database' | 'identity' | 'security' | 'management' | 'containers';

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
  scope: ScopeId;             // 이름이 유일한 범위 — SCOPES(scopes.ts)의 키 (D37). Name 태그는 포함 관계로 놓인 자리 (D38)
  entity: string;             // 고유성 부류 — CSP 의 유형 이름. Azure 는 표의 Entity(네임스페이스 포함) · GCP 는 디스커버리 리소스 이름 · AWS 는 API 종류 이름 (D31)
  category: Category;         // 표시 분류 — 콘솔 메뉴를 따른 것이라 근거 URL 이 없다
  uniqueness: 'csp' | 'none'; // none = CSP 가 고유성을 매기지 않는다(AWS Name 태그 · D38)
  uniquenessDocUrl?: string;  // 범위 근거가 docUrl 과 다른 쪽에 있을 때 그 URL
  docUrl: string;             // 공식 문서 URL — 숫자의 근거
  notes?: CoreMessage[];      // 보수적 한도 등 설명 (D20) — 코드로 싣고 문장은 src/messages/ 가 만든다
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
  violations: CoreMessage[];  // valid:false 일 때 이유 (D23)
  steps: CoreMessage[];       // 축소 · 변환 기록 (step.token_dropped · step.abbreviated · step.budget_shortened · step.separator_removed · step.normalized)
  // pattern 은 RegExp.source, patternFlags 는 RegExp.flags — 소비자는 new RegExp(pattern, patternFlags) 로 다시 만든다 (리소스 그룹의 \p{L} 은 'u' 가 없으면 리터럴 p 가 된다)
  rule: { minLength: number; maxLength: number; pattern: string; patternFlags: string; allowed: Allowed; docUrl: string; notes: CoreMessage[] };
}

export type GenerateOutput = Partial<Record<Provider, Record<string, NameResult>>>;

export interface LabelSet {
  labels: Record<string, string>;
  violations: CoreMessage[];  // 키·값 한도 초과 (TC-AWS-02)
  transformed: CoreMessage[]; // GCP 규격으로 바꾼 값 (label.normalized)
}
