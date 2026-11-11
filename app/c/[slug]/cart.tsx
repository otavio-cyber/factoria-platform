"use client";

/**
 * Carrinho da vitrine. Fica no navegador do cliente (localStorage, por restaurante).
 * Guarda nome e preço só para mostrar; no envio o servidor recalcula tudo pelo banco.
 */
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatBrl } from "@/lib/menu/rules";

export type CartLine = { key: string; id: string; name: string; unitCents: number; quantity: number; notes: string };
type Ctx = {
  lines: CartLine[];
  add: (l: Omit<CartLine, "key">) => void;
  setQty: (key: string, q: number) => void;
  clear: () => void;
  count: number;
  subtotal: number;
  ready: boolean;
};
const CartContext = createContext<Ctx | null>(null);

const storageKey = (slug: string) => `factoria:carrinho:${slug}`;

export function CartProvider({ slug, children }: { slug: string; children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(slug));
      if (raw) setLines(JSON.parse(raw) as CartLine[]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial do navegador
    } catch {
      /* navegador sem armazenamento: carrinho só vive na página */
    }
    setReady(true);
  }, [slug]);

  const salvar = useCallback(
    (next: CartLine[]) => {
      setLines(next);
      try {
        localStorage.setItem(storageKey(slug), JSON.stringify(next));
      } catch {
        /* ignora */
      }
    },
    [slug],
  );

  const value = useMemo<Ctx>(() => {
    const add: Ctx["add"] = (l) => {
      const key = `${l.id}|${l.notes.trim()}`;
      const existente = lines.find((x) => x.key === key);
      salvar(
        existente
          ? lines.map((x) => (x.key === key ? { ...x, quantity: Math.min(99, x.quantity + l.quantity) } : x))
          : [...lines, { ...l, notes: l.notes.trim(), key }],
      );
    };
    const setQty: Ctx["setQty"] = (key, q) =>
      salvar(q <= 0 ? lines.filter((x) => x.key !== key) : lines.map((x) => (x.key === key ? { ...x, quantity: Math.min(99, q) } : x)));
    return {
      lines,
      add,
      setQty,
      clear: () => salvar([]),
      count: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: lines.reduce((n, l) => n + l.unitCents * l.quantity, 0),
      ready,
    };
  }, [lines, ready, salvar]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart fora do CartProvider");
  return c;
}

/** Botão "Adicionar" de cada item: abre a escolha de quantidade e observação. */
export function AddToCart({ id, name, unitCents }: { id: string; name: string; unitCents: number }) {
  const { add } = useCart();
  const [aberto, setAberto] = useState(false);
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState("");

  return (
    <>
      <button type="button" className="v-add" onClick={() => setAberto(true)} aria-label={`Adicionar ${name}`}>
        Adicionar
      </button>
      {aberto && (
        <div className="v-sheet-fundo" onClick={() => setAberto(false)}>
          <div className="v-sheet" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
            <h3>{name}</h3>
            <label className="v-campo">
              <span>Alguma observação? (opcional)</span>
              <textarea maxLength={140} rows={2} value={obs} onChange={(e) => setObs(e.target.value)}
                placeholder="Ex.: sem cebola, farofa à parte" />
              <small>{obs.length}/140</small>
            </label>
            <div className="v-sheet-acoes">
              <div className="v-qtd" aria-label="Quantidade">
                <button type="button" onClick={() => setQtd((q) => Math.max(1, q - 1))} aria-label="Menos um">−</button>
                <span aria-live="polite">{qtd}</span>
                <button type="button" onClick={() => setQtd((q) => Math.min(99, q + 1))} aria-label="Mais um">+</button>
              </div>
              <button
                type="button"
                className="v-botao"
                onClick={() => {
                  add({ id, name, unitCents, quantity: qtd, notes: obs });
                  setAberto(false);
                  setQtd(1);
                  setObs("");
                }}
              >
                Adicionar {formatBrl(unitCents * qtd)}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Barra fixa no rodapé com o total e o atalho para finalizar. */
export function CartBar({ checkoutHref }: { checkoutHref: string }) {
  const { count, subtotal, ready } = useCart();
  if (!ready || count === 0) return null;
  return (
    <div className="v-barra">
      <Link href={checkoutHref} className="v-botao v-barra-botao">
        <span>Ver carrinho ({count} {count === 1 ? "item" : "itens"})</span>
        <span>{formatBrl(subtotal)}</span>
      </Link>
    </div>
  );
}
