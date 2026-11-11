/**
 * Permissões dos dados do restaurante no banco (Postgres real):
 * o app edita os dados operacionais SÓ do próprio tenant; dados fiscais só pela função do super admin.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminSetTenantFiscalOn, makeDb, withTenantOn, type Db } from "@/lib/db/core";
import { tenants } from "@/lib/db/schema";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];
const run = randomUUID().slice(0, 8);
const ids: string[] = [];

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);
  const rows = await owner
    .insert(tenants)
    .values([{ slug: `perfil-a-${run}`, name: "Perfil A" }, { slug: `perfil-b-${run}`, name: "Perfil B" }])
    .returning({ id: tenants.id });
  ids.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await owner.delete(tenants).where(inArray(tenants.id, ids));
  await Promise.all(closers.map((c) => c()));
});

describe("dados do restaurante", () => {
  it("o app atualiza os dados operacionais do próprio restaurante", async () => {
    const [A] = ids;
    await withTenantOn(app, A, (tx) =>
      tx.update(tenants).set({
        category: "churrascaria", phone: "+551133334444", addressZip: "01310100", addressState: "SP",
        openingHours: { "2": [["11:00", "15:00"]] },
      }).where(eq(tenants.id, A)),
    );
    const [t] = await owner.select().from(tenants).where(eq(tenants.id, A));
    expect(t).toMatchObject({ category: "churrascaria", phone: "+551133334444", openingHours: { "2": [["11:00", "15:00"]] } });
  });

  it("o app NÃO altera outro restaurante (RLS)", async () => {
    const [A, B] = ids;
    await withTenantOn(app, A, (tx) => tx.update(tenants).set({ category: "pizzaria" }).where(eq(tenants.id, B)));
    const [t] = await owner.select().from(tenants).where(eq(tenants.id, B));
    expect(t.category).toBeNull();
  });

  it("o app NÃO altera CNPJ nem razão social diretamente", async () => {
    const [A] = ids;
    await expect(
      withTenantOn(app, A, (tx) => tx.update(tenants).set({ cnpj: "11222333000181" }).where(eq(tenants.id, A))),
    ).rejects.toThrow();
    await expect(
      withTenantOn(app, A, (tx) => tx.update(tenants).set({ legalName: "X" }).where(eq(tenants.id, A))),
    ).rejects.toThrow();
  });

  it("dados fiscais só pela função do super admin", async () => {
    const [A] = ids;
    await expect(
      withTenantOn(app, A, (tx) => tx.execute(`select factoria_admin_set_tenant_fiscal('${A}', 'X', '11222333000181')`)),
    ).rejects.toThrow(); // sem contexto de super admin
    await adminSetTenantFiscalOn(app, A, { legalName: "Perfil A Ltda", cnpj: "11222333000181" });
    const [t] = await owner.select().from(tenants).where(eq(tenants.id, A));
    expect(t).toMatchObject({ legalName: "Perfil A Ltda", cnpj: "11222333000181" });
  });

  it("o banco recusa formatos inválidos mesmo se o app errar", async () => {
    const [A] = ids;
    await expect(
      withTenantOn(app, A, (tx) => tx.update(tenants).set({ category: "sushi" }).where(eq(tenants.id, A))),
    ).rejects.toThrow();
    await expect(
      withTenantOn(app, A, (tx) => tx.update(tenants).set({ addressState: "sp" }).where(eq(tenants.id, A))),
    ).rejects.toThrow();
    await expect(adminSetTenantFiscalOn(app, A, { legalName: null, cnpj: "123" })).rejects.toThrow();
  });
});

describe("domínio próprio", () => {
  it("só o super admin define; o domínio resolve para o restaurante; dois restaurantes não dividem domínio", async () => {
    const { adminSetCustomDomainOn } = await import("@/lib/db/core");
    const { resolveDomainOn } = await import("@/lib/db/public");
    const [A, B] = ids;
    const dom = `menu-${run}.exemplo.com.br`;
    await expect(withTenantOn(app, A, (tx) => tx.update(tenants).set({ customDomain: dom }).where(eq(tenants.id, A)))).rejects.toThrow();
    await adminSetCustomDomainOn(app, A, dom);
    expect(await resolveDomainOn(app, dom.toUpperCase())).toBe(`perfil-a-${run}`);
    expect(await resolveDomainOn(app, `nada-${run}.exemplo.com.br`)).toBeNull();
    await expect(adminSetCustomDomainOn(app, B, dom)).rejects.toThrow();
    await adminSetCustomDomainOn(app, A, null);
    expect(await resolveDomainOn(app, dom)).toBeNull();
  });
});
