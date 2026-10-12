// 엔진 공개 타입 — 이후 모듈(normalize · compose · truncate · validate · engine · labels)이 이 이름을 쓴다
import type { CoreMessage } from './messages';
import type { ScopeId } from './scopes';
export type { CoreMessage, ScopeId };

export type Provider = 'aws' | 'gcp' | 'azure';
export const PROVIDERS: readonly Provider[] = ['aws', 'gcp', 'azure'];
/** 켜진 CSP (D45) — 화면 · API · llms.txt · openapi.json 이 이 목록만 연다. 규칙 · 시험 · 기준선은 PROVIDERS 셋을 그대로 돈다.
 *  꺼진 CSP 는 데이터를 남기고 노출만 끈다. 다음 CSP 를 여는 것은 이 배열에 더하는 것이다 */
export const ENABLED_PROVIDERS: readonly Provider[] = ['gcp'];
export type Env = 'prod' | 'stg' | 'dev' | 'sbx';

/** region 은 그 CSP 의 리전 코드(ane3 · apne2 · krc) 또는 'global' · zone 은 존 코드(ane3a) — 존 이름 · 존 코드를 넣었을 때만 (D49).
 *  zone 은 입력 왕복 · 표시용이고 이름에는 들지 않는다 (D50 revised).
 *  코드 표는 regions-data.ts 이고 parseContext 가 provider 마다 푼다 */
export interface NamingContext {
  owner: string; system: string; purpose: string; env: Env; region: string; zone?: string;
}
/** 프로젝트 수준 문맥 (D63) — purpose 가 없다. 서비스에 딸리지 않은 항목(네트워크 · 프로젝트 ID)이 쓴다 */
export type ProjectContext = Omit<NamingContext, 'purpose'>;
/** 사용자가 보낸 그대로 — env/region 은 별칭일 수 있다 */
export interface RawContext {
  owner?: unknown; system?: unknown; purpose?: unknown; env?: unknown; region?: unknown;
}

export type Token = 'owner' | 'system' | 'purpose' | 'tier' | 'env' | 'region' | 'slug' | 'kind' | 'seq' | 'role';
/** 축소에서 손대지 않는 토큰 (D13 · D51 · D52 · D60) — region 은 2단계(단축 · 균등 예산)에서 자르지 않는다. 1단계는 optional 이면 통째로 뗀다.
 *  kind 는 종류 토큰(pg · int …)이다 — 자르면 뜻이 사라진다. tier 는 용도 토큰(web · was …)이다 — 줄이거나 떼면 두 항목이 같은 이름이 된다 */
export const PROTECTED: readonly Token[] = ['slug', 'kind', 'tier', 'seq', 'role', 'env', 'region'];
/** 용도 토큰의 꼴 (D60) — 가장 좁은 allowed(lower-digit)를 바뀜 없이 지나야 한다. 하이픈이 있으면 종류 · 용도의 경계를 못 읽는다 */
export const TIER_PATTERN = /^[a-z0-9]{2,16}$/;
/** 축소 뒤 가변 토큰의 최소 길이 (D13) */
export const MIN_TOKEN = 2;

/** 생성에 쓰는 문자 집합 (house style · D14) */
export type Allowed = 'lower-digit' | 'lower-digit-hyphen' | 'lower-digit-underscore' | 'alnum-hyphen' | 'alnum-hyphen-underscore' | 'alnum-hyphen-underscore-period-paren';

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

/** 지역 자리에 무엇이 오나 (D47 · D50 revised) — none 은 지역 토큰이 없는 규칙(전역 리소스 등). 존 규칙도 리전 코드다 */
export type RegionToken = 'none' | 'region';

/** 규칙(= 범위) 하나의 종류 표 (D52) — catalog 가 덮는다. 종류 토큰은 약어 바로 뒤에 온다(…-{slug}-{kind}-{seq}) */
export interface RuleKinds {
  rule: 'omit-when-csp-default' | 'only-when-chosen' | 'required';
  default: string | null;            // 이 범위의 CSP 기본값 — 토큰을 붙이지 않는다
  allowed: readonly string[];        // 이 범위에서 고를 수 있는 값
  tokens: Readonly<Record<string, string | null>>;   // 값 → 토큰(null 은 토큰 없음) — 행 공통
  omitValues: readonly string[];     // 기본값과 같이 토큰을 붙이지 않는 값 묶음 — 행 공통
}

/** 문서 문장이 아닌 근거 (D80) — 안내서가 길이 · 문자를 적지 않은 규칙만. docUrl(안내서)과 함께 싣는다.
 *  sdk = Google 이 배포한 SDK 의 검증 코드 · api_error = 실제 프로젝트에 보낸 요청의 서버 응답(프로젝트 ID 는 <project> 로 가린다) */
export interface RuleEvidence {
  kind: 'sdk' | 'api_error';
  source: string;   // sdk: 패키지 · 버전 · 파일 · 함수 / api_error: 메서드와 요청 경로
  date: string;     // 읽거나 잰 날 (YYYY-MM-DD, KST)
  quote: string;    // 정규식 · 오류 메시지 · 관측 결과 원문
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
  separator: '' | '-' | '_';   // '_' 는 하이픈을 받지 않는 규칙(BigQuery dataset · Cloud SQL) — 토큰 사이를 밑줄로 잇는다
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
  docUrl: string;             // 공식 문서 URL — 숫자의 근거 (evidence 가 있으면 안내서)
  evidence?: readonly RuleEvidence[]; // 안내서가 적지 않은 숫자 · 문자의 근거 (D80)
  notes?: CoreMessage[];      // 보수적 한도 등 설명 (D20) — 코드로 싣고 문장은 src/messages/ 가 만든다
  regionToken?: RegionToken;  // catalog 가 덮은 규칙(GCP)만 있다 — 없으면 템플릿에 region 이 있는지로 정한다(compose.ts regionTokenOfRule)
  defaultLocation?: 'global'; // 지역 자리의 기본값이 문맥 지역이 아니라 global(토큰 없음)인 규칙 — Secret (D79). 마법사 pick 의 location 'regional' 일 때만 문맥 지역을 쓴다
  kinds?: RuleKinds;          // catalog 에 종류 표가 있는 규칙만
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
