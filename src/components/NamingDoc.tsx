// /docs/naming — 이름 안내 (D57). 생성 TS(catalog · 지역 표 · 규칙 · 사전 · 버전)에서 namingDocModel 이 만든 절 아홉을 그린다.
// 넓은 표는 자기 상자 안에서 가로로 흐른다 — 360px 에서 페이지 가로 스크롤이 생기지 않는다
import { DocPage } from './DocPage';
import { en } from '../messages/en';
import { catalogFor } from '../core/catalog';
import { REGIONS } from '../core/regions-data';
import { buildTree } from '../core/tree';
import { ENABLED_PROVIDERS } from '../core/types';
import { VERSION } from '../version';
import { treeRules } from './selection';
import { namingDocModel, type DocSection, type DocTable } from './namingDocModel';

const CODE = 'font-mono text-[0.85em]';

function Table({ table, id }: { table: DocTable; id: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table data-doc-table={id} className="w-full border-collapse text-left text-xs">
        <caption className="px-3 py-2 text-left text-xs font-medium text-zinc-600 dark:text-zinc-400">{table.caption}</caption>
        <thead>
          <tr className="border-y border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
            {table.columns.map((c) => <th key={c} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr data-row={r.key} key={r.key} className="border-b border-zinc-200 align-top last:border-b-0 dark:border-zinc-800">
              {r.cells.map((cell, i) => (
                <td key={i} className={`px-3 py-2 ${table.mono[i] ? `${CODE} break-words` : ''}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ section }: { section: DocSection }) {
  const titleId = `doc-${section.id}-title`;
  const List = section.ordered ? 'ol' : 'ul';
  return (
    <section id={`doc-${section.id}`} aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="text-lg font-semibold">{section.title}</h2>
      {section.paragraphs.map((p) => <p key={p} data-doc-paragraph={section.id}>{p}</p>)}
      {section.listLead && <p>{section.listLead}</p>}
      {section.items && (
        <List data-doc-list={section.id} className={`space-y-1 pl-5 ${section.ordered ? 'list-decimal' : 'list-disc'}`}>
          {section.items.map((item) => <li key={item}>{item}</li>)}
        </List>
      )}
      {section.table && <Table table={section.table} id={section.id} />}
    </section>
  );
}

export function NamingDoc() {
  const provider = ENABLED_PROVIDERS[0]!;
  const model = namingDocModel({
    provider, catalog: catalogFor(provider), regions: REGIONS[provider], rules: treeRules(buildTree(provider)), messages: en, version: VERSION,
  });
  return (
    <DocPage title={en.ui.doc_title}>
      <div data-naming-doc className="space-y-8 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
        <p>{model.intro}</p>
        {model.sections.map((s) => <Section key={s.id} section={s} />)}
      </div>
    </DocPage>
  );
}
