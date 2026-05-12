import { defineConfig } from 'vitest/config';

// Iter 110 — vitest scaffold. node:sqlite + node:net etc. are
// node-built-ins, so we run in the node environment. Tests live in
// tests/ alongside src/ and import from './src/...'. Coverage left
// for a follow-up — the goal here is correctness gates, not
// reporting.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // node:sqlite needs DIALEROS_DB pointed somewhere writable; in
    // unit tests we use :memory: per-process so tests don't leak
    // state into the dev DB. DB-touching tests still need to
    // re-import db.ts fresh — that's iter 111+ territory.
    env: {
      DIALEROS_DB: ':memory:',
    },
  },
});
