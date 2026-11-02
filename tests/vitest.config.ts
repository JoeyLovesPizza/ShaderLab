// A plain object rather than `defineConfig` from 'vitest/config', so the
// file also loads when vitest runs from the npx cache and is not in
// node_modules. Node environment: the modules under test are the pure ones
// (validate, shuffle, pack, palette); anything touching WebGL or the DOM
// is covered by scripts/smoke.mjs instead.
export default {
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}
