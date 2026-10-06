// resourceType 은 공개 API 계약이다(/v1/names · /v1/generate 의 resource_type · 항목 key).
// 생성기가 만든 이름이 읽을 수 없는 꼴(io_t_central · ec2_i_pv4_pool · n_nh_…)이 되지 않게 표 전체를 본다.
import { describe, it, expect } from 'vitest';
import { RULES } from './constraints';

const types = Object.values(RULES).map((r) => `${r.provider}.${r.resourceType}`);

describe('resourceType 꼴', () => {
  it('소문자 · 숫자 낱말을 `_` 로 잇는다 · 40자 이하', () => {
    for (const r of Object.values(RULES)) {
      expect(r.resourceType, r.id).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(r.resourceType.length, r.id).toBeLessThanOrEqual(40);
    }
  });
  it('한 글자 토막이 없다 — `_a_` · 앞 `a_` · 끝 `_a` (예외 없음)', () => {
    expect(types.filter((t) => /(?:^|[._])[a-z0-9](?:_|$)/.test(t))).toEqual([]);
  });
  it('낙타 표기 약어가 쪼개진 꼴이 없다 — io_t · i_pv4 · signal_r', () => {
    expect(types.filter((t) => /(?:^|[._])(?:io_t|i_pv[46]|signal_r)(?:_|$)/.test(t))).toEqual([]);
  });
});

describe('displayName — 약어는 약어 꼴로', () => {
  // 생성기(scripts/rules/naming.mjs DISPLAY_ACRONYMS)가 낙타 표기를 낱말로 쪼갠 뒤 첫 글자만 대문자로 남기던 꼴(Vpn · Ssl · Nat …)
  const CAMEL = /\b(?:Acl|Api|Cdn|Dns|Grpc|Http|Https|Ip|Nat|Sql|Ssl|Tcp|Tls|Udp|Url|Vm|Vpc|Vpn)\b/;
  it('알려진 약어가 낙타 꼴로 남은 표시명이 없다', () => {
    expect(Object.values(RULES).filter((r) => CAMEL.test(r.displayName)).map((r) => `${r.id}: ${r.displayName}`)).toEqual([]);
  });
});
