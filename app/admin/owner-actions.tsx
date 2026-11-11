"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { corrigirEmailDono, gerarNovoLink, type SuporteResult } from "./actions";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 text-sm dark:border-neutral-700";
const botao = "rounded-md border px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-900";

export function OwnerActions({ tenantId, userId, email }: { tenantId: string; userId: string; email: string }) {
  const [pending, start] = useTransition();
  const [modo, setModo] = useState<"nada" | "email">("nada");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  function tratar(r: SuporteResult, sucesso: string) {
    if (!r.ok) return void toast.error(r.message);
    toast.success(sucesso);
    setLink({ email: r.email, url: r.activationUrl });
    setModo("nada");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button type="button" disabled={pending} className={botao}
          onClick={() => start(async () => tratar(await gerarNovoLink(tenantId, userId), "Novo link gerado. Os links anteriores deixaram de funcionar."))}>
          Novo link
        </button>
        <button type="button" disabled={pending} className={botao} onClick={() => setModo(modo === "email" ? "nada" : "email")}>
          Corrigir e-mail
        </button>
      </div>

      {modo === "email" && (
        <form className="space-y-1" action={(fd) => start(async () => {
          const novo = String(fd.get("novo") ?? "");
          if (novo.trim().toLowerCase() !== String(fd.get("confirma") ?? "").trim().toLowerCase()) {
            return void toast.error("Os e-mails não conferem.");
          }
          tratar(await corrigirEmailDono(tenantId, userId, novo), "E-mail corrigido. Sessões antigas foram encerradas.");
        })}>
          <p className="text-xs text-neutral-500">Atual: {email}</p>
          <input name="novo" type="email" required placeholder="E-mail correto" className={input} autoComplete="off" />
          <input name="confirma" type="email" required placeholder="Repita o e-mail" className={input} autoComplete="off"
            onPaste={(e) => e.preventDefault()} />
          <button type="submit" disabled={pending} className={botao}>Salvar</button>
        </form>
      )}

      {link && (
        <div className="space-y-1 rounded-md border border-green-600/40 p-2">
          <p className="text-xs">Envie para <strong>{link.email}</strong> (48 h, uso único):</p>
          <div className="flex gap-1">
            <input readOnly value={link.url} className={`${input} font-mono text-xs`} onFocus={(e) => e.target.select()} />
            <button type="button" className={botao}
              onClick={async () => { await navigator.clipboard.writeText(link.url); toast.success("Link copiado."); }}>
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
