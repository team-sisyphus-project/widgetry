import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    /*
     * `e2e/` belongs to Playwright. Vitest's default include picks up
     * `*.spec.ts`, so without this the browser specs would be collected into
     * `npm run test` and fail on the first `page` reference.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-e2e/**', 'e2e/**'],
  },
})
