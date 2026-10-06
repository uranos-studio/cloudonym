// 진입 — 시험 전용 fixture(`?fixture=rules500` · `?fixture=conflict`)는 DEV 빌드에서만 들인다.
// 운영 빌드에서 import.meta.env.DEV 는 false 라 아래 동적 import 가 번들에서 빠진다 — scripts/check-bundle.mjs 가 fixture 문자열 0 을 센다
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import type { ResourceRule } from './core/types'

async function start() {
  const fixture = new URLSearchParams(window.location.search).get('fixture')
  let rules: readonly ResourceRule[] | undefined
  if (import.meta.env.DEV && fixture) rules = (await import('./dev/fixtureRules')).fixtureRules(fixture)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App rules={rules} />
    </StrictMode>,
  )
}

void start()
