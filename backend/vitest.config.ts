import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 2026-06-11 — DATABASE_URL giả để test UNIT (hàm thuần) import được prisma-client
    // mà không cần DB thật (prisma init lazy, không connect). Test cần DB thật override
    // qua env runtime. Đảm bảo privacy-redact-regression chạy ở mọi máy/CI.
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/modules/**/*.ts', 'src/shared/**/*.ts'],
    },
  },
});
