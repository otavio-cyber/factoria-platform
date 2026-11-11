import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { menu, withTenant, schema } from "@/lib/db";
import { MenuEditor } from "./menu-editor";

export const metadata: Metadata = { title: "Cardápio" };

export default async function CardapioPage({ params }: PageProps<"/t/[slug]/cardapio">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug); // 404 se não tiver acesso
  const [arvore, [info]] = await Promise.all([
    menu.list(tenant.id),
    withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants)),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {info.name}</Link>
        <h1 className="text-xl font-semibold">Cardápio</h1>
        <p className="text-sm text-neutral-500">
          Um cardápio só para todos os canais: o cardápio online e o atendimento automático vão usar estes dados.
        </p>
      </header>
      <MenuEditor slug={tenant.slug} menu={arvore} podeEditar={role !== "tenant_operator"} />
    </main>
  );
}
