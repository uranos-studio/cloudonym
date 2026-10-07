import { describe, it, expect } from 'vitest';
import { NAMING_PATH, PRIVACY_PATH, routeOf } from './route';

describe('routeOf — pathname 으로 화면 · 이름 안내 · 개인정보를 고른다 (D57)', () => {
  it.each([
    ['/', 'app'], ['', 'app'], ['/index.html', 'app'], ['/docs', 'app'], ['/docs/naming/extra', 'app'], ['/privacy-policy', 'app'],
    [NAMING_PATH, 'naming'], ['/docs/naming/', 'naming'], [PRIVACY_PATH, 'privacy'], ['/privacy/', 'privacy'],
  ])('%s → %s', (path, route) => {
    expect(routeOf(path)).toBe(route);
  });
});

import { withStateHash } from './route';

describe('withStateHash — 앱 ↔ 문서 링크가 상태 hash 를 실어 간다', () => {
  it('상태 hash 면 붙이고, 비었거나 다른 꼴이면 경로만', () => {
    expect(withStateHash(NAMING_PATH, '#state=eyJvd25lciI6ImEifQ')).toBe('/docs/naming#state=eyJvd25lciI6ImEifQ');
    expect(withStateHash('/', '#state=ab-_c+/d=')).toBe('/#state=ab-_c+/d=');
    expect(withStateHash(PRIVACY_PATH, '')).toBe('/privacy');
    expect(withStateHash('/', '#other')).toBe('/');
    expect(withStateHash('/', '#state=')).toBe('/');
    expect(withStateHash('/', '#state=a"><script>')).toBe('/');
  });
});
