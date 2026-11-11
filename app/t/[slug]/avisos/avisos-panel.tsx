"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { salvarAvisos, testarAvisos } from "./actions";

const primario = "rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";
const botao = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";
const campo = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

export function AvisosPanel({ slug, configurado, podeEditar, chatId, ligado, bot }: {
  slug: string;
  configurado: boolean;
  podeEditar: boolean;
  chatId: string | null;
  ligado: boolean;
  bot: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chat, setChat] = useState(chatId ?? "");
  const [on, setOn] = useState(ligado);
  const off = !podeEditar || !configurado || pending;

  if (!configurado) {
    return <p className="text-sm text-neutral-500">O Telegram ainda não está configurado no servidor. Fale com a Factoria.</p>;
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-md border p-4 text-sm dark:border-neutral-800">
        <p className="font-medium">Como configurar</p>
        <ol className="list-decimal space-y-1 pl-5 text-neutral-600 dark:text-neutral-400">
          <li>No Telegram, crie um grupo para a equipe (ex.: “Pedidos {"<"}restaurante{">"}”).</li>
          <li>Adicione ao grupo o bot de avisos{bot ? <> <b>@{bot}</b></> : " da Factoria"} e quem deve receber os pedidos.</li>
          <li>Informe abaixo o ID do grupo (a Factoria passa esse número) e toque em “Enviar teste”.</li>
          <li>Chegou a mensagem de teste? Ligue os avisos e salve.</li>
        </ol>
        <p className="text-neutral-500">
          Os pedidos chegam com nome, telefone e endereço do cliente: deixe no grupo só quem trabalha com os pedidos.
        </p>
      </section>

      <form
        className="space-y-4 rounded-md border p-4 dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await salvarAvisos(slug, chat, on);
            if (!r.ok) return void toast.error(r.message);
            toast.success(on ? "Avisos ligados." : "Configuração salva. Avisos desligados.");
            router.refresh();
          });
        }}
      >
        <label className="block space-y-1">
          <span className="text-sm font-medium">ID do grupo no Telegram</span>
          <input
            className={campo}
            inputMode="numeric"
            placeholder="-1001234567890"
            value={chat}
            disabled={off}
            onChange={(e) => setChat(e.target.value.trim())}
          />
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={on} disabled={off} onChange={(e) => setOn(e.target.checked)} />
          <span>
            <span className="font-medium">Enviar cada pedido novo para o grupo</span>
            <span className="block text-sm text-neutral-500">Só pedidos novos. As mudanças de status ficam no painel.</span>
          </span>
        </label>
        <div className="flex gap-2">
          <button type="submit" className={primario} disabled={off}>Salvar</button>
          <button
            type="button"
            className={botao}
            disabled={off || chat === ""}
            onClick={() =>
              start(async () => {
                const r = await testarAvisos(slug, chat);
                if (!r.ok) return void toast.error(r.message);
                toast.success("Mensagem de teste enviada. Confira o grupo.");
              })
            }
          >
            Enviar teste
          </button>
        </div>
      </form>
      {!podeEditar && <p className="text-sm text-neutral-500">Só o administrador do restaurante pode alterar os avisos.</p>}
    </div>
  );
}
