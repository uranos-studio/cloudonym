// /docs/api — 사람이 읽는 API 안내 (D98). 엔드포인트 표 · curl 예제 · 응답 일부 · 실패 꼴은 apiDocModel 이 같은 출처의 /openapi.json 에서 만든다.
// 명세를 번들에 싣지 않고 이 쪽을 열 때 받는다 — 받는 동안 · 못 받았을 때도 나머지 절은 그대로 보인다. 호스트는 지금 열린 페이지의 origin 이다
import { useEffect, useState, type ReactNode } from 'react';
import { DocPage } from './DocPage';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VERSION } from '../version';
import { PRIVACY_PATH, withStateHash } from './route';
import { API_DOC_RATE_LIMIT, apiDocVars, apiEndpoints, errorExample, loadSpec, rulesVersionConflict, type ApiEndpointRow, type ApiSpec } from './apiDocModel';

const CODE = 'rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800';
/** 긴 본문(curl 의 -d)은 상자 안에서 줄을 바꾼다 — 360px 에서 페이지 가로 스크롤이 생기지 않는다 */
const PRE = 'whitespace-pre-wrap break-all rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-5 dark:border-zinc-800 dark:bg-zinc-900';
const LINK = 'text-indigo-700 underline hover:text-indigo-900 dark:text-indigo-300 dark:hover:text-indigo-100';
/** 사이트 뿌리의 정적 · Worker 경로 — 표에서 링크로 연다 */
const LINKED = new Set(['/llms.txt', '/openapi.json', '/catalog.json']);

type SpecState = ApiSpec | null | 'error';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`api-${id}`} aria-labelledby={`api-${id}-title`} className="space-y-3">
      <h2 id={`api-${id}-title`} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function summaryOf(r: ApiEndpointRow): string {
  if (r.id === 'llms') return en.ui.api_llms_summary;
  if (r.id === 'openapi') return en.ui.api_openapi_summary;
  return r.summary ?? '';
}

function EndpointTable({ rows }: { rows: ApiEndpointRow[] }) {
  const ui = en.ui;
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table data-api-endpoints className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
            {[ui.api_col_method, ui.api_col_path, ui.api_col_what, ui.api_col_limited].map((c) => <th key={c} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-row={r.id} className="border-b border-zinc-200 align-top last:border-b-0 dark:border-zinc-800">
              <td className="px-3 py-2 font-mono">{r.method}</td>
              <td className="px-3 py-2 font-mono break-words">{LINKED.has(r.path) ? <a href={r.path} className={LINK}>{r.path}</a> : r.path}</td>
              <td className="px-3 py-2">{summaryOf(r)}{r.internal && <span data-internal className="mt-1 block text-zinc-600 dark:text-zinc-400">{ui.api_internal}</span>}</td>
              <td className="px-3 py-2">{r.limited ? ui.api_yes : ui.api_no}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Example({ row }: { row: ApiEndpointRow }) {
  return (
    <div data-api-example={row.id} className="space-y-2">
      <h3 className="font-mono text-sm font-semibold">{row.method} {row.path}</h3>
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{en.ui.api_request}</p>
      <pre data-curl className={PRE}>{row.curl}</pre>
      {row.response && <>
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{en.ui.api_response}</p>
        <pre data-response className={PRE}>{row.response}</pre>
      </>}
    </div>
  );
}

/** 화면 본문 — spec 이 null 이면 받는 중, 'error' 면 못 받은 것. 시험은 이것을 바로 그린다 */
export function ApiDocBody({ spec, origin }: { spec: SpecState; origin: string }) {
  const ui = en.ui;
  const loaded = spec !== null && spec !== 'error' ? spec : null;
  const rows = loaded ? apiEndpoints(loaded, origin, VERSION) : [];
  const vars = apiDocVars();
  const pending = <p data-api-pending>{spec === 'error' ? ui.api_spec_failed : ui.api_loading}</p>;
  return (
    <div data-api-doc className="space-y-8 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
      <p>{ui.api_intro}</p>
      <Section id="endpoints" title={ui.api_endpoints_title}>
        {loaded ? <EndpointTable rows={rows} /> : pending}
      </Section>
      <Section id="auth" title={ui.api_auth_title}>
        <p>{ui.api_auth_body}</p>
      </Section>
      <Section id="limits" title={ui.api_limits_title}>
        <p data-api-limits>{fillUi(en, 'api_limits_body', { limit: API_DOC_RATE_LIMIT.limit, period: API_DOC_RATE_LIMIT.period, limited: vars.limited, unlimited: vars.unlimited })}</p>
      </Section>
      <Section id="examples" title={ui.api_examples_title}>
        <p>{ui.api_examples_body}</p>
        {loaded ? rows.filter((r) => r.curl).map((r) => <Example key={r.id} row={r} />) : pending}
      </Section>
      <Section id="errors" title={ui.api_errors_title}>
        <p data-api-errors>{fillUi(en, 'api_errors_body', { statuses: vars.statuses })}</p>
        {loaded && <pre data-api-error className={PRE}>{errorExample(loaded)}</pre>}
      </Section>
      <Section id="version" title={ui.api_version_title}>
        <p data-api-version>{fillUi(en, 'api_version_body', { versioned: vars.versioned })}</p>
        {loaded && <p data-api-409><code className={CODE}>409</code> {rulesVersionConflict(loaded)}</p>}
      </Section>
      <Section id="pass" title={ui.doc_pass_title}>
        <p data-pass-meaning>{ui.pass_meaning}</p>
      </Section>
      <Section id="terraform" title={ui.api_terraform_title}>
        <p>{ui.api_terraform_body}</p>
      </Section>
      <Section id="telemetry" title={ui.api_telemetry_title}>
        <p data-api-telemetry>{fillUi(en, 'api_telemetry_body', { requests: vars.requests, common: vars.common, fields: vars.fields })} <a href={withStateHash(PRIVACY_PATH, window.location.hash)} data-api-privacy className={LINK}>{ui.footer_privacy}</a></p>
      </Section>
    </div>
  );
}

export function ApiDoc() {
  const [spec, setSpec] = useState<SpecState>(null);
  useEffect(() => {
    let live = true;
    void loadSpec((u) => fetch(u)).then((s) => { if (live) setSpec(s); });
    return () => { live = false; };
  }, []);
  return (
    <DocPage title={en.ui.api_title}>
      <ApiDocBody spec={spec} origin={window.location.origin} />
    </DocPage>
  );
}
