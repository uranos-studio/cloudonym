// /privacy — 개인정보 안내 (D56 · D57). 문장은 사전의 privacy_ 키, 숫자 · 표는 privacyModel 이 맡는다
import type { ReactNode } from 'react';
import { DocPage } from './DocPage';
import { en } from '../messages/en';
import { fillUi } from '../messages/catalog';
import { VISIT_KEY } from './beacon';
import { COPY_TARGETS } from './copyTargets';
import { axiomRetentionText, PRIVACY_AXIOM_RETENTION_DAYS, PRIVACY_EVENTS, PRIVACY_KV_RETENTION_DAYS, PRIVACY_RATE_LIMIT } from './privacyModel';

const CODE = 'rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-800';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  const ui = en.ui;
  return (
    <DocPage title={ui.privacy_title}>
      <div data-privacy className="space-y-8 text-sm leading-6 text-zinc-800 dark:text-zinc-200">
        <p>{ui.privacy_intro}</p>
        <Section id="privacy-browser" title={ui.privacy_browser_title}>
          <p data-privacy-session>{fillUi(en, 'privacy_browser_session', { key: VISIT_KEY })}</p>
          <p>{ui.privacy_browser_hash}</p>
        </Section>
        <Section id="privacy-api" title={ui.privacy_api_title}>
          <p>{ui.privacy_api_intro}</p>
          <p>{ui.privacy_api_common}</p>
          <div className="overflow-x-auto">
            <table data-privacy-events className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-300 dark:border-zinc-700">
                  <th scope="col" className="py-2 pr-3 font-semibold">{ui.privacy_col_event}</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">{ui.privacy_col_when}</th>
                  <th scope="col" className="py-2 font-semibold">{ui.privacy_col_fields}</th>
                </tr>
              </thead>
              <tbody>
                {PRIVACY_EVENTS.map((e) => (
                  <tr key={e.event} data-event={e.event} className="border-b border-zinc-200 align-top dark:border-zinc-800">
                    <td className="py-2 pr-3"><code className={CODE}>{e.event}</code></td>
                    <td className="py-2 pr-3">{ui[e.when]}</td>
                    <td className="py-2">
                      {e.fields.length === 0 ? '—' : e.fields.map((f, i) => <span key={f}>{i > 0 && ', '}<code className={CODE}>{f}</code></span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>{fillUi(en, 'privacy_target_note', { targets: COPY_TARGETS.join(', ') })}</p>
          <p data-privacy-rules>{ui.privacy_rules_note}</p>
        </Section>
        <Section id="privacy-never" title={ui.privacy_never_title}>
          <p data-privacy-never>{ui.privacy_never_body}</p>
        </Section>
        <Section id="privacy-retention" title={ui.privacy_retention_title}>
          <p data-privacy-kv>{fillUi(en, 'privacy_retention_kv', { days: PRIVACY_KV_RETENTION_DAYS })}</p>
          <p data-privacy-axiom>{axiomRetentionText(PRIVACY_AXIOM_RETENTION_DAYS)}</p>
        </Section>
        <Section id="privacy-hosting" title={ui.privacy_hosting_title}>
          <p data-privacy-ip>{fillUi(en, 'privacy_ip', PRIVACY_RATE_LIMIT)}</p>
          <p>{ui.privacy_hosting}</p>
        </Section>
      </div>
    </DocPage>
  );
}
