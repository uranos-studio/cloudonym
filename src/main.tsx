// 진입 — pathname 으로 화면(App — 뿌리는 마법사, /pick 은 트리) · 이름 안내(/docs/naming) · API 안내(/docs/api) · 개인정보(/privacy) · 소개(/about · D109) · 찾을 수 없음 중 하나를 그린다 (D57 · D106 · 라우터 의존성 없음).
// 쪽 사이는 링크로 새로 연다 — 제목(document.title)은 시작할 때 한 번, Worker 가 <title> 에 넣은 것과 같은 값으로 둔다
// 시험 전용 fixture(`?fixture=rules500` · `?fixture=conflict`)는 DEV 빌드에서만 들인다.
// 운영 빌드에서 import.meta.env.DEV 는 false 라 아래 동적 import 가 번들에서 빠진다 — scripts/check-bundle.mjs 가 fixture 문자열 0 을 센다
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { NamingDoc } from './components/NamingDoc'
import { ApiDoc } from './components/ApiDoc'
import { Privacy } from './components/Privacy'
import { About } from './components/About'
import { NotFound } from './components/NotFound'
import { Landing } from './components/Landing'
import { entryRedirect, routeOf } from './components/route'
import { pageText } from './site/copy'
import { captureCampaign, stripUtm } from './components/campaign'
import { sessionStore } from './components/beacon'
import type { ResourceRule } from './core/types'

async function start() {
  const route = routeOf(window.location.pathname)
  // 캠페인 출처(D122) — 첫 비콘보다 먼저 읽어 탭 세션에 두고, 주소창에서 utm_* 를 지운다(hash 는 남긴다)
  captureCampaign(window.location.search, sessionStore())
  const clean = stripUtm(window.location.pathname, window.location.search, window.location.hash)
  if (clean !== undefined) window.history.replaceState(window.history.state, '', clean)
  document.title = pageText(route).title
  // 경로와 다른 hash 는 진입 때 한 번 옮긴다 (D76 · D129) — 트리 꼴은 /pick, 다른 클라우드의 마법사 링크는 그 클라우드의 경로(query 도 실어 간다).
  // 옮기는 곳은 여기 하나다 — 마법사는 받은 클라우드를 믿는다
  const redirect = entryRedirect(route, window.location.search, window.location.hash)
  if (redirect !== undefined) {
    window.location.replace(redirect)
    return
  }
  const fixture = new URLSearchParams(window.location.search).get('fixture')
  let rules: readonly ResourceRule[] | undefined
  if (import.meta.env.DEV && fixture) rules = (await import('./dev/fixtureRules')).fixtureRules(fixture)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {route === 'naming' ? <NamingDoc /> : route === 'api' ? <ApiDoc /> : route === 'privacy' ? <Privacy /> : route === 'about' ? <About /> : route === 'notFound' ? <NotFound /> : route === 'home' ? <Landing /> : <App rules={rules} route={route} />}
    </StrictMode>,
  )
}

void start()
