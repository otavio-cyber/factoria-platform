/**
 * Núcleo do acesso ao banco — SEM singleton, para poder ser testado com qualquer conexão.
 * Código de negócio NÃO importa daqui: usa `@/lib/db` (withTenant / resolveTenantBySlug).
 * (Regra reforçada pelo ESLint: no-restricted-imports.)
 */
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { memberships, tenants } from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
/** Transação com o tenant já definido. É o único tipo que o código de negócio recebe. */
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function makeDb(url: string, options: { max?: number } = {}): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

/**
 * Executa `fn` numa transação em que o RLS enxerga APENAS `tenantId`.
 * `set_config(..., true)` vale só dentro desta transação — seguro com pool de conexões:
 * a próxima transação na mesma conexão volta a não ter tenant (fail-closed).
 */
export async function withTenantOn<T>(
  db: Db,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new Error("withTenant: tenantId precisa ser um UUID válido");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}

export type ResolvedTenant = { id: string; status: string; timezone: string };

/** Resolve o tenant pelo slug do subdomínio (função SECURITY DEFINER no banco). */
export async function resolveTenantOn(db: Db, slug: string): Promise<ResolvedTenant | null> {
  const rows = await db.execute<ResolvedTenant>(
    sql`select id, status, timezone from factoria_resolve_tenant(${slug})`,
  );
  return rows[0] ?? null;
}

/**
 * Contexto do USUÁRIO (sem tenant): enxerga só as próprias memberships e os tenants
 * onde tem membership. Usado logo após o login, para listar "meus restaurantes".
 */
export async function withUserOn<T>(
  db: Db,
  userId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!userId || userId.length > 128) throw new Error("withUser: userId inválido");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user', ${userId}, true)`);
    return fn(tx);
  });
}

export type TenantRole = "tenant_admin" | "tenant_operator";
export type UserTenant = { id: string; slug: string; name: string; status: string; role: TenantRole };

export function listUserTenantsOn(db: Db, userId: string): Promise<UserTenant[]> {
  return withUserOn(db, userId, (tx) =>
    tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        status: tenants.status,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(eq(memberships.userId, userId))
      .orderBy(tenants.name),
  ) as Promise<UserTenant[]>;
}

/** Papel do usuário NESTE tenant (null = sem acesso). */
export async function getTenantRoleOn(db: Db, tenantId: string, userId: string): Promise<TenantRole | null> {
  const rows = await withTenantOn(db, tenantId, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
      .limit(1),
  );
  return (rows[0]?.role as TenantRole | undefined) ?? null;
}

/**
 * Contexto de SUPER ADMIN: libera as funções factoria_admin_* (criar/listar tenants).
 * Só pode ser chamado depois de requireSuperAdmin() validar a sessão (lib/auth).
 * NÃO dá acesso a dados de negócio de nenhum tenant — isso continua exigindo withTenant().
 */
export async function withSuperAdminOn<T>(db: Db, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.is_super_admin', 'on', true)`);
    return fn(tx);
  });
}

export type AdminTenant = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  timezone: string;
  created_at: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_activated: boolean;
  chatwoot_account_id: number | null;
  chatwoot_error: string | null;
};

export function adminListTenantsOn(db: Db): Promise<AdminTenant[]> {
  return withSuperAdminOn(db, async (tx) =>
    Array.from(await tx.execute<AdminTenant>(sql`select * from factoria_admin_list_tenants()`)).map((t) => ({
      ...t,
      // bigint chega como string pelo driver
      chatwoot_account_id: t.chatwoot_account_id == null ? null : Number(t.chatwoot_account_id),
    })),
  );
}

export async function adminCreateTenantOn(
  db: Db,
  input: { slug: string; name: string; timezone: string },
): Promise<string> {
  const rows = await withSuperAdminOn(db, (tx) =>
    tx.execute<{ id: string }>(
      sql`select factoria_admin_create_tenant(${input.slug}, ${input.name}, ${input.timezone}) as id`,
    ),
  );
  return rows[0].id;
}

export async function adminSetTenantFiscalOn(
  db: Db,
  tenantId: string,
  input: { legalName: string | null; cnpj: string | null },
): Promise<void> {
  if (!isUuid(tenantId)) throw new Error("tenantId inválido");
  await withSuperAdminOn(db, (tx) =>
    tx.execute(sql`select factoria_admin_set_tenant_fiscal(${tenantId}, ${input.legalName}, ${input.cnpj})`),
  );
}

export async function adminSetCustomDomainOn(db: Db, tenantId: string, domain: string | null): Promise<void> {
  if (!isUuid(tenantId)) throw new Error("tenantId inválido");
  await withSuperAdminOn(db, (tx) => tx.execute(sql`select factoria_admin_set_custom_domain(${tenantId}, ${domain})`));
}
