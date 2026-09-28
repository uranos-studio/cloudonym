# cloudonym

멀티클라우드(AWS · GCP · Azure) 인프라 리소스 이름 생성 · 검증 엔진. 무료 웹 UI + 엣지 API.

- 스택: TypeScript strict · React + Vite + Tailwind CSS + lucide-react · Hono · Cloudflare Workers(Static Assets + `@cloudflare/vite-plugin`)
- 구조: `src/core/`(순수 로직) · `src/api/`(Worker 엔트리 `src/api/index.ts`, `/v1/*`) · `src/components/`(UI)
- 참조 문서: `docs/reference/`

```bash
nvm use            # .nvmrc = 22
npm install
npm test           # vitest
npm run typecheck  # tsc -b
npm run build      # dist/client + dist/cloudonym
npm run dev        # vite + workerd
```
