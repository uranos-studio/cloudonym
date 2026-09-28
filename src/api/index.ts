// Worker 엔트리 — /v1/* 는 Hono 가 처리하고 나머지는 Workers Static Assets(SPA)가 서빙한다
import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>().basePath('/v1')

app.get('/health', (c) => c.json({ ok: true }))

export default app
