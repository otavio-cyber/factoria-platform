/**
 * Configuração do Better Auth — sem `server-only` para a CLI do Better Auth conseguir ler.
 * O app usa `@/lib/auth` (index.ts), nunca este arquivo diretamente.
 *
 * Papéis:
 *  - GLOBAL (coluna user.role, plugin admin): "super_admin" (equipe Factoria) | "user"
 *  - POR TENANT (tabela memberships): "tenant_admin" | "tenant_operator"
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import type { Db } from "@/lib/db/core";
import { deliverResetLink } from "./activation";
import * as schema from "@/lib/db/schema";

export const GLOBAL_ROLES = ["super_admin", "user"] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

// Permissões do plugin admin: super_admin = todas as de admin; user = nenhuma administrativa.
const ac = createAccessControl(defaultStatements);
const roles = {
  super_admin: ac.newRole({ ...adminAc.statements }),
  user: ac.newRole({ ...userAc.statements }),
};

export function createAuth(db: Db) {
  return betterAuth({
    appName: "Factoria",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: "pg", schema }),

    emailAndPassword: {
      enabled: true,
      // Ninguém se cadastra sozinho: usuários são criados pelo onboarding (super_admin).
      disableSignUp: true,
      minPasswordLength: 10,
      autoSignIn: false,
      // Ativação de conta nova e "esqueci a senha" usam o mesmo fluxo de redefinição.
      sendResetPassword: ({ user, url }) => deliverResetLink({ email: user.email, url }),
      resetPasswordTokenExpiresIn: 60 * 60 * 48, // 48 h: tempo para o dono abrir o link
      revokeSessionsOnPasswordReset: true,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 dias
      updateAge: 60 * 60 * 24, // renova 1x por dia de uso
    },

    rateLimit: {
      enabled: true, // login/brute force limitados também em dev (default seria só produção)
      window: 60,
      max: 30,
    },

    advanced: {
      // Atrás do Cloudflare Tunnel o IP real do cliente vem neste header.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
      // Cookies SEM domínio compartilhado (host-only): factoria.dev.br tem sites de outros
      // clientes (Vercel) — um cookie em .factoria.dev.br seria enviado para eles.
      crossSubDomainCookies: { enabled: false },
      useSecureCookies: process.env.NODE_ENV === "production",
    },

    plugins: [
      admin({
        ac,
        roles,
        adminRoles: ["super_admin"],
        defaultRole: "user",
        impersonationSessionDuration: 60 * 30, // suporte "entrar como" limitado a 30 min
      }),
      nextCookies(), // precisa ser o último: grava cookies a partir de Server Actions
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
