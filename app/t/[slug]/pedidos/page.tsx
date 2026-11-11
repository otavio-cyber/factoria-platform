import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { ordersDbApi, schema, withTenant } from "@/lib/db";
import { PedidosBoard } from "./pedidos-board";

export const metadata: Metadata = { title: "Pedidos" };

export default async function PedidosPage({ params }: PageProps<"/t/[slug]/pedidos">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug);
  const [pedidos, [info]] = await Promise.all([
    ordersDbApi.list(tenant.id),
    withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name, enabled: schema.tenants.ordersEnabled }).from(schema.tenants)),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {info.name}</Link>
          <h1 className="text-xl font-semibold">Pedidos</h1>
        </div>
        {role !== "tenant_operator" && (
          <Link href={`/t/${tenant.slug}/entrega`} className="text-sm text-neutral-500 hover:underline">Configurar entrega e pedidos</Link>
        )}
      </header>
      {!info.enabled && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          O cardápio online ainda não está recebendo pedidos.{" "}
          {role !== "tenant_operator" ? "Ligue em Configurar entrega e pedidos." : "Peça ao administrador para ligar."}
        </p>
      )}
      <PedidosBoard slug={tenant.slug} pedidos={pedidos} timezone={tenant.timezone} />
    </main>
  );
}
