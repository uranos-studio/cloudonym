import { describe, expect, it } from 'vitest'
import { collapseHyphens } from './normalize'

describe('collapseHyphens', () => {
  it('연속 하이픈을 하나로 줄인다', () => {
    expect(collapseHyphens('prod--web---api')).toBe('prod-web-api')
  })

  it('하이픈이 하나뿐이면 그대로 둔다', () => {
    expect(collapseHyphens('prod-web')).toBe('prod-web')
  })

  it('빈 문자열은 빈 문자열이다', () => {
    expect(collapseHyphens('')).toBe('')
  })
})
