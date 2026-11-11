/**
 * Testes de isolamento entre tenants contra um Postgres REAL.
 *
 * - `app`   conecta como factoria_app   (DATABASE_URL)            → é como o sistema roda
 * - `owner` conecta como factoria_owner (MIGRATIONS_DATABASE_URL) → só para preparar dados
 *
 * Se algum destes testes falhar, NÃO faça merge: é vazamento de dados entre clientes.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDb, resolveTenantOn, withTenantOn, type Db } from "@/lib/db/core";
import { contacts, conversations, tenants } from "@/lib/db/schema";

let app: Db;
let owner: Db;
const closers: Array<() => Promise<void>> = [];

const run = randomUUID().slice(0, 8);
const A = { id: "", slug: `teste-a-${run}` };
const B = { id: "", slug: `teste-b-${run}` };
let contactA = "";

/** Extrai o código de erro do Postgres (o Drizzle embrulha o erro original em `cause`). */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

beforeAll(async () => {
  const a = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const o = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  app = a.db;
  owner = o.db;
  closers.push(a.close, o.close);

  // Tenants são criados pelo owner (o app não pode criar tenants).
  const [ta, tb] = await owner
    .insert(tenants)
    .values([
      { slug: A.slug, name: "Restaurante A" },
      { slug: B.slug, name: "Restaurante B" },
    ])
    .returning({ id: tenants.id });
  A.id = ta.id;
  B.id = tb.id;

  // Cada tenant grava os próprios dados PELO APP, como em produção.
  const [ca] = await withTenantOn(app, A.id, (tx) =>
    tx.insert(contacts).values({ tenantId: A.id, phone: "+5511999990001", name: "Cliente A" }).returning(),
  );
  contactA = ca.id;
  await withTenantOn(app, B.id, (tx) =>
    tx.insert(contacts).values({ tenantId: B.id, phone: "+5511999990002", name: "Cliente B" }),
  );
});

afterAll(async () => {
  // Se a preparação falhou (ex.: migrations não aplicadas), não há o que limpar.
  if (!A.id || !B.id) {
    await Promise.all(closers.map((close) => close()));
    return;
  }
  // Limpeza: filhos por tenant (FORCE RLS vale até para o owner), depois os tenants.
  for (const t of [A, B]) {
    if (!t.id) continue;
    await withTenantOn(owner, t.id, async (tx) => {
      for (const table of ["messages", "conversations", "reservations", "contacts", "memberships"]) {
        await tx.execute(sql.raw(`delete from ${table}`));
      }
    });
  }
  await owner.delete(tenants).where(sql`${tenants.id} in (${A.id}, ${B.id})`);
  await Promise.all(closers.map((close) => close()));
});

describe("papel do app no banco", () => {
  it("factoria_app não é superuser nem ignora RLS", async () => {
    const [role] = await app.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("isolamento de leitura", () => {
  it("tenant A enxerga só os próprios contatos", async () => {
    const rows = await withTenantOn(app, A.id, (tx) => tx.select().from(contacts));
    expect(rows.map((r) => r.name)).toEqual(["Cliente A"]);
  });

  it("tenant B não enxerga o contato de A nem buscando pelo id", async () => {
    const rows = await withTenantOn(app, B.id, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contactA)),
    );
    expect(rows).toHaveLength(0);
  });

  it("sem tenant definido o banco devolve ZERO linhas (fail-closed)", async () => {
    const rows = await app.select().from(contacts);
    expect(rows).toHaveLength(0);
  });

  it("o tenant não vaza para a próxima transação da mesma conexão", async () => {
    const single = makeDb(process.env.DATABASE_URL!, { max: 1 }); // força a mesma conexão
    try {
      await withTenantOn(single.db, A.id, (tx) => tx.select().from(contacts));
      const after = await single.db.select().from(contacts);
      expect(after).toHaveLength(0);
    } finally {
      await single.close();
    }
  });

  it("FORCE: nem o dono das tabelas lê sem tenant", async () => {
    const rows = await owner.select().from(contacts);
    expect(rows).toHaveLength(0);
  });
});

describe("isolamento de escrita", () => {
  it("B não consegue gravar um contato com o tenant_id de A", async () => {
    const code = await pgErrorCode(
      withTenantOn(app, B.id, (tx) =>
        tx.insert(contacts).values({ tenantId: A.id, phone: "+5511999990003" }),
      ),
    );
    expect(code).toBe("42501"); // violação de policy de RLS
  });

  it("B não consegue alterar nem apagar o contato de A", async () => {
    const updated = await withTenantOn(app, B.id, (tx) =>
      tx.update(contacts).set({ name: "hackeado" }).where(eq(contacts.id, contactA)).returning(),
    );
    const deleted = await withTenantOn(app, B.id, (tx) =>
      tx.delete(contacts).where(eq(contacts.id, contactA)).returning(),
    );
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    const still = await withTenantOn(app, A.id, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, contactA)),
    );
    expect(still[0]?.name).toBe("Cliente A");
  });

  it("B não consegue apontar uma conversa sua para um contato de A (FK composta)", async () => {
    const code = await pgErrorCode(
      withTenantOn(app, B.id, (tx) =>
        tx.insert(conversations).values({ tenantId: B.id, contactId: contactA }),
      ),
    );
    expect(code).toBe("23503"); // violação de chave estrangeira
  });

  it("o app não consegue desligar o RLS nem apagar tudo com TRUNCATE", async () => {
    expect(await pgErrorCode(app.execute(sql`alter table contacts disable row level security`))).toBe("42501");
    expect(await pgErrorCode(app.execute(sql`truncate contacts`))).toBe("42501");
  });
});

describe("tabela tenants", () => {
  it("o app enxerga só o próprio tenant", async () => {
    const rows = await withTenantOn(app, A.id, (tx) => tx.select().from(tenants));
    expect(rows.map((t) => t.id)).toEqual([A.id]);
  });

  it("o app não cria tenants nem muda plano/status", async () => {
    expect(
      await pgErrorCode(
        withTenantOn(app, A.id, (tx) => tx.insert(tenants).values({ slug: `x-${run}`, name: "x" })),
      ),
    ).toBe("42501");
    expect(
      await pgErrorCode(
        withTenantOn(app, A.id, (tx) => tx.update(tenants).set({ plan: "enterprise" }).where(eq(tenants.id, A.id))),
      ),
    ).toBe("42501");
  });

  it("o app pode renomear o próprio tenant, mas não o de outro", async () => {
    const own = await withTenantOn(app, A.id, (tx) =>
      tx.update(tenants).set({ name: "Restaurante A (novo)" }).where(eq(tenants.id, A.id)).returning(),
    );
    const other = await withTenantOn(app, A.id, (tx) =>
      tx.update(tenants).set({ name: "invadido" }).where(eq(tenants.id, B.id)).returning(),
    );
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });

  it("resolve o tenant pelo slug do subdomínio", async () => {
    expect((await resolveTenantOn(app, A.slug))?.id).toBe(A.id);
    expect((await resolveTenantOn(app, A.slug.toUpperCase()))?.id).toBe(A.id);
    expect(await resolveTenantOn(app, `nao-existe-${run}`)).toBeNull();
  });
});

describe("guarda-corpos", () => {
  it("withTenant recusa tenantId que não é UUID", async () => {
    await expect(withTenantOn(app, "' or 1=1 --", async () => 1)).rejects.toThrow(/UUID/);
  });

  it("TODA tabela com tenant_id tem RLS + FORCE + policy (trava para tabelas novas)", async () => {
    const rows = await owner.execute<{ table: string; rls: boolean; force: boolean; policies: number }>(sql`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      order by 1`);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const semProtecao = rows.filter((r) => !r.rls || !r.force || r.policies < 1).map((r) => r.table);
    expect(semProtecao, `tabelas com tenant_id sem RLS completo: ${semProtecao.join(", ")}`).toEqual([]);
  });
});
