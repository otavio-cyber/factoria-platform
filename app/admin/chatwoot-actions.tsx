"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { configurarAtendimento } from "./actions";

export function ChatwootStatus({ tenantId, accountId, error }: { tenantId: string; accountId: number | null; error: string | null }) {
  const [pending, start] = useTransition();
  const pronto = accountId && !error;
  return (
    <div className="space-y-1 text-xs">
      {pronto ? (
        <span className="text-green-600">Configurado (conta {accountId})</span>
      ) : error ? (
        <span className="text-amber-600" title={error}>Falhou: {error.length > 60 ? `${error.slice(0, 60)}…` : error}</span>
      ) : (
        <span className="text-neutral-500">Não configurado</span>
      )}
      {!pronto && (
        <div>
          <button type="button" disabled={pending}
            className="rounded-md border px-2 py-1 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            onClick={() => start(async () => {
              const r = await configurarAtendimento(tenantId);
              if (r.ok) toast.success("Atendimento configurado.");
              else toast.error(r.message);
            })}>
            {pending ? "Configurando..." : error ? "Tentar de novo" : "Configurar"}
          </button>
        </div>
      )}
    </div>
  );
}
