/**
 * Suporte ao dono (super admin): lista com dono, novo link, correção de e-mail.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueSuperAdminProof, type SuperAdminProof } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/config";
import { adminListTenantsOn, makeDb, withSuperAdminOn, withTenantOn, type Db } from "@/lib/db/core";
import { contacts, memberships, tenants, user } from "@/lib/db/schema";
import { createTenantWithOwner, OnboardingError } from "@/lib/onboarding/create-tenant";
import { changeOwnerEmail, regenerateActivationLink } from "@/lib/onboarding/owner-support";

let app: Db;
let owner: Db;
let auth: ReturnType<typeof createAuth>;
const closers: Array<() => Promise<void>> = [];
const proof = issueSuperAdminProof({ id: "teste", role: "super_admin" }) as SuperAdminProof;
const run = randomUUID().slice(0, 8);
const emails: string[] = [];
const tenantIds: string[] = [];
const tokenDe = (url: string) => new URL(url).pathname.split("/").pop()!;

let A: Awaited<ReturnType<typeof createTenantWithOwner>>;
const emailErrado = `dono-errado-${run}@teste.local`;
const emailCerto = `dono-certo-${run}@teste.local`;

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  auth = createAuth(app);
  emails.push(emailErrado, emailCerto, `outro-${run}@teste.local`);

  A = await createTenantWithOwner({ db: app, auth }, proof, {
    name: "Suporte A", slug: `sup-a-${run}`, timezone: "America/Sao_Paulo",
    ownerName: "Dono A", ownerEmail: emailErrado,
  });
  tenantIds.push(A.tenantId);
  await withTenantOn(app, A.tenantId, (tx) =>
    tx.insert(contacts).values({ tenantId: A.tenantId, phone: "+5511977776666", name: "Cliente secreto" }),
  );
});

afterAll(async () => {
  for (const id of tenantIds) {
    await withTenantOn(owner, id, async (tx) => {
      await tx.execute(sql`delete from contacts`);
      await tx.execute(sql`delete from memberships`);
    });
  }
  if (tenantIds.length) await owner.delete(tenants).where(inArray(tenants.id, tenantIds));
  await app.delete(user).where(inArray(user.email, emails));
  await Promise.all(closers.map((close) => close()));
});

describe("lista do super admin", () => {
  it("mostra o dono e se ele já ativou a conta", async () => {
    const t = (await adminListTenantsOn(app)).find((x) => x.id === A.tenantId)!;
    expect(t.owner_email).toBe(emailErrado);
    expect(t.owner_user_id).toBe(A.ownerUserId);
    expect(t.owner_activated).toBe(false);
  });

  it("contexto de super admin vê vínculos, mas NÃO dados de negócio", async () => {
    const vinculos = await withSuperAdminOn(app, (tx) =>
      tx.select().from(memberships).where(eq(memberships.tenantId, A.tenantId)),
    );
    const clientes = await withSuperAdminOn(app, (tx) => tx.select().from(contacts));
    expect(vinculos.length).toBeGreaterThan(0);
    expect(clientes).toHaveLength(0);
  });

  it("sem o contexto de super admin, vínculos de outros continuam invisíveis", async () => {
    expect(await app.select().from(memberships)).toHaveLength(0);
  });
});

describe("novo link de ativação", () => {
  it("gera link novo e invalida o anterior", async () => {
    const antigo = A.activationUrl!;
    const { activationUrl: novo } = await regenerateActivationLink({ db: app, auth }, proof, {
      tenantId: A.tenantId, userId: A.ownerUserId,
    });
    expect(novo).not.toBe(antigo);
    await expect(auth.api.resetPassword({ body: { token: tokenDe(antigo), newPassword: "x-senha-1234" } })).rejects.toThrow();
  });

  it("recusa usuário que não é dono daquele restaurante", async () => {
    await expect(
      regenerateActivationLink({ db: app, auth }, proof, { tenantId: A.tenantId, userId: "usuario-qualquer" }),
    ).rejects.toBeInstanceOf(OnboardingError);
  });
});

describe("corrigir e-mail do dono", () => {
  it("troca o e-mail, gera link novo e o dono entra com o e-mail certo", async () => {
    const r = await changeOwnerEmail({ db: app, auth }, proof, {
      tenantId: A.tenantId, userId: A.ownerUserId, newEmail: `  ${emailCerto.toUpperCase()} `,
    });
    expect(r.email).toBe(emailCerto);

    await auth.api.resetPassword({ body: { token: tokenDe(r.activationUrl!), newPassword: "senha-certa-123" } });
    const login = await auth.api.signInEmail({ body: { email: emailCerto, password: "senha-certa-123" } });
    expect(login.user.id).toBe(A.ownerUserId);
    await expect(auth.api.signInEmail({ body: { email: emailErrado, password: "senha-certa-123" } })).rejects.toThrow();
  });

  it("depois de ativar, a lista mostra o dono como ativado", async () => {
    const t = (await adminListTenantsOn(app)).find((x) => x.id === A.tenantId)!;
    expect(t.owner_activated).toBe(true);
  });

  it("recusa e-mail já usado por outro usuário", async () => {
    const B = await createTenantWithOwner({ db: app, auth }, proof, {
      name: "Suporte B", slug: `sup-b-${run}`, timezone: "America/Sao_Paulo",
      ownerName: "Outro", ownerEmail: `outro-${run}@teste.local`,
    });
    tenantIds.push(B.tenantId);
    await expect(
      changeOwnerEmail({ db: app, auth }, proof, { tenantId: B.tenantId, userId: B.ownerUserId, newEmail: emailCerto }),
    ).rejects.toThrow(/outro usuário/);
  });

  it("recusa e-mail inválido", async () => {
    await expect(
      changeOwnerEmail({ db: app, auth }, proof, { tenantId: A.tenantId, userId: A.ownerUserId, newEmail: "nao-e-email" }),
    ).rejects.toThrow(/inválido/);
  });
});
