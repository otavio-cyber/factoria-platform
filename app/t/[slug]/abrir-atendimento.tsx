"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { abrirAtendimento } from "./actions";

export function AbrirAtendimento({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900"
      onClick={() => start(async () => {
        const r = await abrirAtendimento(slug); // em caso de sucesso, redireciona e não retorna
        if (r?.message) toast.error(r.message);
      })}>
      {pending ? "Abrindo..." : "Abrir atendimento"}
    </button>
  );
}
