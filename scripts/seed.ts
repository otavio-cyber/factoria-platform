/**
 * Seed de DESENVOLVIMENTO (docs/DECISOES.md): tenant "demo" + usuários de teste.
 * Idempotente: pode rodar várias vezes. Recusa rodar em produção.
 *
 *   pnpm db:seed
 *
 * Clientes reais NUNCA entram por aqui — só pelo onboarding do painel.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createAuth } from "@/lib/auth/config";
import { makeDb, withTenantOn } from "@/lib/db/core";
import { createCategoryOn, createItemOn, listMenuOn } from "@/lib/db/menu";
import { itemSchema } from "@/lib/menu/rules";
import { memberships, tenants, user } from "@/lib/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (process.env.NODE_ENV === "production") throw new Error("seed é só para desenvolvimento");

const SENHA = process.env.SEED_PASSWORD ?? "factoria-dev-123";
const USUARIOS = [
  { email: "admin@factoria.dev.br", name: "Admin Factoria", role: "super_admin" as const, tenantRole: null },
  { email: "dono@demo.factoria.dev.br", name: "Dono do Demo", role: "user" as const, tenantRole: "tenant_admin" as const },
  { email: "atendente@demo.factoria.dev.br", name: "Atendente Demo", role: "user" as const, tenantRole: "tenant_operator" as const },
];

async function main() {
  const owner = makeDb(process.env.MIGRATIONS_DATABASE_URL!, { max: 1 });
  const app = makeDb(process.env.DATABASE_URL!, { max: 2 });
  const auth = createAuth(app.db);

  try {
    // Tenant demo (criado pelo owner: o app não cria tenants).
    await owner.db.insert(tenants).values({ slug: "demo", name: "Restaurante Demo" }).onConflictDoNothing();
    const [demo] = await owner.db.select().from(tenants).where(eq(tenants.slug, "demo"));

    for (const u of USUARIOS) {
      let [existente] = await app.db.select().from(user).where(eq(user.email, u.email));
      if (!existente) {
        // Chamada interna (sem headers) = confiável; o cadastro público está desligado.
        await auth.api.createUser({ body: { email: u.email, password: SENHA, name: u.name, role: u.role } });
        [existente] = await app.db.select().from(user).where(eq(user.email, u.email));
      }
      if (u.tenantRole) {
        await withTenantOn(owner.db, demo.id, (tx) =>
          tx.insert(memberships).values({ tenantId: demo.id, userId: existente.id, role: u.tenantRole }).onConflictDoNothing(),
        );
      }
      console.log(`✓ ${u.email.padEnd(32)} ${u.tenantRole ?? u.role}`);
    }
    // Pedidos no demo: ligados, taxa e mínimo de R$ 20, e aberto o dia todo (para testar a qualquer hora).
    await withTenantOn(owner.db, demo.id, (tx) =>
      tx
        .update(tenants)
        .set({
          ordersEnabled: true,
          deliveryFeeCents: 2000,
          minOrderCents: 2000,
          openingHours: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, [["00:00", "23:59"]]])),
        })
        .where(eq(tenants.id, demo.id)),
    );

    // Cardápio de exemplo (só se o demo ainda não tiver cardápio).
    if ((await listMenuOn(app.db, demo.id)).length === 0) {
      const exemplo: Array<[string, string | null, Array<[string, string, string, string]>]> = [
        ["Churrasco Todo Dia", "Todos os pratos acompanham arroz branco, feijão, batata frita e farofa.", [
          ["Churras de Linguiça", "39,90", "31,90", "1"],
          ["Churras Bovino 250gr + Queijo", "49,00", "", "1"],
        ]],
        ["Carnes Assadas", null, [
          ["Picanha 200grs", "34,99", "", ""],
          ["Fraldinha 200grs", "18,99", "", ""],
        ]],
        ["Bebidas", null, [["Refrigerante lata", "7,00", "", "1"]]],
      ];
      for (const [cat, desc, itens] of exemplo) {
        const categoryId = await createCategoryOn(app.db, demo.id, { name: cat, description: desc, active: true });
        for (const [name, price, promoPrice, serves] of itens) {
          await createItemOn(app.db, demo.id, itemSchema.parse({ categoryId, name, description: "", price, promoPrice, serves, featured: promoPrice !== "" }));
        }
      }
      console.log("✓ cardápio de exemplo no demo");
    }
    console.log(`\nSenha de todos (dev): ${SENHA}\nPainel do demo: http://localhost:3000/t/demo`);
  } finally {
    await Promise.all([owner.close(), app.close()]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
