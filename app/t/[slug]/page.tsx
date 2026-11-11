import { count } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { requireTenantAccess } from "@/lib/auth";
import { schema, withTenant } from "@/lib/db";
import { AbrirAtendimento } from "./abrir-atendimento";

const ROLE_LABEL = { super_admin: "Super admin (Factoria)", tenant_admin: "Administrador", tenant_operator: "Atendente" };

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function TenantHome({ params }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const { user, tenant, role } = await requireTenantAccess(slug); // 404 se não tiver acesso

  // Toda leitura de dados de negócio passa por withTenant (RLS garante o isolamento).
  const resumo = await withTenant(tenant.id, async (tx) => {
    const [info] = await tx.select({ name: schema.tenants.name, plan: schema.tenants.plan }).from(schema.tenants);
    const [contatos] = await tx.select({ n: count() }).from(schema.contacts);
    const [reservas] = await tx.select({ n: count() }).from(schema.reservations);
    return { ...info, contatos: contatos.n, reservas: reservas.n };
  });

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{resumo.name}</h1>
          <p className="text-sm text-neutral-500">
            {user.name} · {ROLE_LABEL[role]} · plano {resumo.plan}
          </p>
        </div>
        <nav className="flex items-center gap-4">
          {role !== "super_admin" && <AbrirAtendimento slug={tenant.slug} />}
          <Link href={`/t/${tenant.slug}/pedidos`} className="text-sm font-medium hover:underline">Pedidos</Link>
          <Link href={`/t/${tenant.slug}/whatsapp`} className="text-sm text-neutral-500 hover:underline">WhatsApp</Link>
          <Link href={`/t/${tenant.slug}/avisos`} className="text-sm text-neutral-500 hover:underline">Avisos de pedido</Link>
          <Link href={`/t/${tenant.slug}/cardapio`} className="text-sm text-neutral-500 hover:underline">Cardápio</Link>
          <Link href={`/t/${tenant.slug}/dados`} className="text-sm text-neutral-500 hover:underline">Dados do restaurante</Link>
          <Link href="/" className="text-sm text-neutral-500 hover:underline">Trocar restaurante</Link>
          <SignOutButton />
        </nav>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-md border p-4 dark:border-neutral-800">
          <p className="text-sm text-neutral-500">Contatos</p>
          <p className="text-2xl font-semibold">{resumo.contatos}</p>
        </div>
        <div className="rounded-md border p-4 dark:border-neutral-800">
          <p className="text-sm text-neutral-500">Reservas</p>
          <p className="text-2xl font-semibold">{resumo.reservas}</p>
        </div>
      </section>
    </main>
  );
}
