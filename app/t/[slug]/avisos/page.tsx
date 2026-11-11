import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantAccess } from "@/lib/auth";
import { orderAlertsDbApi, schema, withTenant } from "@/lib/db";
import { telegramConfigured } from "@/lib/telegram/client";
import { AvisosPanel } from "./avisos-panel";

export const metadata: Metadata = { title: "Avisos de pedido" };

export default async function AvisosPage({ params }: PageProps<"/t/[slug]/avisos">) {
  const { slug } = await params;
  const { tenant, role } = await requireTenantAccess(slug);
  const [cfg, [info]] = await Promise.all([
    orderAlertsDbApi.get(tenant.id),
    withTenant(tenant.id, (tx) => tx.select({ name: schema.tenants.name }).from(schema.tenants)),
  ]);
  const bot = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6">
      <header className="space-y-1">
        <Link href={`/t/${tenant.slug}`} className="text-sm text-neutral-500 hover:underline">← {info.name}</Link>
        <h1 className="text-xl font-semibold">Avisos de pedido</h1>
        <p className="text-sm text-neutral-500">
          Cada pedido novo do cardápio online chega no grupo da equipe no Telegram, com cliente, endereço, itens e pagamento.
        </p>
      </header>
      <AvisosPanel
        key={`${cfg.telegramChatId ?? ""}-${cfg.enabled}`} // reinicia o estado ao mudar no servidor
        slug={tenant.slug}
        configurado={telegramConfigured()}
        podeEditar={role !== "tenant_operator"}
        chatId={cfg.telegramChatId}
        ligado={cfg.enabled}
        bot={bot}
      />
    </main>
  );
}
