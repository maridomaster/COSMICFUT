import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // cada arquivo sobe seus servidores em portas aleatórias; serial evita disputa de CPU nos ticks
    fileParallelism: false,
  },
});
