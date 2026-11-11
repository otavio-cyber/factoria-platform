"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import type { WhatsappStatus } from "@/lib/whatsapp/rules";
import { avisosWhatsapp, conectarWhatsapp, desconectarWhatsapp, estadoWhatsapp, type WhatsappResult } from "./actions";

const primario = "rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";
const botao = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";

const ROTULO: Record<WhatsappStatus, string> = {
  connected: "Conectado",
  connecting: "Aguardando leitura do QR code",
  disconnected: "Desconectado",
};

const formatar = (d: string | null) =>
  d ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : null;

export function WhatsappPanel({ slug, configurado, podeEditar, status, telefone, avisos }: {
  slug: string;
  configurado: boolean;
  podeEditar: boolean;
  status: WhatsappStatus;
  telefone: string | null;
  avisos: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qr, setQr] = useState<string | null>(null);
  const [estado, setEstado] = useState<WhatsappStatus>(status);
  const off = !podeEditar || !configurado || pending;

  // Com o QR na tela: confere a cada 3 s se o celular já conectou; renova o QR a cada 40 s.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(async () => {
      const r = await estadoWhatsapp(slug);
      if (r.ok && r.status === "connected") {
        setQr(null);
        setEstado("connected");
        toast.success("WhatsApp conectado.");
        router.refresh();
      }
    }, 3000);
    const renova = setInterval(async () => {
      const r = await conectarWhatsapp(slug);
      if (r.ok && r.qr) setQr(r.qr);
    }, 40_000);
    return () => {
      clearInterval(t);
      clearInterval(renova);
    };
  }, [qr, slug, router]);

  const rodar = (fn: () => Promise<WhatsappResult>, depois: (r: Extract<WhatsappResult, { ok: true }>) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      depois(r);
    });

  if (!configurado) {
    return <p className="text-sm text-neutral-500">O WhatsApp ainda não está configurado no servidor. Fale com a Factoria.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-md border p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{ROTULO[estado]}</p>
            {estado === "connected" && telefone && <p className="text-sm text-neutral-500">{formatar(telefone)}</p>}
          </div>
          {estado === "connected" ? (
            <button
              className={botao}
              disabled={off}
              onClick={() => {
                if (!confirm("Desconectar o WhatsApp do sistema? O celular continua funcionando normalmente.")) return;
                rodar(() => desconectarWhatsapp(slug), () => {
                  setEstado("disconnected");
                  toast.success("WhatsApp desconectado do sistema.");
                  router.refresh();
                });
              }}
            >
              Desconectar
            </button>
          ) : (
            <button
              className={primario}
              disabled={off}
              onClick={() =>
                rodar(() => conectarWhatsapp(slug), (r) => {
                  if (r.status === "connected") {
                    setEstado("connected");
                    router.refresh();
                  } else {
                    setEstado("connecting");
                    setQr(r.qr ?? null);
                    if (!r.qr) toast.error("O QR code ainda não ficou pronto. Tente de novo em alguns segundos.");
                  }
                })
              }
            >
              {qr ? "Gerar novo QR code" : "Conectar WhatsApp"}
            </button>
          )}
        </div>

        {qr && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- imagem em data URL gerada na hora */}
            <img src={qr} alt="QR code para conectar o WhatsApp" width={264} height={264} className="rounded-md bg-white p-2" />
            <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600 dark:text-neutral-400">
              <li>No celular do restaurante, abra o WhatsApp Business.</li>
              <li>Toque em ⋮ (ou Configurações) → Aparelhos conectados → Conectar um aparelho.</li>
              <li>Aponte a câmera para este QR code.</li>
            </ol>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-md border p-4 dark:border-neutral-800">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={avisos}
            disabled={off}
            onChange={(e) => {
              const ligar = e.target.checked;
              rodar(() => avisosWhatsapp(slug, ligar), () => {
                toast.success(ligar ? "Avisos de pedido ligados." : "Avisos de pedido desligados.");
                router.refresh();
              });
            }}
          />
          <span>
            <span className="font-medium">Avisar o cliente sobre o pedido</span>
            <span className="block text-sm text-neutral-500">
              Mensagem automática quando o pedido é recebido, entra em preparo, sai para entrega (ou fica pronto para
              retirada), é entregue ou cancelado. Só para quem fez o pedido.
            </span>
          </span>
        </label>
      </section>
      {!podeEditar && <p className="text-sm text-neutral-500">Só o administrador do restaurante pode alterar o WhatsApp.</p>}
    </div>
  );
}
