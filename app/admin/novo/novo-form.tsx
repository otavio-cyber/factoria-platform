"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { slugify } from "@/lib/tenants/slug";
import { criarRestaurante, type NovoRestauranteState } from "./actions";

const FUSOS = [
  ["America/Sao_Paulo", "Brasília (SP, RJ, MG, Sul, NE...)"],
  ["America/Manaus", "Amazonas"],
  ["America/Cuiaba", "Mato Grosso / MS"],
  ["America/Belem", "Pará / Amapá"],
  ["America/Fortaleza", "Ceará / Nordeste"],
  ["America/Recife", "Pernambuco"],
  ["America/Noronha", "Fernando de Noronha"],
  ["America/Rio_Branco", "Acre"],
];

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function NovoRestauranteForm() {
  const [state, action, pending] = useActionState<NovoRestauranteState, FormData>(criarRestaurante, { status: "idle" });
  const valores = state.status === "error" ? state.values : undefined;
  const erros = state.status === "error" ? state.fields ?? {} : {};
  const [slug, setSlug] = useState(valores?.slug ?? "");
  const [slugEditado, setSlugEditado] = useState(false);

  useEffect(() => {
    if (state.status === "error") toast.error(state.message);
    if (state.status === "ok") toast.success(`${state.name} criado.`);
  }, [state]);

  if (state.status === "ok") return <Sucesso state={state} />;

  return (
    <form action={action} className="space-y-5">

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Restaurante</legend>
        <Campo label="Nome" erro={erros.name}>
          <input name="name" required defaultValue={valores?.name} className={input}
            onChange={(e) => { if (!slugEditado) setSlug(slugify(e.target.value)); }} />
        </Campo>
        <Campo label="Endereço no painel" erro={erros.slug} dica={`app.factoria.dev.br/t/${slug || "…"}`}>
          <input name="slug" required value={slug} className={`${input} font-mono`}
            onChange={(e) => { setSlugEditado(true); setSlug(e.target.value.toLowerCase()); }} />
        </Campo>
        <Campo label="Fuso horário" erro={erros.timezone}>
          <select name="timezone" defaultValue={valores?.timezone ?? "America/Sao_Paulo"} className={input}>
            {FUSOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Campo>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Responsável (dono)</legend>
        <Campo label="Nome" erro={erros.ownerName}>
          <input name="ownerName" required defaultValue={valores?.ownerName} className={input} />
        </Campo>
        <Campo label="E-mail" erro={erros.ownerEmail}>
          <input name="ownerEmail" type="email" required autoComplete="off" defaultValue={valores?.ownerEmail} className={input} />
        </Campo>
        <Campo label="Confirme o e-mail" erro={erros.ownerEmailConfirm} dica="O link de acesso depende deste e-mail estar certo.">
          <input name="ownerEmailConfirm" type="email" required autoComplete="off" defaultValue={valores?.ownerEmailConfirm}
            className={input} onPaste={(e) => e.preventDefault()} />
        </Campo>
      </fieldset>

      <button type="submit" disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
        {pending ? "Criando..." : "Criar restaurante"}
      </button>
    </form>
  );
}

function Campo({ label, erro, dica, children }: { label: string; erro?: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {dica && !erro && <span className="block text-xs text-neutral-500">{dica}</span>}
      {erro && <span className="block text-xs text-red-600">{erro}</span>}
    </label>
  );
}

function Sucesso({ state }: { state: Extract<NovoRestauranteState, { status: "ok" }> }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="space-y-4 rounded-md border border-green-600/40 p-4">
      <p className="font-medium">✓ {state.name} criado em <span className="font-mono">/t/{state.slug}</span></p>
      <p className="text-sm">
        Atendimento (Chatwoot):{" "}
        {state.chatwoot.status === "ok" && <span className="text-green-600">configurado</span>}
        {state.chatwoot.status === "erro" && (
          <span className="text-amber-600">falhou ({state.chatwoot.message}). Use &quot;Tentar de novo&quot; na lista.</span>
        )}
        {state.chatwoot.status === "desativado" && <span className="text-neutral-500">integração não configurada neste ambiente</span>}
      </p>
      {state.activationUrl ? (
        <div className="space-y-2 text-sm">
          <p>
            Envie este link para <strong>{state.ownerEmail}</strong> criar a senha. Vale por <strong>48 horas</strong> e funciona uma vez só.
            Ele dá acesso à conta: mande direto para o dono, não em grupo.
          </p>
          <div className="flex gap-2">
            <input readOnly value={state.activationUrl} className={`${input} font-mono text-xs`} onFocus={(e) => e.target.select()} />
            <button type="button" className="rounded-md border px-3 text-sm dark:border-neutral-700"
              onClick={async () => { await navigator.clipboard.writeText(state.activationUrl!); setCopiado(true); }}>
              {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <p className="text-xs text-neutral-500">Este link não será mostrado de novo.</p>
        </div>
      ) : (
        <p className="text-sm">{state.ownerEmail} já tinha conta e foi vinculado como administrador. Ele entra com a senha que já usa.</p>
      )}
      <div className="flex gap-4 text-sm">
        <Link href="/admin" className="underline-offset-4 hover:underline">Voltar à lista</Link>
        <Link href={`/t/${state.slug}`} className="underline-offset-4 hover:underline">Abrir painel</Link>
      </div>
    </div>
  );
}
