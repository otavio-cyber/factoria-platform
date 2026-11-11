"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatBrl } from "@/lib/menu/rules";
import { deliveryFee, type CepInfo, type DeliveryContext } from "@/lib/orders/rules";
import { onlyDigits, UFS } from "@/lib/tenants/profile";
import { useCart } from "../cart";
import { criarPedido } from "./actions";

type Ordering = { delivery: boolean; pickup: boolean; minOrderCents: number; deliveryFeeCents: number; prepTime: string | null };
type District = { name: string; nameKey: string; feeCents: number; active: boolean; distanceM: number | null };
type Endereco = { cep: string; logradouro: string; complemento: string; bairro: string; localidade: string; uf: string };

const LEMBRAR = "factoria:cliente"; // nome, telefone e endereço do último pedido (só neste navegador)

export function CheckoutForm({ slug, base, aberto, ordering, districts, delivery, tenantState }: {
  slug: string;
  base: string;
  aberto: boolean;
  ordering: Ordering;
  districts: District[];
  delivery: DeliveryContext;
  tenantState: string | null;
}) {
  const router = useRouter();
  const { lines, setQty, clear, subtotal, ready } = useCart();
  const [tipo, setTipo] = useState<"delivery" | "pickup">(ordering.delivery ? "delivery" : "pickup");
  const [f, setF] = useState({
    name: "", phone: "", zip: "", street: "", number: "", complement: "", district: "", city: "", state: "", reference: "",
    notes: "", paymentMethod: "" as "" | "cash" | "card" | "pix", changeFor: "",
  });
  const [erro, setErro] = useState<{ message: string; field?: string } | null>(null);
  const [cepInfo, setCepInfo] = useState<CepInfo | undefined>(undefined);
  const [busca, setBusca] = useState<{ aberta: boolean; rua: string; resultados: Endereco[]; carregando: boolean; msg: string | null }>({
    aberta: false, rua: "", resultados: [], carregando: false, msg: null,
  });
  const porDistancia = delivery.bands.length > 0;
  const [pending, start] = useTransition();

  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(LEMBRAR) ?? "null");
      if (salvo) {
        setF((v) => ({ ...v, ...salvo })); // eslint-disable-line react-hooks/set-state-in-effect -- preenche com o último pedido
        if (salvo.zip) void buscarCep(salvo.zip);
      }
    } catch {
      /* sem armazenamento */
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- só ao abrir a página

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((v) => ({ ...v, [k]: e.target.value }));

  // Mesmo cálculo do servidor (lá o CEP é consultado de novo e o valor é confirmado no envio).
  const frete = tipo === "delivery" ? deliveryFee(f.district, f.paymentMethod, ordering, districts, delivery, cepInfo) : null;
  const semCep = tipo === "delivery" && porDistancia && !cepInfo;
  const naoAtende = frete !== null && !frete.ok;
  const taxa = frete?.ok && !semCep ? frete.feeCents : 0;
  const retorno = frete?.ok && !semCep ? frete.returnFeeCents : 0;
  const aConfirmar = Boolean(frete?.ok && frete.pending && !semCep);
  const total = subtotal + taxa + retorno;
  const faltaMinimo = subtotal < ordering.minOrderCents;

  async function buscarCep(valor = f.zip) {
    const cep = onlyDigits(valor);
    if (cep.length !== 8) return setCepInfo(undefined);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (d.erro || !d.localidade) {
        setCepInfo({ status: "not_found" });
        return setErro({ message: "CEP não encontrado. Confira o número.", field: "address.zip" });
      }
      setCepInfo({ status: "ok", street: d.logradouro || null, district: d.bairro || null, city: d.localidade, state: d.uf ?? "" });
      setF((v) => ({ ...v, street: d.logradouro || v.street, district: d.bairro || v.district, city: d.localidade || v.city, state: d.uf || v.state }));
      setErro(null);
    } catch {
      setCepInfo({ status: "unavailable" }); // sem internet para o CEP: o cliente preenche e o frete é confirmado depois
    }
  }

  /** "Não sei meu CEP": busca pelo nome da rua na cidade do restaurante (ViaCEP, até 50 resultados). */
  async function buscarRua() {
    const rua = busca.rua.trim();
    if (rua.length < 3 || !delivery.tenantCity || !tenantState) return;
    setBusca((b) => ({ ...b, carregando: true, msg: null, resultados: [] }));
    try {
      const url = `https://viacep.com.br/ws/${tenantState}/${encodeURIComponent(delivery.tenantCity)}/${encodeURIComponent(rua)}/json/`;
      const lista = (await (await fetch(url)).json()) as Endereco[];
      const ok = Array.isArray(lista) ? lista : [];
      setBusca((b) => ({ ...b, carregando: false, resultados: ok, msg: ok.length ? null : "Nenhuma rua encontrada. Tente outra parte do nome." }));
    } catch {
      setBusca((b) => ({ ...b, carregando: false, msg: "Não foi possível buscar agora. Digite o CEP, se souber." }));
    }
  }

  function escolher(e: Endereco) {
    setF((v) => ({ ...v, zip: e.cep, street: e.logradouro || v.street, district: e.bairro || v.district, city: e.localidade, state: e.uf }));
    setCepInfo({ status: "ok", street: e.logradouro || null, district: e.bairro || null, city: e.localidade, state: e.uf });
    setBusca({ aberta: false, rua: "", resultados: [], carregando: false, msg: null });
    setErro(null);
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    start(async () => {
      const r = await criarPedido(slug, {
        items: lines.map((l) => ({ id: l.id, quantity: l.quantity, notes: l.notes })),
        type: tipo,
        name: f.name,
        phone: f.phone,
        address: tipo === "delivery"
          ? { zip: f.zip, street: f.street, number: f.number, complement: f.complement, district: f.district, city: f.city, state: f.state, reference: f.reference }
          : undefined,
        notes: f.notes,
        paymentMethod: f.paymentMethod || undefined,
        changeFor: f.paymentMethod === "cash" ? f.changeFor : "",
      });
      if (!r.ok) {
        setErro({ message: r.message, field: r.field });
        return;
      }
      try {
        const { name, phone, zip, street, number, complement, district, city, state, reference } = f;
        localStorage.setItem(LEMBRAR, JSON.stringify({ name, phone, zip, street, number, complement, district, city, state, reference }));
      } catch {
        /* ignora */
      }
      clear();
      router.push(`${base}/p/${r.token}`);
    });
  }

  if (!ready) return null;
  if (lines.length === 0)
    return (
      <div className="v-vazio">
        <p>Seu carrinho está vazio.</p>
        <a className="v-botao" href={base || "/"}>Ver o cardápio</a>
      </div>
    );

  const marca = (campo: string) => (erro?.field === campo ? " v-invalido" : "");

  return (
    <form onSubmit={enviar} className="v-form" noValidate>
      <section className="v-bloco">
        <h2>Itens</h2>
        <ul className="v-carrinho">
          {lines.map((l) => (
            <li key={l.key}>
              <div>
                <p className="v-c-nome">{l.name}</p>
                {l.notes && <p className="v-c-obs">{l.notes}</p>}
                <p className="v-c-preco">{formatBrl(l.unitCents * l.quantity)}</p>
              </div>
              <div className="v-qtd" aria-label={`Quantidade de ${l.name}`}>
                <button type="button" onClick={() => setQty(l.key, l.quantity - 1)} aria-label={l.quantity === 1 ? "Remover" : "Menos um"}>
                  {l.quantity === 1 ? "×" : "−"}
                </button>
                <span>{l.quantity}</span>
                <button type="button" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Mais um">+</button>
              </div>
            </li>
          ))}
        </ul>
        <a href={base || "/"} className="v-voltar">+ Adicionar mais itens</a>
      </section>

      {ordering.delivery && ordering.pickup && (
        <section className="v-bloco">
          <h2>Como você quer receber?</h2>
          <div className="v-opcoes">
            <label className={tipo === "delivery" ? "v-sel" : ""}>
              <input type="radio" name="tipo" checked={tipo === "delivery"} onChange={() => setTipo("delivery")} /> Entrega
            </label>
            <label className={tipo === "pickup" ? "v-sel" : ""}>
              <input type="radio" name="tipo" checked={tipo === "pickup"} onChange={() => setTipo("pickup")} /> Retirar no balcão
            </label>
          </div>
        </section>
      )}

      <section className="v-bloco">
        <h2>Seus dados</h2>
        <label className={`v-campo${marca("name")}`}>
          <span>Nome</span>
          <input value={f.name} onChange={set("name")} autoComplete="name" required />
        </label>
        <label className={`v-campo${marca("phone")}`}>
          <span>Telefone (WhatsApp)</span>
          <input value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="(16) 99999-8888" required />
        </label>
      </section>

      {tipo === "delivery" && (
        <section className="v-bloco">
          <h2>Endereço de entrega</h2>
          <label className={`v-campo${marca("address.zip")}`}>
            <span>CEP</span>
            <input
              value={f.zip}
              onChange={(e) => {
                const v = e.target.value;
                setF((x) => ({ ...x, zip: v }));
                if (onlyDigits(v).length === 8) void buscarCep(v);
                else setCepInfo(undefined);
              }}
              onBlur={() => buscarCep()}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              required
            />
          </label>
          {delivery.tenantCity && tenantState && (
            <div className="v-busca-cep">
              {!busca.aberta ? (
                <button type="button" className="v-link" onClick={() => setBusca((b) => ({ ...b, aberta: true }))}>Não sei meu CEP</button>
              ) : (
                <>
                  <label className="v-campo">
                    <span>Nome da rua em {delivery.tenantCity}</span>
                    <input value={busca.rua} onChange={(e) => setBusca((b) => ({ ...b, rua: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void buscarRua(); } }} placeholder="Ex.: Diederichsen" />
                  </label>
                  <button type="button" className="v-botao v-botao-sec" onClick={() => void buscarRua()} disabled={busca.carregando || busca.rua.trim().length < 3}>
                    {busca.carregando ? "Buscando..." : "Buscar"}
                  </button>
                  {busca.msg && <p className="v-c-obs">{busca.msg}</p>}
                  {busca.resultados.length > 0 && (
                    <ul className="v-ceps">
                      {busca.resultados.map((e) => (
                        <li key={e.cep + e.complemento}>
                          <button type="button" onClick={() => escolher(e)}>
                            <strong>{e.logradouro}</strong>{e.complemento ? ` (${e.complemento})` : ""}
                            <span>{e.bairro} · CEP {e.cep}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          <label className={`v-campo${marca("address.street")}`}>
            <span>Rua</span>
            <input value={f.street} onChange={set("street")} autoComplete="address-line1" />
          </label>
          <div className="v-linha">
            <label className={`v-campo${marca("address.number")}`}>
              <span>Número</span>
              <input value={f.number} onChange={set("number")} />
            </label>
            <label className="v-campo">
              <span>Complemento</span>
              <input value={f.complement} onChange={set("complement")} placeholder="Apto, bloco" />
            </label>
          </div>
          <label className={`v-campo${marca("address.district")}`}>
            <span>Bairro</span>
            <input value={f.district} onChange={set("district")} list="bairros"
              readOnly={porDistancia && cepInfo?.status === "ok" && Boolean(cepInfo.district)} />
            {districts.length > 0 && (
              <datalist id="bairros">{districts.filter((d) => d.active).map((d) => <option key={d.nameKey} value={d.name} />)}</datalist>
            )}
          </label>
          <div className="v-linha">
            <label className="v-campo">
              <span>Cidade</span>
              <input value={f.city} onChange={set("city")} autoComplete="address-level2" />
            </label>
            <label className="v-campo v-uf">
              <span>UF</span>
              <select value={f.state} onChange={set("state")}>
                <option value="">—</option>
                {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </label>
          </div>
          <label className="v-campo">
            <span>Ponto de referência (opcional)</span>
            <input value={f.reference} onChange={set("reference")} />
          </label>
          {frete && !frete.ok && <p className="v-aviso">{frete.message}</p>}
        </section>
      )}

      <section className="v-bloco">
        <h2>Pagamento {tipo === "delivery" ? "na entrega" : "na retirada"}</h2>
        <div className={`v-opcoes${marca("paymentMethod")}`}>
          <label className={f.paymentMethod === "cash" ? "v-sel" : ""}>
            <input type="radio" name="pag" checked={f.paymentMethod === "cash"} onChange={() => setF((v) => ({ ...v, paymentMethod: "cash" }))} /> Dinheiro
          </label>
          <label className={f.paymentMethod === "card" ? "v-sel" : ""}>
            <input type="radio" name="pag" checked={f.paymentMethod === "card"} onChange={() => setF((v) => ({ ...v, paymentMethod: "card" }))} /> Cartão
          </label>
          <label className={f.paymentMethod === "pix" ? "v-sel" : ""}>
            <input type="radio" name="pag" checked={f.paymentMethod === "pix"} onChange={() => setF((v) => ({ ...v, paymentMethod: "pix" }))} /> Pix
          </label>
        </div>
        {f.paymentMethod === "cash" && (
          <label className={`v-campo${marca("changeFor")}`}>
            <span>Troco para quanto? (deixe vazio se não precisar)</span>
            <input value={f.changeFor} onChange={set("changeFor")} inputMode="decimal" placeholder="100,00" />
          </label>
        )}
        <label className="v-campo">
          <span>Observações do pedido (opcional)</span>
          <textarea rows={2} maxLength={300} value={f.notes} onChange={set("notes")} />
        </label>
      </section>

      <section className="v-bloco v-resumo">
        <p><span>Subtotal</span><span>{formatBrl(subtotal)}</span></p>
        {tipo === "delivery" && semCep && <p><span>Taxa de entrega</span><span>informe o CEP</span></p>}
        {tipo === "delivery" && !semCep && !aConfirmar && !naoAtende && <p><span>Taxa de entrega</span><span>{formatBrl(taxa)}</span></p>}
        {tipo === "delivery" && retorno > 0 && <p><span>Taxa de retorno (maquininha)</span><span>{formatBrl(retorno)}</span></p>}
        {aConfirmar && <p><span>Taxa de entrega</span><span>a confirmar</span></p>}
        <p className="v-total"><span>Total</span><span>{formatBrl(total)}</span></p>
        {ordering.prepTime && <p className="v-c-obs">Tempo estimado: {ordering.prepTime}</p>}
        {faltaMinimo && <p className="v-aviso">O pedido mínimo é de {formatBrl(ordering.minOrderCents)}.</p>}
        {aConfirmar && <p className="v-c-obs">Ainda não temos a distância até o seu bairro: o restaurante confirma o valor da entrega com você.</p>}
        {!aberto && <p className="v-aviso">O restaurante está fechado agora. Os pedidos abrem no horário de funcionamento.</p>}
        {erro && <p className="v-erro" role="alert">{erro.message}</p>}
        <button type="submit" className="v-botao v-enviar" disabled={pending || faltaMinimo || !aberto || naoAtende || semCep}>
          {pending ? "Enviando..." : `Enviar pedido (${formatBrl(total)}${aConfirmar ? " + entrega" : ""})`}
        </button>
        <p className="v-c-obs">Preços e taxa são confirmados no envio.</p>
      </section>
    </form>
  );
}
