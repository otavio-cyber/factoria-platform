/**
 * Autenticação e autorização por tenant, contra Postgres real + Better Auth real.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideTenantAccess } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/config";
import {
  getTenantRoleOn,
  listUserTenantsOn,
  makeDb,
  withTenantOn,
  withUserOn,
  type Db,
} from "@/lib/db/core";
import { contacts, memberships, tenants, user } from "@/lib/db/schema";

let app: Db;
let owner: Db;
let auth: ReturnType<typeof createAuth>;
const closers: Array<() => Promise<void>> = [];

const run = randomUUID().slice(0, 8);
const SENHA = "senha-de-teste-123";
const T = { a: { id: "", slug: `auth-a-${run}` }, b: { id: "", slug: `auth-b-${run}` } };
const U = { dono: "", outro: "", semVinculo: "" };
const emails = {
  dono: `dono-${run}@teste.local`,
  outro: `outro-${run}@teste.local`,
  semVinculo: `sem-${run}@teste.local`,
};

async function criarUsuario(email: string) {
  await auth.api.createUser({ body: { email, password: SENHA, name: email.split("@")[0], role: "user" } });
  const [u] = await app.select().from(user).where(eq(user.email, email));
  return u.id;
}

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  auth = createAuth(app);

  const [ta, tb] = await owner
    .insert(tenants)
    .values([
      { slug: T.a.slug, name: "Auth A" },
      { slug: T.b.slug, name: "Auth B" },
    ])
    .returning({ id: tenants.id });
  T.a.id = ta.id;
  T.b.id = tb.id;

  U.dono = await criarUsuario(emails.dono);
  U.outro = await criarUsuario(emails.outro);
  U.semVinculo = await criarUsuario(emails.semVinculo);

  await withTenantOn(owner, T.a.id, (tx) =>
    tx.insert(memberships).values([
      { tenantId: T.a.id, userId: U.dono, role: "tenant_admin" },
      { tenantId: T.a.id, userId: U.outro, role: "tenant_operator" },
    ]),
  );
  await withTenantOn(owner, T.b.id, (tx) =>
    tx.insert(memberships).values({ tenantId: T.b.id, userId: U.outro, role: "tenant_admin" }),
  );
  await withTenantOn(app, T.a.id, (tx) =>
    tx.insert(contacts).values({ tenantId: T.a.id, phone: "+5511988887777", name: "Contato A" }),
  );
});

afterAll(async () => {
  if (T.a.id && T.b.id) {
    for (const t of [T.a, T.b]) {
      await withTenantOn(owner, t.id, async (tx) => {
        await tx.execute(sql`delete from contacts`);
        await tx.execute(sql`delete from memberships`);
      });
    }
    await owner.delete(tenants).where(inArray(tenants.id, [T.a.id, T.b.id]));
  }
  const ids = Object.values(U).filter(Boolean);
  if (ids.length) await app.delete(user).where(inArray(user.id, ids)); // cascata: sessões e contas
  await Promise.all(closers.map((close) => close()));
});

describe("Better Auth", () => {
  it("login com e-mail e senha funciona para usuário criado pelo servidor", async () => {
    const res = await auth.api.signInEmail({ body: { email: emails.dono, password: SENHA } });
    expect(res.user.email).toBe(emails.dono);
    expect(res.token).toBeTruthy();
  });

  it("senha errada é recusada", async () => {
    await expect(auth.api.signInEmail({ body: { email: emails.dono, password: "errada-123456" } })).rejects.toThrow();
  });

  it("cadastro público está desligado", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: `invasor-${run}@teste.local`, password: SENHA, name: "x" } }),
    ).rejects.toThrow();
  });

  it("senha é guardada com hash (nunca em texto puro)", async () => {
    const [row] = await app.execute<{ password: string }>(
      sql`select password from account where user_id = ${U.dono} and provider_id = 'credential'`,
    );
    expect(row.password).toBeTruthy();
    expect(row.password).not.toContain(SENHA);
  });
});

describe("contexto do usuário (withUser)", () => {
  it("lista só os restaurantes do próprio usuário", async () => {
    const dono = await listUserTenantsOn(app, U.dono);
    const outro = await listUserTenantsOn(app, U.outro);
    const sem = await listUserTenantsOn(app, U.semVinculo);
    expect(dono.map((t) => [t.slug, t.role])).toEqual([[T.a.slug, "tenant_admin"]]);
    expect(outro.map((t) => t.slug).sort()).toEqual([T.a.slug, T.b.slug].sort());
    expect(sem).toEqual([]);
  });

  it("não enxerga memberships de outros usuários", async () => {
    const rows = await withUserOn(app, U.dono, (tx) => tx.select().from(memberships));
    expect(rows.every((m) => m.userId === U.dono)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  it("NÃO dá acesso a dados de negócio (contatos exigem withTenant)", async () => {
    const rows = await withUserOn(app, U.dono, (tx) => tx.select().from(contacts));
    expect(rows).toHaveLength(0);
  });

  it("não enxerga tenants onde não tem vínculo", async () => {
    const rows = await withUserOn(app, U.dono, (tx) => tx.select().from(tenants));
    expect(rows.map((t) => t.id)).toEqual([T.a.id]);
  });
});

describe("papel por tenant", () => {
  it("retorna o papel certo em cada tenant e null onde não há vínculo", async () => {
    expect(await getTenantRoleOn(app, T.a.id, U.dono)).toBe("tenant_admin");
    expect(await getTenantRoleOn(app, T.a.id, U.outro)).toBe("tenant_operator");
    expect(await getTenantRoleOn(app, T.b.id, U.outro)).toBe("tenant_admin");
    expect(await getTenantRoleOn(app, T.b.id, U.dono)).toBeNull();
    expect(await getTenantRoleOn(app, T.a.id, U.semVinculo)).toBeNull();
  });
});

describe("regra de acesso (decideTenantAccess)", () => {
  it("membro ativo entra com o próprio papel", () => {
    expect(decideTenantAccess({ userRole: "user", tenantStatus: "active", membershipRole: "tenant_operator" }))
      .toEqual({ allowed: true, role: "tenant_operator" });
  });

  it("sem vínculo, tenant inexistente ou suspenso → 404 (não revela existência)", () => {
    const negado = { allowed: false, reason: "not_found" };
    expect(decideTenantAccess({ userRole: "user", tenantStatus: "active", membershipRole: null })).toEqual(negado);
    expect(decideTenantAccess({ userRole: "user", tenantStatus: null, membershipRole: null })).toEqual(negado);
    expect(decideTenantAccess({ userRole: "user", tenantStatus: "suspended", membershipRole: "tenant_admin" })).toEqual(negado);
  });

  it("super_admin entra em qualquer tenant existente, inclusive suspenso", () => {
    expect(decideTenantAccess({ userRole: "super_admin", tenantStatus: "suspended", membershipRole: null }))
      .toEqual({ allowed: true, role: "super_admin" });
    expect(decideTenantAccess({ userRole: "super_admin", tenantStatus: null, membershipRole: null }))
      .toEqual({ allowed: false, reason: "not_found" });
  });
});
