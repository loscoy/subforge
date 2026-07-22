import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'packages/*/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    globals: false,
  },
})
