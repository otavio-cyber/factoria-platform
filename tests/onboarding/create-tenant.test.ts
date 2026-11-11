/**
 * Onboarding de restaurante contra Postgres real + Better Auth real.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueSuperAdminProof, type SuperAdminProof } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/config";
import {
  adminCreateTenantOn,
  adminListTenantsOn,
  getTenantRoleOn,
  makeDb,
  resolveTenantOn,
  withTenantOn,
  type Db,
} from "@/lib/db/core";
import { tenants, user } from "@/lib/db/schema";
import { createTenantWithOwner, OnboardingError } from "@/lib/onboarding/create-tenant";
import { slugError, slugify } from "@/lib/tenants/slug";

let app: Db;
let owner: Db;
let auth: ReturnType<typeof createAuth>;
const closers: Array<() => Promise<void>> = [];
const proof = issueSuperAdminProof({ id: "teste", role: "super_admin" }) as SuperAdminProof;

const run = randomUUID().slice(0, 8);
const criados = { tenants: [] as string[], emails: [] as string[] };

beforeAll(() => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  auth = createAuth(app);
});

afterAll(async () => {
  for (const id of criados.tenants) {
    await withTenantOn(owner, id, (tx) => tx.execute(sql`delete from memberships`));
  }
  if (criados.tenants.length) await owner.delete(tenants).where(inArray(tenants.id, criados.tenants));
  if (criados.emails.length) await app.delete(user).where(inArray(user.email, criados.emails));
  await Promise.all(closers.map((close) => close()));
});

function dados(sufixo: string, email = `dono-${sufixo}-${run}@teste.local`) {
  criados.emails.push(email);
  return {
    name: `Restaurante ${sufixo}`,
    slug: `onb-${sufixo}-${run}`,
    timezone: "America/Sao_Paulo",
    ownerName: `Dono ${sufixo}`,
    ownerEmail: email,
  };
}

describe("slug", () => {
  it("sugere slug a partir do nome (sem acento, minúsculo, com hífen)", () => {
    expect(slugify("Casa Exemplo Grill & Bar")).toBe("casa-exemplo-grill-bar");
    expect(slugify("  Café São João  ")).toBe("cafe-sao-joao");
  });

  it("recusa formato inválido e nomes reservados", () => {
    expect(slugError("casaexemplo")).toBeNull();
    expect(slugError("a")).not.toBeNull();
    expect(slugError("-abc")).not.toBeNull();
    expect(slugError("Maiusculo")).not.toBeNull();
    expect(slugError("admin")).toMatch(/reservado/);
    expect(slugError("dash")).toMatch(/reservado/); // nome reservado de serviço
  });
});

describe("funções de super admin no banco", () => {
  it("o app NÃO cria tenant sem o contexto de super admin", async () => {
    const code = await app
      .execute(sql`select factoria_admin_create_tenant(${`x-${run}`}, 'x', 'America/Sao_Paulo')`)
      .then(() => undefined)
      .catch((e) => (e as { cause?: { code?: string } }).cause?.code);
    expect(code).toBe("42501");
  });

  it("o app NÃO lista tenants sem o contexto de super admin", async () => {
    await expect(app.execute(sql`select * from factoria_admin_list_tenants()`)).rejects.toThrow();
  });

  it("recusa fuso horário inexistente", async () => {
    await expect(
      adminCreateTenantOn(app, { slug: `tz-${run}`, name: "x", timezone: "America/Atlantida" }),
    ).rejects.toThrow();
  });
});

describe("createTenantWithOwner", () => {
  let primeiro: Awaited<ReturnType<typeof createTenantWithOwner>>;
  const d1 = dados("um");

  it("cria restaurante + dono novo + vínculo tenant_admin + link de ativação", async () => {
    primeiro = await createTenantWithOwner({ db: app, auth }, proof, d1);
    criados.tenants.push(primeiro.tenantId);

    expect(primeiro.ownerIsNew).toBe(true);
    expect((await resolveTenantOn(app, d1.slug))?.id).toBe(primeiro.tenantId);
    expect(await getTenantRoleOn(app, primeiro.tenantId, primeiro.ownerUserId)).toBe("tenant_admin");
    expect(primeiro.activationUrl).toMatch(/\/api\/auth\/reset-password\/[\w-]+\?callbackURL=%2Fativar$/);
  });

  it("aparece na lista do super admin", async () => {
    const lista = await adminListTenantsOn(app);
    expect(lista.find((t) => t.id === primeiro.tenantId)?.slug).toBe(d1.slug);
  });

  it("o link de ativação permite o dono criar a senha e entrar", async () => {
    const token = new URL(primeiro.activationUrl!).pathname.split("/").pop()!;
    await auth.api.resetPassword({ body: { token, newPassword: "senha-do-dono-123" } });
    const login = await auth.api.signInEmail({ body: { email: d1.ownerEmail, password: "senha-do-dono-123" } });
    expect(login.user.id).toBe(primeiro.ownerUserId);
  });

  it("o link de ativação só funciona uma vez", async () => {
    const token = new URL(primeiro.activationUrl!).pathname.split("/").pop()!;
    await expect(auth.api.resetPassword({ body: { token, newPassword: "outra-senha-1234" } })).rejects.toThrow();
  });

  it("dono que já existe é reaproveitado (sem novo usuário, sem link)", async () => {
    const d2 = { ...dados("dois", d1.ownerEmail) };
    const segundo = await createTenantWithOwner({ db: app, auth }, proof, d2);
    criados.tenants.push(segundo.tenantId);

    expect(segundo.ownerIsNew).toBe(false);
    expect(segundo.ownerUserId).toBe(primeiro.ownerUserId);
    expect(segundo.activationUrl).toBeNull();
    const usuarios = await app.select().from(user).where(eq(user.email, d1.ownerEmail));
    expect(usuarios).toHaveLength(1);
  });

  it("recusa slug já usado", async () => {
    await expect(
      createTenantWithOwner({ db: app, auth }, proof, { ...dados("tres"), slug: d1.slug }),
    ).rejects.toBeInstanceOf(OnboardingError);
  });

  it("aceita e-mail com espaços e maiúsculas (limpa antes de validar)", async () => {
    const d = dados("cinco");
    const r = await createTenantWithOwner({ db: app, auth }, proof, { ...d, ownerEmail: `  ${d.ownerEmail.toUpperCase()}  ` });
    criados.tenants.push(r.tenantId);
    const [u] = await app.select().from(user).where(eq(user.id, r.ownerUserId));
    expect(u.email).toBe(d.ownerEmail);
  });

  it("recusa slug reservado antes de criar qualquer coisa", async () => {
    const d = dados("quatro");
    await expect(createTenantWithOwner({ db: app, auth }, proof, { ...d, slug: "admin" })).rejects.toThrow();
    const usuarios = await app.select().from(user).where(eq(user.email, d.ownerEmail));
    expect(usuarios).toHaveLength(0);
  });

  it("o dono enxerga só o restaurante dele (isolamento continua valendo)", async () => {
    const [outro] = await owner.insert(tenants).values({ slug: `alheio-${run}`, name: "Alheio" }).returning();
    criados.tenants.push(outro.id);
    expect(await getTenantRoleOn(app, outro.id, primeiro.ownerUserId)).toBeNull();
  });
});
