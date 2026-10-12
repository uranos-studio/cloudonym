// 진입 — pathname 으로 화면(App — 뿌리는 마법사, /pick 은 트리) · 이름 안내(/docs/naming) · 개인정보(/privacy) 중 하나를 그린다 (D57 · 라우터 의존성 없음).
// 시험 전용 fixture(`?fixture=rules500` · `?fixture=conflict`)는 DEV 빌드에서만 들인다.
// 운영 빌드에서 import.meta.env.DEV 는 false 라 아래 동적 import 가 번들에서 빠진다 — scripts/check-bundle.mjs 가 fixture 문자열 0 을 센다
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { NamingDoc } from './components/NamingDoc'
import { Privacy } from './components/Privacy'
import { PICK_PATH, routeOf } from './components/route'
import { hashKind } from './components/urlState'
import type { ResourceRule } from './core/types'

async function start() {
  const route = routeOf(window.location.pathname)
  // 뿌리는 늘 마법사다 (D76) — 트리 꼴 hash 로 열면 트리 경로로 옮긴다(query 도 실어 간다)
  if (route === 'app' && hashKind(window.location.hash) === 'tree') {
    window.location.replace(PICK_PATH + window.location.search + window.location.hash)
    return
  }
  const fixture = new URLSearchParams(window.location.search).get('fixture')
  let rules: readonly ResourceRule[] | undefined
  if (import.meta.env.DEV && fixture) rules = (await import('./dev/fixtureRules')).fixtureRules(fixture)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {route === 'naming' ? <NamingDoc /> : route === 'privacy' ? <Privacy /> : <App rules={rules} route={route} />}
    </StrictMode>,
  )
}

void start()
