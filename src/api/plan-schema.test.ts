// 계획 파일 JSON Schema (D100) — public/plan.schema.json 은 openapi 의 WizardRequest(+ WizardPick)를 그대로 옮긴 독립 스키마다.
// 에디터 · AI 에이전트가 쓴다. 손으로 고치지 않고 이 시험이 명세에서 다시 만든 것과 같은지 본다 — 명세를 고치면 이 파일도 고친다
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeWizardState } from '../components/urlState';
import { savePlan } from '../components/planFile';
import { FULL_PLAN } from '../components/__fixtures__/plan';
import { ENV_VALUES } from '../core/engine';
import { VERSION } from '../version';

const root = join(import.meta.dirname, '../..');
type Node = Record<string, unknown>;
const spec = JSON.parse(readFileSync(join(root, 'public/openapi.json'), 'utf-8')) as { components: { schemas: Record<string, Node> } };
const file = JSON.parse(readFileSync(join(root, 'public/plan.schema.json'), 'utf-8')) as Node;

/** OpenAPI 3.0 스키마 → JSON Schema draft-07 — example 은 뺀다 · nullable 은 type 에 null 을 더한다 · 참조는 definitions 로 */
function toJsonSchema(n: unknown): unknown {
  if (Array.isArray(n)) return n.map(toJsonSchema);
  if (typeof n !== 'object' || n === null) return n;
  const src = n as Node;
  const out: Node = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'example' || k === 'nullable') continue;
    if (k === '$ref' && typeof v === 'string') { out.$ref = v.replace('#/components/schemas/', '#/definitions/'); continue; }
    out[k] = toJsonSchema(v);
  }
  if (src.nullable === true) out.type = [src.type, 'null'];
  return out;
}

/** 계획 파일 스키마의 머리 — 명세의 WizardRequest 설명(한 프로젝트 · wizard.empty)을 덮어쓴다. 아래 시험이 실제 문장을 단언한다 */
const DESCRIPTION = 'A wizard plan saved with Save plan (D100): the POST /v1/wizard request body, plus environments when the plan has two or more. Generated from WizardRequest in /openapi.json. project_picks and services may each be empty or omitted, but not both (wizard.empty).';
const HEAD = { $schema: 'http://json-schema.org/draft-07/schema#', title: 'Cloudonym plan file', description: DESCRIPTION };
/** 명세에 없는 칸 하나 — 에디터가 파일에 다는 $schema. API · 화면 모두 무시한다(plan-file.test · planFile.test) */
const SCHEMA_PROPERTY = { type: 'string', description: 'Optional. The URL of this JSON Schema, for editors. Ignored by the API and the web app.' };

describe('public/plan.schema.json (D100)', () => {
  it('= 명세의 WizardRequest · WizardPick 을 draft-07 로 옮긴 것', () => {
    const request = toJsonSchema(spec.components.schemas['WizardRequest']) as Node;
    const expected = { ...request, ...HEAD, properties: { $schema: SCHEMA_PROPERTY, ...(request.properties as Node) }, definitions: { WizardPick: toJsonSchema(spec.components.schemas['WizardPick']) } };
    expect(file).toEqual(expected);
    // 머리의 설명이 명세의 설명에 덮이지 않는다 — 기대값을 만드는 식이 아니라 실제 문장으로 본다
    expect(file.description).toBe('A wizard plan saved with Save plan (D100): the POST /v1/wizard request body, plus environments when the plan has two or more. Generated from WizardRequest in /openapi.json. project_picks and services may each be empty or omitted, but not both (wizard.empty).');
    expect(file.description).not.toBe(spec.components.schemas['WizardRequest']!.description);
    expect(JSON.stringify(file)).not.toContain('#/components/');
  });

  it('environments — 표준 env 아홉 · 중복 없음 · API 가 무시한다고 말한다', () => {
    const env = (file.properties as Record<string, Node>)['environments']!;
    expect((env.items as Node).enum).toEqual([...ENV_VALUES]);
    expect(env.uniqueItems).toBe(true);
    expect(String(env.description)).toMatch(/^Ignored by the API/);
  });

  it('Save plan 이 내려준 파일(환경 하나 · 여럿)이 스키마에 맞는다 · 모르는 키 · 중복 환경 · 표준 아닌 env 는 틀리다', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(file);
    const one = savePlan(encodeWizardState(FULL_PLAN, VERSION.rules)!, VERSION.rules)!.file;
    const many = savePlan(encodeWizardState(FULL_PLAN, VERSION.rules, ['stg', 'dev'])!, VERSION.rules)!.file;
    expect(validate(one), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(many), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...one, extra: 1 })).toBe(false);
    // $schema 는 받는다 — 에디터가 단 파일이 스키마에 맞아야 한다 · 문자열만
    expect(validate({ $schema: 'https://example.com/plan.schema.json', ...one }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...one, $schema: 1 })).toBe(false);
    expect(validate({ ...many, environments: ['prod', 'prod'] })).toBe(false);
    expect(validate({ ...many, environments: ['prod', 'preprod'] })).toBe(false);
    // custom pick 의 null 칸(preset · ha · serverless)도 맞는다 — nullable 을 옮겼다
    expect(validate({ ...one, services: [{ purpose: 'shop', picks: [{ preset: null, rule: 'gcp.cloud_function', ha: null, serverless: null, instances: [{ id: 'a', seq: '01' }] }] }] })).toBe(true);
  });
});
