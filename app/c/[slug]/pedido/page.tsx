import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicMenu, listPublicDistricts } from "@/lib/db";
import { NO_BANDS } from "@/lib/orders/rules";
import { APP_HOSTS } from "@/lib/tenants/app-hosts";
import { openStatus } from "@/lib/tenants/profile";
import { vitrineBase } from "@/lib/tenants/routing";
import { CartProvider } from "../cart";
import { CheckoutForm } from "./checkout-form";
import "../vitrine.css";

export const metadata: Metadata = { title: "Finalizar pedido", robots: { index: false } };

export default async function PedidoPage({ params }: PageProps<"/c/[slug]/pedido">) {
  const m = await getPublicMenu((await params).slug.toLowerCase());
  if (!m || !m.ordering.enabled) notFound();
  const base = vitrineBase((await headers()).get("host"), m.slug, APP_HOSTS);
  const pub = m.ordering.delivery ? await listPublicDistricts(m.tenantId) : { districts: [], delivery: NO_BANDS, tenantState: null };
  const aberto = openStatus(m.openingHours, m.timezone).state === "open";

  return (
    <CartProvider slug={m.slug}>
      <div className="vitrine">
        <main className="v-conteudo v-checkout">
          <p><a href={base || "/"} className="v-voltar">← Voltar ao cardápio</a></p>
          <h1 className="v-nome">Seu pedido</h1>
          <p className="v-tipo">{m.name}</p>
          <CheckoutForm
            slug={m.slug}
            base={base}
            aberto={aberto}
            ordering={m.ordering}
            districts={pub.districts}
            delivery={pub.delivery}
            tenantState={pub.tenantState}
          />
        </main>
      </div>
    </CartProvider>
  );
}
