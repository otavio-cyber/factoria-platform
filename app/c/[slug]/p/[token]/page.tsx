/**
 * Acompanhamento do pedido (link que o cliente recebe). O token é longo e aleatório:
 * quem tem o link vê o pedido; ninguém consegue adivinhar o de outra pessoa.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getPublicMenu, ordersDbApi } from "@/lib/db";
import { formatBrl } from "@/lib/menu/rules";
import { ORDER_STATUS, PAYMENT_LABEL, statusSteps, type OrderStatus, type OrderType } from "@/lib/orders/rules";
import { APP_HOSTS } from "@/lib/tenants/app-hosts";
import { formatPhoneBr } from "@/lib/tenants/profile";
import { vitrineBase } from "@/lib/tenants/routing";
import { AutoRefresh } from "./auto-refresh";
import "../../vitrine.css";

export const metadata: Metadata = { title: "Acompanhar pedido", robots: { index: false } };

export default async function AcompanharPedido({ params }: PageProps<"/c/[slug]/p/[token]">) {
  const { slug, token } = await params;
  const m = await getPublicMenu(slug.toLowerCase());
  if (!m) notFound();
  const o = await ordersDbApi.byToken(m.tenantId, token);
  if (!o) notFound();
  const base = vitrineBase((await headers()).get("host"), m.slug, APP_HOSTS);
  const status = o.status as OrderStatus;
  const etapas = statusSteps(o.type as OrderType);
  const atual = etapas.indexOf(status);
  const finalizado = status === "delivered" || status === "canceled";

  return (
    <div className="vitrine">
      {!finalizado && <AutoRefresh segundos={20} />}
      <main className="v-conteudo v-checkout">
        <p className="v-tipo">{m.name}</p>
        <h1 className="v-nome">Pedido #{o.number}</h1>

        {status === "canceled" ? (
          <p className="v-erro">Pedido cancelado{o.cancelReason ? `: ${o.cancelReason}` : "."}</p>
        ) : (
          <ol className="v-etapas" aria-label="Andamento do pedido">
            {etapas.map((e, i) => (
              <li key={e} className={i < atual ? "v-feita" : i === atual ? "v-atual" : ""} aria-current={i === atual ? "step" : undefined}>
                {ORDER_STATUS[e]}
              </li>
            ))}
          </ol>
        )}
        {!finalizado && <p className="v-c-obs">Esta página se atualiza sozinha.</p>}

        <section className="v-bloco">
          <h2>{o.type === "delivery" ? "Entrega" : "Retirada no balcão"}</h2>
          {o.type === "delivery" ? (
            <p>
              {o.addressStreet}, {o.addressNumber}
              {o.addressComplement ? ` (${o.addressComplement})` : ""}
              <br />
              {o.addressDistrict}
              {o.addressCity ? `, ${o.addressCity}` : ""}
            </p>
          ) : (
            <p>Retire no restaurante quando o pedido estiver pronto.</p>
          )}
          {m.phone && <p>Dúvidas? Ligue <a href={`tel:${m.phone}`}>{formatPhoneBr(m.phone)}</a></p>}
        </section>

        <section className="v-bloco">
          <h2>Itens</h2>
          <ul className="v-carrinho">
            {o.items.map((i) => (
              <li key={i.id}>
                <div>
                  <p className="v-c-nome">{i.quantity}× {i.name}</p>
                  {i.notes && <p className="v-c-obs">{i.notes}</p>}
                </div>
                <p className="v-c-preco">{formatBrl(i.lineTotalCents)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="v-bloco v-resumo">
          <p><span>Subtotal</span><span>{formatBrl(o.subtotalCents)}</span></p>
          {o.type === "delivery" && (
            <p><span>Taxa de entrega</span><span>{o.feePending ? "a confirmar" : formatBrl(o.deliveryFeeCents)}</span></p>
          )}
          {o.returnFeeCents > 0 && <p><span>Taxa de retorno (maquininha)</span><span>{formatBrl(o.returnFeeCents)}</span></p>}
          <p className="v-total"><span>Total</span><span>{formatBrl(o.totalCents)}{o.feePending ? " + entrega" : ""}</span></p>
          {o.feePending && <p className="v-c-obs">O restaurante confirma o valor da entrega com você.</p>}
          <p className="v-c-obs">
            Pagamento: {PAYMENT_LABEL[o.paymentMethod as keyof typeof PAYMENT_LABEL]}
            {o.changeForCents ? `, troco para ${formatBrl(o.changeForCents)}` : ""}
          </p>
        </section>

        <p><a href={base || "/"} className="v-voltar">Voltar ao cardápio</a></p>
      </main>
    </div>
  );
}
