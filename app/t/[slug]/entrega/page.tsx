import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { ordersDbApi, schema, withTenant } from "@/lib/db";
import { EntregaForm } from "./entrega-form";

export const metadata: Metadata = { title: "Entrega e pedidos" };

export default async function EntregaPage({ params }: PageProps<"/t/[slug]/entrega">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug);
  const [{ settings, districts, bands }, [info]] = await Promise.all([
    ordersDbApi.deliverySettings(tenant.id),
    withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants)),
  ]);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {info.name}</Link>
        <h1 className="text-xl font-semibold">Entrega e pedidos</h1>
        <p className="text-sm text-neutral-500">Como o cardápio online recebe pedidos: entrega, retirada, taxas e pedido mínimo.</p>
      </header>
      <EntregaForm
        slug={tenant.slug}
        podeEditar={role !== "tenant_operator"}
        settings={settings}
        districts={districts.map((d) => ({ id: d.id, name: d.name, feeCents: d.feeCents, active: d.active, distanceM: d.distanceM }))}
        bands={bands.map((b) => ({ fromM: b.fromM, toM: b.toM, feeCents: b.feeCents, returnFeeCents: b.returnFeeCents }))}
      />
    </main>
  );
}
