/**
 * Integração Chatwoot com um Chatwoot SIMULADO (registra chamadas, falha sob demanda).
 * O teste contra o Chatwoot real fica em tests/integration (só roda com CHATWOOT_PLATFORM_TOKEN).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueSuperAdminProof, type SuperAdminProof } from "@/lib/auth/access";
import { createAuth } from "@/lib/auth/config";
import { chatwootEmailFor, type ChatwootPlatform } from "@/lib/chatwoot/platform";
import { adminListTenantsOn, makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { chatwootUsers, memberships, tenants, user } from "@/lib/db/schema";
import { createTenantWithOwner } from "@/lib/onboarding/create-tenant";
import { chatwootLaunchUrl, provisionChatwoot } from "@/lib/onboarding/chatwoot";

class FakeChatwoot implements ChatwootPlatform {
  calls: string[] = [];
  users: Array<{ id: number; name: string; email: string }> = [];
  accountUsers: Array<{ accountId: number; userId: number; role: string }> = [];
  falharEm: string | null = null;
  private seq = 1000 + Math.floor(Math.random() * 1_000_000);
  private check(op: string) {
    this.calls.push(op);
    if (this.falharEm === op) throw new Error(`falha simulada em ${op}`);
  }
  async createAccount() {
    this.check("createAccount");
    return { id: ++this.seq };
  }
  async createUser(input: { name: string; email: string }) {
    this.check("createUser");
    const u = { id: ++this.seq, ...input };
    this.users.push(u);
    return { id: u.id };
  }
  async addAccountUser(input: { accountId: number; userId: number; role: "agent" | "administrator" }) {
    this.check("addAccountUser");
    this.accountUsers.push(input);
  }
  async ssoLoginUrl(userId: number) {
    this.check("ssoLoginUrl");
    return `https://chat.teste/app/login?sso_auth_token=tok-${userId}`;
  }
}

let app: Db;
let owner: Db;
let auth: ReturnType<typeof createAuth>;
const closers: Array<() => Promise<void>> = [];
const proof = issueSuperAdminProof({ id: "teste", role: "super_admin" }) as SuperAdminProof;
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const emails: string[] = [];
let R: Awaited<ReturnType<typeof createTenantWithOwner>>;

async function novoRestaurante(sufixo: string) {
  const email = `cw-${sufixo}-${run}@teste.local`;
  emails.push(email);
  const r = await createTenantWithOwner({ db: app, auth }, proof, {
    name: `CW ${sufixo}`, slug: `cw-${sufixo}-${run}`, timezone: "America/Sao_Paulo",
    ownerName: `Dono ${sufixo}`, ownerEmail: email,
  });
  tenantIds.push(r.tenantId);
  return r;
}

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  auth = createAuth(app);
  R = await novoRestaurante("a");
});

afterAll(async () => {
  for (const id of tenantIds) await withTenantOn(owner, id, (tx) => tx.execute(sql`delete from memberships`));
  if (tenantIds.length) await owner.delete(tenants).where(inArray(tenants.id, tenantIds));
  await app.delete(user).where(inArray(user.email, emails)); // cascata: chatwoot_users
  await Promise.all(closers.map((close) => close()));
});

describe("provisionChatwoot", () => {
  const cw = new FakeChatwoot();

  it("cria a conta do restaurante e o dono como AGENTE", async () => {
    const r = await provisionChatwoot({ db: app, cw }, proof, R.tenantId);
    expect(r.agents).toBe(1);
    expect(cw.calls).toEqual(["createAccount", "createUser", "addAccountUser"]);
    expect(cw.accountUsers[0]).toMatchObject({ accountId: r.accountId, role: "agent" });
    const t = (await adminListTenantsOn(app)).find((x) => x.id === R.tenantId)!;
    expect(t.chatwoot_account_id).toBe(r.accountId);
    expect(t.chatwoot_error).toBeNull();
  });

  it("usa e-mail técnico .invalid no Chatwoot, NUNCA o e-mail real do dono", () => {
    expect(cw.users[0].email).toBe(chatwootEmailFor(R.ownerUserId));
    expect(cw.users[0].email).toMatch(/@chatwoot\.factoria\.invalid$/);
    expect(cw.users.some((u) => emails.includes(u.email))).toBe(false);
  });

  it("repetir não duplica conta nem usuário (idempotente)", async () => {
    cw.calls = [];
    await provisionChatwoot({ db: app, cw }, proof, R.tenantId);
    expect(cw.calls).toEqual(["addAccountUser"]);
  });

  it("falha parcial fica registrada e 'tentar de novo' continua de onde parou", async () => {
    const B = await novoRestaurante("b");
    const cw2 = new FakeChatwoot();
    cw2.falharEm = "createUser";
    await expect(provisionChatwoot({ db: app, cw: cw2 }, proof, B.tenantId)).rejects.toThrow(/falha simulada/);
    let t = (await adminListTenantsOn(app)).find((x) => x.id === B.tenantId)!;
    expect(t.chatwoot_account_id).not.toBeNull(); // a conta já tinha sido criada
    expect(t.chatwoot_error).toMatch(/falha simulada em createUser/);

    cw2.falharEm = null;
    cw2.calls = [];
    await provisionChatwoot({ db: app, cw: cw2 }, proof, B.tenantId);
    expect(cw2.calls).toEqual(["createUser", "addAccountUser"]); // não recria a conta
    t = (await adminListTenantsOn(app)).find((x) => x.id === B.tenantId)!;
    expect(t.chatwoot_error).toBeNull();
  });
});

describe("proteções no banco", () => {
  it("o app NÃO grava a ligação usuário↔Chatwoot diretamente", async () => {
    await expect(app.insert(chatwootUsers).values({ userId: R.ownerUserId, chatwootUserId: 999999999 })).rejects.toThrow();
    await expect(app.update(chatwootUsers).set({ chatwootUserId: 1 }).where(eq(chatwootUsers.userId, R.ownerUserId))).rejects.toThrow();
  });

  it("o app NÃO troca a conta do Chatwoot de um restaurante", async () => {
    await expect(app.execute(sql`select factoria_admin_set_chatwoot_account(${R.tenantId}, 1)`)).rejects.toThrow(); // sem super admin
    await expect(
      withTenantOn(app, R.tenantId, (tx) => tx.update(tenants).set({ chatwootAccountId: 1 }).where(eq(tenants.id, R.tenantId))),
    ).rejects.toThrow(); // coluna sem permissão de UPDATE
  });
});

describe("chatwootLaunchUrl (Abrir atendimento)", () => {
  const cw = new FakeChatwoot();

  it("gera o link de login automático do próprio usuário", async () => {
    const [lig] = await app.select().from(chatwootUsers).where(eq(chatwootUsers.userId, R.ownerUserId));
    const url = await chatwootLaunchUrl({ db: app, cw }, { tenantId: R.tenantId, userId: R.ownerUserId });
    expect(url).toContain(`tok-${lig.chatwootUserId}`);
  });

  it("usuário sem ligação com o Chatwoot recebe mensagem clara", async () => {
    await expect(chatwootLaunchUrl({ db: app, cw }, { tenantId: R.tenantId, userId: "sem-ligacao" })).rejects.toThrow(
      /ainda não tem acesso/,
    );
  });

  it("restaurante sem atendimento configurado recebe mensagem clara", async () => {
    const C = await novoRestaurante("c");
    await expect(chatwootLaunchUrl({ db: app, cw }, { tenantId: C.tenantId, userId: C.ownerUserId })).rejects.toThrow(
      /ainda não foi configurado/,
    );
  });

  it("vínculo com o restaurante continua exigido pelo banco (dados do tenant isolados)", async () => {
    const rows = await withTenantOn(app, R.tenantId, (tx) => tx.select().from(memberships));
    expect(rows.every((m) => m.tenantId === R.tenantId)).toBe(true);
  });
});
