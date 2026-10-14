// /docs/api 모델 — 엔드포인트 표 · curl 예제 · 응답 일부 · 실패 꼴을 public/openapi.json(명세) 하나에서 만든다. 손으로 쓴 요청 본문이 없다.
// 호스트는 화면이 실행 시점에 넘기는 origin 이다 — 도메인을 소스에 두지 않는다. 명세는 화면이 같은 출처의 /openapi.json 에서 받는다(번들에 싣지 않는다)
import { PRIVACY_EVENTS, PRIVACY_RATE_LIMIT, PRIVACY_SKIP_HEADER } from './privacyModel';

/** 요청 제한 — /privacy 와 같은 상수. api 의 RATE_LIMIT 과 같은지는 src/api/privacy-sync.test.ts 가 본다 */
export const API_DOC_RATE_LIMIT = PRIVACY_RATE_LIMIT;
/** 세지 않는 점검 요청의 헤더 (D99) — /privacy 와 같은 상수. 실제로 세지 않는지는 src/api/apidoc-sync.test.ts 가 본다 */
export const API_DOC_SKIP_HEADER = PRIVACY_SKIP_HEADER;

// 안내 문장 속 목록 — components 는 api 를 들여오지 않아 값을 여기 둔다. 서버(미들웨어 · 라우트 · FAIL_STATUSES · 텔레메트리)와 같은지는 src/api/apidoc-sync.test.ts 가 본다
/** 요청 제한을 받는 사이트 뿌리의 GET — /v1/ 의 POST 는 전부 받는다 */
export const API_DOC_LIMITED_ROOT: readonly string[] = ['/llms.txt', '/catalog.json'];
/** 요청 제한을 받지 않는 GET */
export const API_DOC_UNLIMITED: readonly string[] = ['/v1/health', '/openapi.json'];
/** 실패 상태 코드 — api 의 FAIL_STATUSES */
export const API_DOC_FAIL_STATUSES: readonly number[] = [400, 403, 404, 409, 413, 429, 500];
/** 세는 요청과 그 이벤트 — 성공한 요청 하나가 이벤트 하나다 */
export const API_DOC_COUNTED: readonly { event: string; request: string }[] = [
  { event: 'api_generate', request: 'POST /v1/generate' },
  { event: 'api_names', request: 'POST /v1/names' },
  { event: 'api_validate', request: 'POST /v1/validate' },
  { event: 'api_wizard', request: 'POST /v1/wizard' },
  { event: 'llms_txt_accessed', request: 'GET /llms.txt' },
  { event: 'catalog_json_accessed', request: 'GET /catalog.json' },
];
/** 모든 기록에 서버가 싣는 칸 — 이벤트마다 칸은 PRIVACY_EVENTS(= telemetry 의 META_KEYS) */
export const API_DOC_COMMON_FIELDS: readonly string[] = ['_time', 'kst_day', 'event', 'client_class', 'is_ai_agent'];
/** 성공 응답에 version 을 싣는 경로 — 명세의 200 응답과 같은지는 apiDoc.test 가 본다 */
export const API_DOC_VERSIONED: readonly string[] = ['/v1/generate', '/v1/names', '/v1/wizard', '/v1/validate', '/v1/health', '/catalog.json'];

/** 영어 나열 — a · a and b · a, b and c */
export function listText(items: readonly (string | number)[], last: 'and' | 'or' = 'and'): string {
  const xs = items.map(String);
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${last} ${xs[xs.length - 1]}`;
}

/** 세는 이벤트들의 칸 — 나온 순서대로 중복 없이 */
export function countedFields(): string[] {
  const counted = new Set(API_DOC_COUNTED.map((c) => c.event));
  return [...new Set(PRIVACY_EVENTS.filter((e) => counted.has(e.event)).flatMap((e) => e.fields))];
}

/** 안내 문장의 자리 값 — 화면이 fillUi 로 끼운다 */
export function apiDocVars() {
  return {
    limited: listText(API_DOC_LIMITED_ROOT),
    unlimited: listText(API_DOC_UNLIMITED),
    statuses: listText(API_DOC_FAIL_STATUSES),
    requests: listText(API_DOC_COUNTED.map((c) => c.request), 'or'),
    common: listText(API_DOC_COMMON_FIELDS),
    fields: listText(countedFields()),
    versioned: listText(API_DOC_VERSIONED),
  };
}

// 명세에서 읽는 만큼만 타입을 둔다
export interface ApiSchema {
  $ref?: string; type?: string; enum?: unknown[]; example?: unknown; description?: string; required?: string[];
  properties?: Record<string, ApiSchema>; additionalProperties?: ApiSchema | boolean; items?: ApiSchema;
}
interface ApiOperation {
  summary?: string;
  requestBody?: { content: Record<string, { example?: unknown }> };
  responses: Record<string, { description?: string; content?: Record<string, { schema?: ApiSchema }> }>;
}
export interface ApiSpec {
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown> & { servers?: { url: string }[] }>;
  components: { schemas: Record<string, ApiSchema> };
}

export interface ApiEndpointRow {
  /** 화면 안의 짧은 이름 — 행 · 예제 상자의 data 속성 */
  id: string;
  method: 'GET' | 'POST';
  path: string;
  /** 명세의 summary — 명세 밖 두 행(/llms.txt · /openapi.json)은 null 이고 화면이 사전 문장을 쓴다 */
  summary: string | null;
  /** 클라이언트 IP 당 요청 제한을 받는가 */
  limited: boolean;
  /** 화면 비콘처럼 공개 호출용이 아닌 것 — 예제를 싣지 않는다 */
  internal: boolean;
  curl?: string;
  response?: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 받은 JSON 이 이 화면이 읽는 모양인가 — servers 배열 · paths · components.schemas, 그리고 get · post 마다 responses. 아니면 화면은 'error' 로 받는다 */
export function isApiSpec(x: unknown): x is ApiSpec {
  if (!isObject(x) || !Array.isArray(x['servers']) || !isObject(x['paths'])) return false;
  if (!isObject(x['components']) || !isObject(x['components']['schemas'])) return false;
  return Object.values(x['paths']).every((item) => isObject(item)
    && (['get', 'post'] as const).every((m) => item[m] === undefined || (isObject(item[m]) && isObject((item[m] as Record<string, unknown>)['responses']))));
}

/** 같은 출처의 /openapi.json 을 받는다 — HTTP 오류 · JSON 아님 · 읽는 모양이 아님은 모두 'error'(화면이 하얗게 되지 않는다). 시험은 fetch 를 넣는다 */
export function loadSpec(get: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>): Promise<ApiSpec | 'error'> {
  return get('/openapi.json')
    .then((r) => (r.ok ? r.json() as Promise<unknown> : Promise.reject(new Error(String(r.status)))))
    .then((s) => (isApiSpec(s) ? s : 'error' as const), () => 'error' as const);
}

/** 셸의 작은따옴표 인자 — 안의 ' 는 '\'' 로 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const op = (spec: ApiSpec, path: string, method: string): ApiOperation | undefined => spec.paths[path]?.[method] as ApiOperation | undefined;

/** 그 경로 POST 의 request example */
export function requestExample(spec: ApiSpec, path: string): unknown {
  return op(spec, path, 'post')?.requestBody?.content['application/json']?.example;
}

/** 명세의 경로 + 그 경로의 servers(없으면 문서 servers) — `/v1` + `/generate`, `/` + `/catalog.json` */
function fullPath(spec: ApiSpec, path: string): string {
  const base = spec.paths[path]?.servers?.[0]?.url ?? spec.servers[0]?.url ?? '';
  return `${base.replace(/\/+$/, '')}${path}`;
}

function resolve(spec: ApiSpec, s: ApiSchema): ApiSchema {
  if (!s.$ref) return s;
  return spec.components.schemas[s.$ref.replace('#/components/schemas/', '')] ?? {};
}

/** 응답 한 칸의 자리 표시 — 값이 하나뿐(enum 하나)이면 그 값, version 은 지금 값, 나머지는 꼴만 */
function placeholder(spec: ApiSchema, root: ApiSpec, version: { engine: string; rules: string }): string {
  if (spec.$ref?.endsWith('/Version')) return `{ "engine": "${version.engine}", "rules": "${version.rules}" }`;
  const s = resolve(root, spec);
  if (s.enum?.length === 1) return JSON.stringify(s.enum[0]);
  if (s.type === 'array') return '[ … ]';
  if (s.type === 'object' || s.properties || s.additionalProperties) return '{ … }';
  return s.type ?? '…';
}

/** 200 응답의 맨 윗단 — 키는 스키마 그대로. 스키마의 required 에 없는 키는 「"키"?:」 로 표시한다 */
function responseExample(root: ApiSpec, o: ApiOperation, version: { engine: string; rules: string }): string | undefined {
  const schema = o.responses['200']?.content?.['application/json']?.schema;
  if (!schema) return undefined;
  const resolved = resolve(root, schema);
  const required = new Set(resolved.required ?? []);
  const lines = Object.entries(resolved.properties ?? {}).map(([k, v]) => `  "${k}"${required.has(k) ? '' : '?'}: ${placeholder(v, root, version)}`);
  return `{\n${lines.join(',\n')}\n}`;
}

function curlGet(origin: string, path: string): string {
  return `curl -s ${origin}${path}`;
}

function curlPost(origin: string, path: string, body: unknown): string {
  return `curl -s -X POST ${origin}${path} \\\n  -H 'content-type: application/json' \\\n  -d ${shellQuote(JSON.stringify(body))}`;
}

/** 공개 호출용 순서 — 이름 만들기 넷 · 상태 · 에이전트용 셋. 명세에 있는데 이 목록에 없는 것은 끝에 붙는다(빠지지 않는다) */
const ORDER: readonly { id: string; path: string; method: 'get' | 'post' }[] = [
  { id: 'generate', path: '/generate', method: 'post' },
  { id: 'names', path: '/names', method: 'post' },
  { id: 'wizard', path: '/wizard', method: 'post' },
  { id: 'validate', path: '/validate', method: 'post' },
  { id: 'health', path: '/health', method: 'get' },
];
/** 화면 비콘 — 같은 출처(Sec-Fetch-Site)만 받는다 */
const INTERNAL_PATHS = new Set(['/events']);

export function apiEndpoints(spec: ApiSpec, origin: string, version: { engine: string; rules: string }): ApiEndpointRow[] {
  const row = (id: string, path: string, method: 'get' | 'post'): ApiEndpointRow => {
    const o = op(spec, path, method)!;
    const full = fullPath(spec, path);
    const internal = INTERNAL_PATHS.has(path);
    const base: ApiEndpointRow = { id, method: method === 'get' ? 'GET' : 'POST', path: full, summary: o.summary ?? null, limited: '429' in o.responses, internal };
    if (internal) return base;
    const curl = method === 'post' ? curlPost(origin, full, requestExample(spec, path)) : curlGet(origin, full);
    return { ...base, curl, response: responseExample(spec, o, version) };
  };
  const known = new Set(ORDER.map((e) => `${e.method} ${e.path}`));
  const rest = Object.entries(spec.paths).flatMap(([path, item]) =>
    (['get', 'post'] as const).filter((m) => item[m] && !known.has(`${m} ${path}`)).map((m) => ({ path, method: m })));
  const extra = (path: string): { id: string; path: string; method: 'get' | 'post' } => ({ id: path.replace(/^\/|\.json$/g, '').replace(/\W/g, '_'), path, method: 'get' });
  const ordered = ORDER.filter((e) => op(spec, e.path, e.method)).map((e) => row(e.id, e.path, e.method));
  const agent: ApiEndpointRow[] = [
    // 명세 밖 — /llms.txt 는 Worker 가 만든다, /openapi.json 은 정적 파일이다. 요청 제한 여부는 위 목록에서(서버와 대어 보는 값)
    { id: 'llms', method: 'GET', path: '/llms.txt', summary: null, limited: API_DOC_LIMITED_ROOT.includes('/llms.txt'), internal: false, curl: curlGet(origin, '/llms.txt') },
    { id: 'openapi', method: 'GET', path: '/openapi.json', summary: null, limited: API_DOC_LIMITED_ROOT.includes('/openapi.json'), internal: false, curl: curlGet(origin, '/openapi.json') },
  ];
  const others = rest.filter((e) => !INTERNAL_PATHS.has(e.path)).map((e) => { const x = extra(e.path); return row(x.id, e.path, e.method); });
  const internal = rest.filter((e) => INTERNAL_PATHS.has(e.path)).map((e) => row(e.path.slice(1), e.path, e.method));
  return [...ordered, ...agent, ...others, ...internal];
}

/** 실패 꼴 — ErrorResponse 의 errors example 로 만든 본문 */
export function errorExample(spec: ApiSpec): string {
  const errors = spec.components.schemas['ErrorResponse']?.properties?.['errors']?.example ?? [];
  return JSON.stringify({ success: false, errors }, null, 2);
}

/** rules_version 불일치(409)의 뜻 — 명세의 /generate 409 설명 */
export function rulesVersionConflict(spec: ApiSpec): string {
  return op(spec, '/generate', 'post')?.responses['409']?.description ?? '';
}
