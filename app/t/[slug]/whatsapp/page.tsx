import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { schema, whatsappDbApi, withTenant } from "@/lib/db";
import { evolutionConfigured } from "@/lib/whatsapp/evolution";
import type { WhatsappStatus } from "@/lib/whatsapp/rules";
import { WhatsappPanel } from "./whatsapp-panel";

export const metadata: Metadata = { title: "WhatsApp" };

export default async function WhatsappPage({ params }: PageProps<"/t/[slug]/whatsapp">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug);
  const [conexao, [info]] = await Promise.all([
    whatsappDbApi.get(tenant.id),
    withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants)),
  ]);
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {info.name}</Link>
        <h1 className="text-xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-neutral-500">
          Conecte o WhatsApp do restaurante para avisar os clientes sobre o andamento do pedido.
        </p>
      </header>
      <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Conexão provisória (não oficial), como um WhatsApp Web. Use só para avisos de pedido e respostas;
        nunca para envio em massa. Continue abrindo o WhatsApp no celular pelo menos a cada 14 dias.
      </p>
      <WhatsappPanel
        key={`${conexao?.status ?? "disconnected"}-${conexao?.notifyOrders ?? false}`} // reinicia o estado ao mudar no servidor
        slug={tenant.slug}
        configurado={evolutionConfigured()}
        podeEditar={role !== "tenant_operator"}
        status={(conexao?.status as WhatsappStatus) ?? "disconnected"}
        telefone={conexao?.phone ?? null}
        avisos={conexao?.notifyOrders ?? false}
      />
    </main>
  );
}
