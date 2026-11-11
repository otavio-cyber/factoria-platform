import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Parâmetros com _ são intencionais (ex.: _proof exige a prova de super admin só pelo tipo).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  // Multi-tenancy: código de negócio acessa o banco SÓ por `@/lib/db` (withTenant).
  // O núcleo (conexão crua) fica restrito a lib/db e aos testes.
  {
    files: ["**/*.{ts,tsx}"],
    // lib/onboarding: serviços de domínio que recebem a conexão por parâmetro (testáveis) e
    // exigem SuperAdminProof no tipo — por isso podem usar o núcleo do banco.
    ignores: ["lib/db/**", "lib/auth/**", "lib/onboarding/**", "tests/**", "scripts/**", "drizzle.config.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/db",
              importNames: ["appDb"],
              message: "appDb() é só para o Better Auth (lib/auth). Use withTenant/withUser.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/db/core", "**/lib/db/core", "drizzle-orm/postgres-js", "postgres"],
              message: "Use `withTenant` de `@/lib/db` — acesso cru ao banco ignora o isolamento por tenant.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "dist-scripts/**", // scripts compilados pelo esbuild (build:scripts)
  ]),
]);

export default eslintConfig;
