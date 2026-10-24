// 마법사 카드 (D93) — 서비스 칸의 갤러리(「무엇을 만드나」)와 카드 줄의 점검표. 카드는 프리셋 pick 을 한 번에 더하는 동작이고,
// 화면은 서비스에 있는 부품에서 카드를 되읽는다(wizardBundles.cardsIn). 이름 규칙 · 판정은 모른다 — 줄 이름은 엔진 결과(rowNames)를 그대로 보인다
import { useState } from 'react';
import { ChevronRight, CircleCheck, ExternalLink, TriangleAlert, X } from 'lucide-react';
import type { ProjectResult } from '../core/engine';
import type { WizardPlan } from '../core/wizard/plan';
import { MAX_PICKS_PER_SERVICE } from '../core/wizard/plan';
import { BUNDLES, bundleById, partIsProject, partKey, RUN_PUBLIC_DOC, STATIC_SITE_DOC, FIRESTORE_DOC, KMS_LOCATION_DOC, ARMOR_DOC, TASKS_DOC, ROLES_DOC, MIG_DOC, type Bundle, type BundlePart } from '../core/wizard/bundles';
import { presetOf } from '../core/wizard/presets';
import * as B from './wizardBundles';
import { findPreset } from './wizardState';
import { cardRow, rowNames, serviceRow, type Edit, type RowPath } from './wizardSelection';
import { BTN, HINT, ICON_BTN, PRIMARY } from './wizardStyles';
import { fillUi, type UiKey } from '../messages/catalog';
import { en } from '../messages/en';

const CARD = 'flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
const TAG = 'rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
const STATE = {
  complete: 'rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  incomplete: 'rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

// 부품 이름 — tier 칩(방화벽) · 역할(D126 — 서비스 계정)을 `Service account · build` 꼴로 붙인다
const label = (p: BundlePart) => [presetOf(p.preset)?.label ?? p.preset, ...(p.tier === undefined ? [] : [p.tier]), ...(p.role === undefined ? [] : [p.role])].join(' · ');

/** 카드의 요약 표 — 서비스 부품의 뜻(로드 밸런서 부품은 묶어 수로) · 네트워크 부품 수 */
function tags(b: Bundle): string[] {
  const svc = b.parts.filter((p) => !partIsProject(p));
  const redirect = svc.filter((p) => ['urlredir', 'thp', 'fwdredir'].includes(p.preset)).length;
  const lb = svc.filter((p) => presetOf(p.preset)?.group === 'lb' && !['urlredir', 'thp', 'fwdredir'].includes(p.preset)).length;
  const own = svc.filter((p) => presetOf(p.preset)?.group !== 'lb').map(label);
  const net = b.parts.filter(partIsProject).length;
  return [
    ...own,
    ...(lb > 0 ? [fillUi(en, 'wizard_card_tag_lb', { n: lb })] : []),
    ...(redirect > 0 ? [fillUi(en, 'wizard_card_tag_redirect', { n: redirect })] : []),
    ...(net > 0 ? [fillUi(en, 'wizard_card_tag_network', { n: net })] : []),
  ];
}

/** 카드 자체의 이름 수 — 필수 부품(백엔드를 고르는 카드는 백엔드 없이) + 기본으로 켜진 선택. 같은 부품은 한 번 */
function cardSize(b: Bundle): number {
  return new Set([...b.parts, ...b.options.filter((o) => o.on).flatMap((o) => o.parts)].map((p) => `${partIsProject(p)}|${partKey(p)}`)).size;
}

/** 갤러리 — 서비스 칸 위쪽. 카드마다 선택 체크 상자와 Add. 이미 있는 카드는 Open, 같은 가족이 있으면 꺼진다 */
export function CardGallery({ plan, service, edit, onSelect }: { plan: WizardPlan; service: number; edit: Edit; onSelect: (path: RowPath) => void }) {
  const name = plan.services[service]?.purpose || en.ui.wizard_unnamed_service;
  return (
    <section aria-labelledby={`wizard-gallery-${service}`} data-card-gallery className="space-y-3">
      <div>
        <h3 id={`wizard-gallery-${service}`} className="text-base font-semibold">{fillUi(en, 'wizard_gallery_title', { service: name })}</h3>
        <p className={HINT}>{en.ui.wizard_gallery_hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {BUNDLES.map((b) => <GalleryCard key={b.id} plan={plan} service={service} bundle={b} edit={edit} onSelect={onSelect} />)}
      </div>
    </section>
  );
}

function GalleryCard({ plan, service, bundle: b, edit, onSelect }: { plan: WizardPlan; service: number; bundle: Bundle; edit: Edit; onSelect: (path: RowPath) => void }) {
  const [options, setOptions] = useState<Record<string, boolean>>(() => Object.fromEntries(b.options.map((o) => [o.id, o.on])));
  const present = B.cardIn(plan, service, b.id);
  const blocked = B.cardBlocked(plan, service, b.id, options);
  const adds = B.partsToAdd(plan, service, b.id, options).length;
  const svcName = plan.services[service]?.purpose || en.ui.wizard_unnamed_service;
  const titleId = `wizard-card-${service}-${b.id}`;
  const reasonId = `${titleId}-reason`;
  const reason = blocked === 'family' ? en.ui.wizard_card_family : blocked === 'overlap' ? en.ui.wizard_card_overlap : blocked === 'duplicate' ? en.ui.wizard_card_duplicate : blocked === 'full' ? fillUi(en, 'wizard_card_full', { max: MAX_PICKS_PER_SERVICE }) : undefined;
  return (
    <div role="group" aria-labelledby={titleId} data-card={b.id} data-card-present={present ? (present.complete ? 'complete' : 'incomplete') : undefined} className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <h4 id={titleId} className="text-base font-semibold">{b.label}</h4>
        {/* 이름 수 — 지금 더할 수 있으면 Add 가 더할 수(이미 있는 부품은 빼고), 아니면 카드 자체의 수(필수 + 기본 선택) */}
        <span data-card-names className={`shrink-0 ${TAG}`}>{fillUi(en, 'wizard_card_names', { n: present || blocked !== undefined ? cardSize(b) : adds })}</span>
      </div>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">{b.summary}</p>
      <ul className="flex flex-wrap gap-1" aria-label={en.ui.wizard_card_parts}>
        {tags(b).map((t) => <li key={t} className={TAG}>{t}</li>)}
      </ul>
      {b.options.length > 0 && !present && (
        <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label={en.ui.wizard_card_options}>
          {b.options.map((o) => (
            <label key={o.id} className="inline-flex min-h-8 items-center gap-2 text-sm">
              <input type="checkbox" data-card-option={o.id} checked={options[o.id] ?? o.on} className="size-4 accent-indigo-600"
                onChange={(e) => setOptions((x) => ({ ...x, [o.id]: e.target.checked }))} />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <p data-card-evidence className={`text-xs ${b.tested ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-400'}`}>
          {b.tested ? <><CircleCheck aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />{en.ui.wizard_card_tested}</> : en.ui.wizard_card_untested}
        </p>
        {present
          ? (
            <button type="button" data-card-open={b.id} aria-label={fillUi(en, 'wizard_card_open_label', { card: b.label })} className={BTN}
              onClick={() => onSelect(cardRow(service, b.id))}>{en.ui.wizard_card_open}<ChevronRight aria-hidden="true" className="size-4" /></button>
          )
          : (
            <button type="button" data-card-add={b.id} disabled={blocked !== undefined} aria-label={fillUi(en, 'wizard_card_add_label', { card: b.label, service: svcName })}
              aria-describedby={reason ? reasonId : undefined} className={PRIMARY}
              onClick={() => edit((p) => B.addBundle(p, service, b.id, options), (_x, after) => (B.cardIn(after, service, b.id) ? { type: 'select', path: cardRow(service, b.id) } : { type: 'keep' }))}>
              {en.ui.wizard_card_add}
            </button>
          )}
      </div>
      {reason && !present && <p id={reasonId} data-card-blocked={blocked} className={HINT}>{reason}</p>}
    </div>
  );
}

/** 이름이 없는 설정 (D96) — 카드가 이름을 다 줘도 공개 웹이 되려면 손으로 할 것. 점검표에만 둔다(갤러리 카드는 고르는 자리라 짧게 둔다).
 *  키는 카드 id 또는 `카드:선택` (D124) — 선택 단위 안내는 그 선택이 켜졌을 때만 보인다 */
const CARD_SETUP: Readonly<Record<string, { text: UiKey; doc: string }>> = {
  'serverless-web': { text: 'wizard_card_setup_run', doc: RUN_PUBLIC_DOC },
  'static-site': { text: 'wizard_card_setup_static', doc: STATIC_SITE_DOC },
  'task-queue': { text: 'wizard_card_setup_tasks', doc: TASKS_DOC },
  'website-mig': { text: 'wizard_card_setup_mig', doc: MIG_DOC },
  'serverless-web:fs': { text: 'wizard_card_setup_fs', doc: FIRESTORE_DOC },
  'task-queue:fs': { text: 'wizard_card_setup_fs', doc: FIRESTORE_DOC },
  'data-warehouse:kms': { text: 'wizard_card_setup_kms', doc: KMS_LOCATION_DOC },
  'website:armor': { text: 'wizard_card_setup_armor', doc: ARMOR_DOC },
  'serverless-web:armor': { text: 'wizard_card_setup_armor', doc: ARMOR_DOC },
  'static-site:armor': { text: 'wizard_card_setup_armor', doc: ARMOR_DOC },
  'website-mig:armor': { text: 'wizard_card_setup_armor', doc: ARMOR_DOC },
  ...Object.fromEntries(['ci-cd', 'batch-job', 'data-warehouse', 'event-pipeline', 'task-queue'].map((id) => [`${id}:roles`, { text: 'wizard_card_setup_roles' as UiKey, doc: ROLES_DOC }])),
};

/** 카드 줄의 설정 — 점검표(부품마다 체크 상자 · 이름 · 고치기), 선택, 네트워크 부품, 빠진 부품 경고, 카드 지우기 */
export function CardPanel({ plan, service, card, result, edit, onSelect }: {
  plan: WizardPlan; service: number; card: string; result: ProjectResult | undefined; edit: Edit; onSelect: (path: RowPath) => void;
}) {
  const m = B.cardIn(plan, service, card);
  if (!m) return null;
  const b = m.bundle;
  const setups = [b.id, ...b.options.filter((o) => B.optionOn(plan, service, o.parts, b.id)).map((o) => `${b.id}:${o.id}`)].flatMap((k) => (CARD_SETUP[k] ? [{ key: k, ...CARD_SETUP[k]! }] : []));
  const svcName = plan.services[service]?.purpose || en.ui.wizard_unnamed_service;
  const svcParts = m.parts.filter((p) => !partIsProject(p));
  const netParts = m.parts.filter(partIsProject);
  const have = svcParts.filter((p) => B.partPresent(plan, service, p)).length;
  const missingText = [...m.missing.map(label)].join(', ');
  const titleId = `wizard-card-panel-${b.id}`;
  const nameOf = (p: BundlePart) => {
    const at = partIsProject(p) ? null : service;
    const i = findPreset(plan, at, p.preset, p.tier, p.role);
    return i < 0 ? undefined : { path: at === null ? `projectPicks[${i}]` : `services[${service}].picks[${i}]`, names: rowNames(plan, { service: at, pick: i }, result) };
  };
  // 켤 수 없는 체크 상자(상한 · 이름 겹침) — 끄고, 까닭 문단을 aria-describedby 로 잇는다
  const turnOnId = (why: 'full' | 'duplicate' | 'overlap') => `${titleId}-turn-on-${why}`;
  const networkHintId = `${titleId}-network-hint`;
  const fillWhy = B.fillBlocked(plan, service, b.id);
  const partWhy = (p: BundlePart) => B.partBlocked(plan, service, p);
  const optionWhy = (parts: readonly BundlePart[]) => B.optionBlocked(plan, service, parts, b.id);
  // 이 서비스의 다른 카드도 쓰는 부품 (D115) — 끄거나 카드를 지워도 남으므로 체크 상자를 끄고 누가 쓰는지 보인다
  const sharedWith = (p: BundlePart) => B.partUsers(plan, service, p, b.id).map((id) => bundleById(id)?.label ?? id);
  const sharedId = (p: BundlePart) => `${titleId}-shared-${partKey(p).replace(':', '-')}`;
  const whys = new Set([...m.parts.map(partWhy), ...b.options.map((o) => optionWhy(o.parts))].filter((x) => x !== undefined));
  const partRow = (p: BundlePart) => {
    const on = B.partPresent(plan, service, p);
    const why = on ? undefined : partWhy(p);
    // 네트워크 부품은 카드에서 지우지 않는다(B.setPart) — 있으면 체크 상자를 끄고 안내 문단을 잇는다. 빠졌으면 켤 수 있다.
    // 다른 카드도 쓰는 서비스 부품(D115)도 끄지 않는다 — 누가 쓰는지 줄에 적고 그 글을 잇는다
    const users = on && !partIsProject(p) ? sharedWith(p) : [];
    const shared = on && partIsProject(p);
    const n = nameOf(p);
    const id = `${titleId}-${partKey(p).replace(':', '-')}`;
    return (
      <li key={partKey(p)} data-card-part={partKey(p)} data-present={on} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-zinc-100 py-1 last:border-b-0 dark:border-zinc-800">
        <label htmlFor={id} className="inline-flex min-w-0 flex-1 basis-40 items-center gap-2 text-sm">
          <input id={id} type="checkbox" checked={on} disabled={why !== undefined || shared || users.length > 0} aria-describedby={why ? turnOnId(why) : shared ? networkHintId : users.length > 0 ? sharedId(p) : undefined} className="size-4 shrink-0 accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
            onChange={(e) => edit((x) => B.setPart(x, service, p, e.target.checked, b.id))} />
          <span className={on ? '' : 'text-zinc-500 line-through dark:text-zinc-400'}>{label(p)}</span>
        </label>
        {users.length > 0 && <span id={sharedId(p)} data-card-part-shared className={`text-xs ${HINT}`}>{fillUi(en, 'wizard_card_shared', { cards: users.join(', ') })}</span>}
        <code data-card-part-name className={`min-w-0 max-w-full truncate font-mono text-xs ${HINT}`} title={n?.names?.first}>{n?.names ? n.names.first : '—'}</code>
        {n && (
          <button type="button" data-card-part-edit={partKey(p)} data-edit-path={n.path} aria-label={fillUi(en, 'wizard_card_edit_label', { part: label(p) })} className="inline-flex min-h-8 items-center gap-0.5 rounded px-1 text-xs font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-indigo-300"
            onClick={() => onSelect(n.path)}>{en.ui.wizard_card_edit}<ChevronRight aria-hidden="true" className="size-3.5" /></button>
        )}
      </li>
    );
  };
  return (
    <section aria-labelledby={titleId} data-card-panel={b.id} className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" data-card-back className={`inline-flex items-center gap-0.5 hover:underline ${HINT}`} onClick={() => onSelect(serviceRow(service))}>
            {fillUi(en, 'wizard_card_back', { service: svcName })}
          </button>
          <h2 id={titleId} className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {b.label}
            <span data-card-state={m.complete ? 'complete' : 'incomplete'} className={m.complete ? STATE.complete : STATE.incomplete}>
              {fillUi(en, m.complete ? 'wizard_card_complete' : 'wizard_card_incomplete', { have, all: svcParts.length })}
            </span>
          </h2>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{b.summary}</p>
        </div>
        <button type="button" data-card-close aria-label={fillUi(en, 'wizard_card_back', { service: svcName })} title={fillUi(en, 'wizard_card_back', { service: svcName })} className={ICON_BTN}
          onClick={() => onSelect(serviceRow(service))}><X aria-hidden="true" className="size-4" /></button>
      </div>

      {!m.complete && (
        <div data-card-warning role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="flex items-start gap-1.5">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              {m.noBackend ? en.ui.wizard_card_no_backend : `${fillUi(en, 'wizard_card_missing', { parts: missingText })} ${b.family === 'lb' ? en.ui.wizard_card_missing_lb : en.ui.wizard_card_missing_other}`}
            </span>
          </p>
          {m.missing.length > 0 && (
            <button type="button" data-card-fill disabled={fillWhy !== undefined} className={BTN}
              onClick={() => edit((x) => B.fillMissing(x, service, b.id))}>{en.ui.wizard_card_fill}</button>
          )}
        </div>
      )}

      {setups.length > 0 && (
        <div data-card-setup={b.id} className="space-y-1 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_card_setup}</p>
          {setups.map((x) => (
            <p key={x.key} data-card-setup-note={x.key} className="text-sm text-zinc-700 dark:text-zinc-300">
              {B.setupNote(plan, service, x.key, x.text)}{' '}
              <a href={x.doc} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
                {en.ui.wizard_card_setup_doc}<ExternalLink aria-hidden="true" className="size-3" />
              </a>
            </p>
          ))}
        </div>
      )}

      {b.options.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_card_options}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {b.options.map((o) => {
              const why = optionWhy(o.parts);
              const on = B.optionOn(plan, service, o.parts, b.id);
              // 켜진 선택의 부품을 다른 카드도 쓰면(D115 — Serverless web 의 서비스 계정과 CI/CD) 꺼도 남으므로 끄지 못하게 하고 누가 쓰는지 보인다
              const users = on ? [...new Set(o.parts.filter((p) => !partIsProject(p)).flatMap(sharedWith))] : [];
              const usersId = `${titleId}-option-${o.id}-shared`;
              return (
                <span key={o.id} className="inline-flex flex-wrap items-center gap-x-2">
                <label className="inline-flex min-h-8 items-center gap-2 text-sm">
                  <input type="checkbox" data-card-option={o.id} checked={on} disabled={why !== undefined || users.length > 0} aria-describedby={why ? turnOnId(why) : users.length > 0 ? usersId : undefined}
                    className="size-4 accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-40" onChange={(e) => edit((x) => B.setOption(x, service, o.parts, e.target.checked, b.id))} />
                  {o.label}
                </label>
                {users.length > 0 && <span id={usersId} data-card-option-shared className={`text-xs ${HINT}`}>{fillUi(en, 'wizard_card_shared', { cards: users.join(', ') })}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {[...whys].map((why) => (
        <p key={why} id={turnOnId(why)} data-card-turn-on-blocked={why} className={HINT}>
          {why === 'full' ? fillUi(en, 'wizard_card_turn_on_full', { max: MAX_PICKS_PER_SERVICE }) : why === 'overlap' ? en.ui.wizard_card_turn_on_overlap : en.ui.wizard_card_turn_on_duplicate}
        </p>
      ))}

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_card_parts}</p>
        <ul data-card-parts>{svcParts.map(partRow)}</ul>
      </div>
      {netParts.length > 0 && (
        <div className="space-y-1 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_card_network}</p>
          <ul data-card-network>{netParts.map(partRow)}</ul>
          <p id={networkHintId} className={HINT}>{en.ui.wizard_card_network_hint}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button type="button" data-card-remove className={BTN} onClick={() => edit((x) => B.removeBundle(x, service, b.id), { type: 'select', path: serviceRow(service) })}>{en.ui.wizard_card_remove}</button>
        <span className={HINT}>{en.ui.wizard_card_remove_hint}</span>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{en.ui.wizard_card_sources}</p>
        <p data-card-sources className={`flex flex-wrap gap-x-3 gap-y-1 ${HINT}`}>
          {b.tested && <span className="text-emerald-700 dark:text-emerald-400">{en.ui.wizard_card_tested}</span>}
          {b.evidence.filter((e) => e.startsWith('https://')).map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
              {new URL(u).pathname.split('/').filter((x) => x !== '').pop()}<ExternalLink aria-hidden="true" className="size-3" />
            </a>
          ))}
        </p>
      </div>
    </section>
  );
}
