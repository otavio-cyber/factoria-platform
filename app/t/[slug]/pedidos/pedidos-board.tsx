"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import type { OrderWithItems } from "@/lib/db";
import { formatBrl } from "@/lib/menu/rules";
import { nextStatus, ORDER_STATUS, PAYMENT_LABEL, type OrderStatus, type OrderType } from "@/lib/orders/rules";
import { formatPhoneBr } from "@/lib/tenants/profile";
import { avancarPedido, cancelarPedido } from "./actions";

const ACAO: Partial<Record<OrderStatus, string>> = {
  preparing: "Começar preparo",
  out_for_delivery: "Saiu para entrega",
  ready: "Pronto para retirada",
  delivered: "Marcar como entregue",
};

const GRUPOS: Array<{ titulo: string; status: OrderStatus[] }> = [
  { titulo: "Novos", status: ["received"] },
  { titulo: "Em preparo", status: ["preparing"] },
  { titulo: "Prontos e em entrega", status: ["ready", "out_for_delivery"] },
  { titulo: "Finalizados nas últimas 24 h", status: ["delivered", "canceled"] },
];

/** Bipe curto quando chega pedido novo (o navegador só toca depois de algum clique na página). */
function bipe() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {
    /* sem áudio */
  }
}

export function PedidosBoard({ slug, pedidos, timezone }: { slug: string; pedidos: OrderWithItems[]; timezone: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const novos = pedidos.filter((p) => p.status === "received").length;
  const anterior = useRef(novos);

  // Atualiza a lista a cada 15 s e avisa (som + título da aba) quando chega pedido novo.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (novos > anterior.current) {
      bipe();
      toast.success("Pedido novo!");
    }
    anterior.current = novos;
    document.title = novos > 0 ? `(${novos}) Pedidos` : "Pedidos";
  }, [novos]);

  const hora = (d: Date | string) =>
    new Date(d).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });

  const rodar = (fn: () => Promise<{ ok: boolean; message?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(r.message ?? "Erro");
      router.refresh();
    });

  if (pedidos.length === 0)
    return <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">Nenhum pedido nas últimas 24 horas.</p>;

  return (
    <div className="space-y-8">
      {GRUPOS.map((g) => {
        const lista = pedidos.filter((p) => g.status.includes(p.status as OrderStatus));
        if (lista.length === 0) return null;
        return (
          <section key={g.titulo} className="space-y-3">
            <h2 className="font-semibold">{g.titulo} ({lista.length})</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {lista.map((p) => {
                const prox = nextStatus(p.status as OrderStatus, p.type as OrderType);
                const fone = p.customerPhone.replace(/^\+/, "");
                return (
                  <li key={p.id} className={`space-y-2 rounded-md border p-4 dark:border-neutral-800 ${p.status === "received" ? "border-amber-400 dark:border-amber-600" : "border-neutral-200"}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-lg font-semibold">#{p.number} <span className="text-sm font-normal text-neutral-500">{hora(p.createdAt)}</span></p>
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800">
                        {p.type === "delivery" ? "Entrega" : "Retirada"} · {ORDER_STATUS[p.status as OrderStatus]}
                      </span>
                    </div>
                    <p className="text-sm">
                      <strong>{p.customerName}</strong>{" "}
                      <a className="text-neutral-500 hover:underline" href={`tel:${p.customerPhone}`}>{formatPhoneBr(p.customerPhone)}</a>{" "}
                      <a className="text-green-700 hover:underline dark:text-green-500" href={`https://wa.me/${fone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                    </p>
                    {p.type === "delivery" && (
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {p.addressStreet}, {p.addressNumber}{p.addressComplement ? ` (${p.addressComplement})` : ""} · {p.addressDistrict}
                        {p.addressReference ? ` · Ref.: ${p.addressReference}` : ""}
                      </p>
                    )}
                    <ul className="text-sm">
                      {p.items.map((i) => (
                        <li key={i.id}>
                          <strong>{i.quantity}×</strong> {i.name}
                          {i.notes && <span className="block pl-6 text-amber-800 dark:text-amber-300">Obs.: {i.notes}</span>}
                        </li>
                      ))}
                    </ul>
                    {p.notes && <p className="text-sm text-amber-800 dark:text-amber-300">Obs. do pedido: {p.notes}</p>}
                    <p className="text-sm">
                      <strong>{formatBrl(p.totalCents)}</strong>
                      {p.type === "delivery" && (
                        <span className={p.feePending ? "font-medium text-amber-700" : "text-neutral-500"}>
                          {p.feePending ? " (frete a confirmar com o cliente)" : ` (taxa ${formatBrl(p.deliveryFeeCents)}${p.returnFeeCents > 0 ? ` + retorno ${formatBrl(p.returnFeeCents)}` : ""})`}
                        </span>
                      )}
                      {" · "}{PAYMENT_LABEL[p.paymentMethod as keyof typeof PAYMENT_LABEL]}
                      {p.changeForCents ? ` · troco para ${formatBrl(p.changeForCents)}: levar ${formatBrl(p.changeForCents - p.totalCents)}` : ""}
                    </p>
                    {p.status === "canceled" && p.cancelReason && <p className="text-sm text-red-600">Motivo: {p.cancelReason}</p>}
                    {prox && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          disabled={pending}
                          className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
                          onClick={() => rodar(() => avancarPedido(slug, p.id, p.status), `Pedido #${p.number}: ${ORDER_STATUS[prox]}.`)}
                        >
                          {ACAO[prox]}
                        </button>
                        <button
                          disabled={pending}
                          className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-red-600 disabled:opacity-60 dark:border-neutral-700"
                          onClick={() => {
                            const motivo = prompt(`Cancelar o pedido #${p.number}? Informe o motivo (o cliente verá):`);
                            if (motivo === null) return;
                            rodar(() => cancelarPedido(slug, p.id, motivo), `Pedido #${p.number} cancelado.`);
                          }}
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
