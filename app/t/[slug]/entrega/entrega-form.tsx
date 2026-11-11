"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { DeliverySettings } from "@/lib/db";
import { centsToInput, formatBrl } from "@/lib/menu/rules";
import { bandFor, metersToKm, PICKNGO_BANDS, type FeeBand } from "@/lib/orders/rules";
import { excluirBairro, salvarBairro, salvarEntrega, salvarFaixas, type EntregaResult } from "./actions";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 disabled:opacity-60 dark:border-neutral-700";
const primario = "rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";
const botao = "rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";
const pequeno = "rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700";

type Bairro = { id: string; name: string; feeCents: number; active: boolean; distanceM: number | null };
type Rodar = (fn: () => Promise<EntregaResult>, ok: string, depois?: () => void) => void;
const kmInput = (m: number | null) => (m === null ? "" : metersToKm(m));

export function EntregaForm({ slug, podeEditar, settings, districts, bands }: {
  slug: string;
  podeEditar: boolean;
  settings: DeliverySettings;
  districts: Bairro[];
  bands: FeeBand[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const porDistancia = bands.length > 0;
  const [f, setF] = useState({
    ordersEnabled: settings.ordersEnabled,
    deliveryEnabled: settings.deliveryEnabled,
    pickupEnabled: settings.pickupEnabled,
    minOrder: centsToInput(settings.minOrderCents),
    deliveryFee: centsToInput(settings.deliveryFeeCents),
    prepTime: settings.prepTime ?? "",
    unknownDistrictPolicy: settings.unknownDistrictPolicy,
  });
  const [novo, setNovo] = useState({ name: "", fee: "", distance: "" });
  const off = !podeEditar || pending;

  const rodar: Rodar = (fn, ok, depois) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(ok);
        depois?.();
        router.refresh();
      } else toast.error(r.message);
    });

  const semDistancia = porDistancia ? districts.filter((d) => d.active && d.distanceM === null) : [];
  const medidos = porDistancia ? districts.filter((d) => !(d.active && d.distanceM === null)) : districts;

  return (
    <div className="space-y-10">
      {!podeEditar && (
        <p className="rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-900">Somente leitura. Peça ao administrador para alterar.</p>
      )}

      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); rodar(() => salvarEntrega(slug, f), "Configuração salva."); }}>
        <label className="flex items-start gap-3 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
          <input type="checkbox" className="mt-1" checked={f.ordersEnabled} disabled={off}
            onChange={(e) => setF({ ...f, ordersEnabled: e.target.checked })} />
          <span>
            <span className="font-medium">Receber pedidos pelo cardápio online</span>
            <span className="block text-sm text-neutral-500">Desligado, o cardápio continua visível, mas sem o botão de pedir.</span>
          </span>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Como o cliente recebe</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.deliveryEnabled} disabled={off} onChange={(e) => setF({ ...f, deliveryEnabled: e.target.checked })} />
            Entrega
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.pickupEnabled} disabled={off} onChange={(e) => setF({ ...f, pickupEnabled: e.target.checked })} />
            Retirada no balcão
          </label>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          {!porDistancia && (
            <label className="block space-y-1">
              <span className="text-sm">Taxa de entrega padrão (R$)</span>
              <input value={f.deliveryFee} disabled={off} inputMode="decimal" onChange={(e) => setF({ ...f, deliveryFee: e.target.value })} className={input} />
              <span className="block text-xs text-neutral-500">Vale para bairros fora da tabela abaixo.</span>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-sm">Pedido mínimo (R$)</span>
            <input value={f.minOrder} disabled={off} inputMode="decimal" onChange={(e) => setF({ ...f, minOrder: e.target.value })} className={input} />
            <span className="block text-xs text-neutral-500">0 = sem mínimo. Vale para entrega e retirada.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm">Tempo estimado (opcional)</span>
            <input value={f.prepTime} disabled={off} maxLength={40} placeholder="40 a 60 min" onChange={(e) => setF({ ...f, prepTime: e.target.value })} className={input} />
          </label>
        </div>

        {porDistancia && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">Bairro sem distância cadastrada</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="politica" className="mt-1" checked={f.unknownDistrictPolicy === "confirm"} disabled={off}
                onChange={() => setF({ ...f, unknownDistrictPolicy: "confirm" })} />
              <span>Aceitar com <b>frete a confirmar</b>: o pedido entra, a equipe combina o valor com o cliente e o bairro aparece na lista abaixo para medir.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="politica" className="mt-1" checked={f.unknownDistrictPolicy === "block"} disabled={off}
                onChange={() => setF({ ...f, unknownDistrictPolicy: "block" })} />
              <span><b>Não entregar</b>: só aceita entrega em bairros com distância cadastrada.</span>
            </label>
          </fieldset>
        )}
        {podeEditar && <button type="submit" disabled={pending} className={primario}>{pending ? "Salvando..." : "Salvar"}</button>}
      </form>

      <FaixasEditor slug={slug} bands={bands} off={off} podeEditar={podeEditar} rodar={rodar} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{porDistancia ? "Distância por bairro" : "Taxa por bairro (opcional)"}</h2>
        <p className="text-sm text-neutral-500">
          {porDistancia
            ? "O cliente informa o CEP; o bairro vem dos Correios (ViaCEP) e o frete sai da faixa da distância. Use a distância de carro até o meio do bairro."
            : 'Bairros com taxa diferente da padrão. Marque "não entregamos" para bloquear um bairro.'}
        </p>

        {semDistancia.length > 0 && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="text-sm font-medium">Bairros sem distância ({semDistancia.length})</p>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">Apareceram em pedidos ou foram importados sem km. Enquanto não tiverem distância, o frete fica a confirmar.</p>
            <ul className="divide-y divide-amber-200 dark:divide-amber-900">
              {semDistancia.map((d) => (
                <BairroLinha key={d.id} slug={slug} bairro={d} off={off} rodar={rodar} podeEditar={podeEditar} porDistancia bands={bands} />
              ))}
            </ul>
          </div>
        )}

        {medidos.length === 0 && semDistancia.length === 0 && (
          <p className="text-sm text-neutral-500">{porDistancia ? "Nenhum bairro cadastrado ainda." : "Nenhum bairro na tabela: todos pagam a taxa padrão."}</p>
        )}
        {medidos.length > 0 && (
          <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {medidos.map((d) => (
              <BairroLinha key={d.id} slug={slug} bairro={d} off={off} rodar={rodar} podeEditar={podeEditar} porDistancia={porDistancia} bands={bands} />
            ))}
          </ul>
        )}

        {podeEditar && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
            e.preventDefault();
            rodar(
              () => salvarBairro(slug, null, porDistancia
                ? { name: novo.name, fee: "", distance: novo.distance, active: true }
                : { name: novo.name, fee: novo.fee, active: true }),
              "Bairro adicionado.",
              () => setNovo({ name: "", fee: "", distance: "" }),
            );
          }}>
            <label className="block flex-1 space-y-1">
              <span className="text-sm">Bairro (como nos Correios)</span>
              <input value={novo.name} onChange={(e) => setNovo({ ...novo, name: e.target.value })} className={input} />
            </label>
            {porDistancia ? (
              <label className="block w-32 space-y-1">
                <span className="text-sm">Distância (km)</span>
                <input value={novo.distance} inputMode="decimal" placeholder="3,5" onChange={(e) => setNovo({ ...novo, distance: e.target.value })} className={input} />
              </label>
            ) : (
              <label className="block w-32 space-y-1">
                <span className="text-sm">Taxa (R$)</span>
                <input value={novo.fee} inputMode="decimal" onChange={(e) => setNovo({ ...novo, fee: e.target.value })} className={input} />
              </label>
            )}
            <button type="submit" disabled={pending} className={primario}>Adicionar</button>
          </form>
        )}
      </section>
    </div>
  );
}

function FaixasEditor({ slug, bands, off, podeEditar, rodar }: { slug: string; bands: FeeBand[]; off: boolean; podeEditar: boolean; rodar: Rodar }) {
  const inicial = bands.map((b) => ({ ateKm: metersToKm(b.toM), frete: centsToInput(b.feeCents), retorno: centsToInput(b.returnFeeCents) }));
  const [linhas, setLinhas] = useState(inicial);
  const set = (i: number, k: "ateKm" | "frete" | "retorno", v: string) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const deKm = (i: number) => (i === 0 ? "0" : linhas[i - 1].ateKm || "?");

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Frete por distância (opcional)</h2>
      <p className="text-sm text-neutral-500">
        Com faixas cadastradas, o frete sai da distância do bairro e o CEP passa a ser obrigatório na entrega. A taxa de retorno é somada
        quando o pagamento é na maquininha (cartão ou Pix). Sem faixas, vale a taxa por bairro.
      </p>
      {linhas.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="py-1 font-normal">De (km)</th><th className="py-1 font-normal">Até (km)</th>
              <th className="py-1 font-normal">Frete (R$)</th><th className="py-1 font-normal">Retorno (R$)</th><th />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2 text-neutral-500">{deKm(i)}</td>
                <td className="py-1 pr-2"><input value={l.ateKm} disabled={off} inputMode="decimal" aria-label={`Faixa ${i + 1}: até km`} onChange={(e) => set(i, "ateKm", e.target.value)} className={`w-20 ${pequeno}`} /></td>
                <td className="py-1 pr-2"><input value={l.frete} disabled={off} inputMode="decimal" aria-label={`Faixa ${i + 1}: frete`} onChange={(e) => set(i, "frete", e.target.value)} className={`w-24 ${pequeno}`} /></td>
                <td className="py-1 pr-2"><input value={l.retorno} disabled={off} inputMode="decimal" aria-label={`Faixa ${i + 1}: retorno`} onChange={(e) => set(i, "retorno", e.target.value)} className={`w-24 ${pequeno}`} /></td>
                <td className="py-1">{podeEditar && <button type="button" className={botao} disabled={off} onClick={() => setLinhas((x) => x.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {podeEditar && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={botao} disabled={off} onClick={() => setLinhas((x) => [...x, { ateKm: "", frete: "", retorno: "" }])}>+ Faixa</button>
          <button type="button" className={botao} disabled={off} onClick={() => setLinhas(PICKNGO_BANDS)}>Usar tabela Pick&apos;n&apos;Go</button>
          <button type="button" className={primario} disabled={off}
            onClick={() => {
              if (linhas.length === 0 && bands.length > 0 && !confirm("Remover todas as faixas e voltar ao frete por bairro?")) return;
              rodar(() => salvarFaixas(slug, linhas), linhas.length ? "Faixas salvas." : "Faixas removidas: frete por bairro.");
            }}>
            Salvar faixas
          </button>
        </div>
      )}
    </section>
  );
}

function BairroLinha({ slug, bairro, off, rodar, podeEditar, porDistancia, bands }: {
  slug: string;
  bairro: Bairro;
  off: boolean;
  podeEditar: boolean;
  porDistancia: boolean;
  bands: FeeBand[];
  rodar: Rodar;
}) {
  const [fee, setFee] = useState(centsToInput(bairro.feeCents));
  const [km, setKm] = useState(kmInput(bairro.distanceM));
  const faixa = porDistancia && bairro.distanceM !== null ? bandFor(bands, bairro.distanceM) : null;
  const valor = porDistancia ? { name: bairro.name, fee: "", distance: km } : { name: bairro.name, fee };
  const resumo = !bairro.active
    ? "não entregamos"
    : porDistancia
      ? bairro.distanceM === null ? "sem distância" : faixa ? `${formatBrl(faixa.feeCents)} (+${formatBrl(faixa.returnFeeCents)} retorno)` : "fora da área"
      : formatBrl(bairro.feeCents);
  return (
    <li className="flex flex-wrap items-center gap-3 p-3 text-sm">
      <span className="flex-1 font-medium">{bairro.name}</span>
      {podeEditar ? (
        <>
          {porDistancia ? (
            <span className="flex items-center gap-1">
              <input value={km} disabled={off} inputMode="decimal" placeholder="km" aria-label={`Distância de ${bairro.name} em km`}
                onChange={(e) => setKm(e.target.value)} className={`w-20 ${pequeno}`} />
              km <span className="w-40 text-neutral-500">{resumo}</span>
            </span>
          ) : (
            <input value={fee} disabled={off} inputMode="decimal" aria-label={`Taxa de ${bairro.name}`}
              onChange={(e) => setFee(e.target.value)} className={`w-24 ${pequeno}`} />
          )}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!bairro.active} disabled={off}
              onChange={(e) => rodar(() => salvarBairro(slug, bairro.id, { ...valor, active: !e.target.checked }), "Bairro atualizado.")} />
            não entregamos
          </label>
          <button className={botao} disabled={off} onClick={() => rodar(() => salvarBairro(slug, bairro.id, { ...valor, active: bairro.active }), "Bairro salvo.")}>Salvar</button>
          <button className={botao} disabled={off} onClick={() => { if (confirm(`Remover ${bairro.name}?`)) rodar(() => excluirBairro(slug, bairro.id), "Bairro removido."); }}>Remover</button>
        </>
      ) : (
        <span>{porDistancia && bairro.distanceM !== null ? `${metersToKm(bairro.distanceM)} km · ` : ""}{resumo}</span>
      )}
    </li>
  );
}
