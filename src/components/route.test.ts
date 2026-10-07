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
