import { defineConfig } from 'vitest/config'

// Vite 설정(cloudflare 플러그인)을 끌어오지 않도록 시험 설정을 따로 둔다
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
