import { defineConfig } from 'vitest/config';

const common = {
  globals: false,
  environment: 'node' as const,
  testTimeout: 120_000,
  hookTimeout: 120_000,
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...common,
          name: 'unit',
          include: ['packages/*/test/**/*.unit.test.ts', 'apps/*/test/**/*.unit.test.ts'],
        },
      },
      {
        test: {
          ...common,
          name: 'integration',
          include: ['packages/runtime/test/**/*.int.test.ts'],
          // Real Chromium sessions: serialize to keep resource usage bounded.
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        test: {
          ...common,
          name: 'mcp',
          include: ['packages/mcp-server/test/**/*.mcp.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        test: {
          ...common,
          name: 'e2e',
          include: ['test/e2e/**/*.e2e.test.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
