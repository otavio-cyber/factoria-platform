import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // `server-only` quebra fora do Next (é o que impede import no browser); nos testes vira no-op.
      "server-only": path.resolve(import.meta.dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/support/env.ts"],
    fileParallelism: false, // testes de banco compartilham o mesmo Postgres
    testTimeout: 20_000,
  },
});
