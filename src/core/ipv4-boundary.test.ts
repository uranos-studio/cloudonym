// IPv4 꼴 경계 (리뷰 M1) — 기준선 fixture 는 손대지 않으므로 경계 표본은 이 파일에 따로 둔다.
// 점 셋으로 이은 1~3자리 숫자 넷만 IPv4 꼴이다. 정규식이 {3} → {2,3} 처럼 느슨해지면 '1.2.3' 이 무효로 뒤집혀 여기서 걸린다
import { describe, it, expect } from 'vitest';
import { validateName } from './engine';

const ipv4 = (name: string) => validateName('aws', 's3_bucket', name).violations.some((v) => v.code === 'name.ipv4_form');

describe('S3 버킷 이름의 IPv4 꼴 경계', () => {
  it.each(['1.2.3.4', '999.1.1.1', '192.168.0.1'])('%s 는 IPv4 꼴이라 무효다', (name) => {
    expect(ipv4(name)).toBe(true);
    expect(validateName('aws', 's3_bucket', name).valid).toBe(false);
  });
  it.each(['1.2.3', '1.2.3.4.5', '1234.1.1.1', 'a1.2.3.4', '1.2.3.4a'])('%s 는 IPv4 꼴이 아니고 유효하다', (name) => {
    expect(ipv4(name)).toBe(false);
    expect(validateName('aws', 's3_bucket', name)).toEqual({ valid: true, violations: [] });
  });
});
