"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { MenuCategory, MenuItem, MenuTree } from "@/lib/db";
import { FotoUpload } from "@/components/foto-upload";
import { mediaUrl } from "@/lib/media/keys";
import { centsToInput, formatBrl } from "@/lib/menu/rules";
import {
  excluirCategoria,
  excluirItem,
  moverCategoria,
  moverItem,
  pausarItem,
  salvarCategoria,
  salvarItem,
  type MenuResult,
} from "./actions";

const input =
  "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 disabled:opacity-60 dark:border-neutral-700";
const botao = "rounded-md border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-900";
const primario = "rounded-md bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900";

type Editando =
  | { tipo: "categoria"; cat: MenuCategory | null }
  | { tipo: "item"; item: MenuItem | null; categoryId: string }
  | null;

export function MenuEditor({ slug, menu, podeEditar }: { slug: string; menu: MenuTree; podeEditar: boolean }) {
  const [editando, setEditando] = useState<Editando>(null);
  const [pending, start] = useTransition();

  /** Ações rápidas (mover, pausar, excluir): mostram erro em toast. */
  const rodar = (fn: () => Promise<MenuResult>, sucesso?: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.message);
      else if (sucesso) toast.success(sucesso);
    });

  const totalItens = menu.reduce((n, c) => n + c.items.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-neutral-500">
          {menu.length} {menu.length === 1 ? "categoria" : "categorias"} · {totalItens} {totalItens === 1 ? "item" : "itens"}
          {!podeEditar && " · você pode pausar itens que acabaram"}
        </p>
        {podeEditar && (
          <button className={primario} onClick={() => setEditando({ tipo: "categoria", cat: null })}>
            Nova categoria
          </button>
        )}
      </div>

      {menu.length === 0 && (
        <div className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
          O cardápio está vazio. {podeEditar ? "Comece criando uma categoria, como “Carnes assadas” ou “Bebidas”." : ""}
        </div>
      )}

      {menu.map((cat, ci) => (
        <section key={cat.id} className="rounded-md border border-neutral-200 dark:border-neutral-800">
          <header className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-200 p-3 dark:border-neutral-800">
            <div className="min-w-0">
              <h2 className="font-semibold">
                {cat.name}
                {!cat.active && <Selo>Oculta</Selo>}
              </h2>
              {cat.description && <p className="text-sm text-neutral-500">{cat.description}</p>}
            </div>
            {podeEditar && (
              <div className="flex gap-1">
                <button className={botao} disabled={pending || ci === 0} aria-label="Subir categoria"
                  onClick={() => rodar(() => moverCategoria(slug, cat.id, "up"))}>↑</button>
                <button className={botao} disabled={pending || ci === menu.length - 1} aria-label="Descer categoria"
                  onClick={() => rodar(() => moverCategoria(slug, cat.id, "down"))}>↓</button>
                <button className={botao} onClick={() => setEditando({ tipo: "categoria", cat })}>Editar</button>
                <button className={botao} disabled={pending} onClick={() => {
                  if (confirm(`Excluir a categoria "${cat.name}"?`)) rodar(() => excluirCategoria(slug, cat.id), "Categoria excluída.");
                }}>Excluir</button>
              </div>
            )}
          </header>

          <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {cat.items.length === 0 && <li className="p-3 text-sm text-neutral-500">Nenhum item nesta categoria.</li>}
            {cat.items.map((item, ii) => (
              <li key={item.id} className={`flex flex-wrap items-center gap-3 p-3 ${item.available ? "" : "opacity-60"}`}>
                {item.imageKey ? (
                  // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio
                  <img src={mediaUrl(item.imageKey)!} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-neutral-100 dark:bg-neutral-900" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {item.name}
                    {item.featured && <Selo>Destaque</Selo>}
                    {!item.available && <Selo>Pausado</Selo>}
                  </p>
                  {item.description && <p className="line-clamp-2 text-sm text-neutral-500">{item.description}</p>}
                  <p className="text-sm">
                    {item.promoPriceCents ? (
                      <>
                        <span className="font-medium text-green-700 dark:text-green-500">{formatBrl(item.promoPriceCents)}</span>{" "}
                        <span className="text-neutral-500 line-through">{formatBrl(item.priceCents)}</span>
                      </>
                    ) : (
                      <span className="font-medium">{formatBrl(item.priceCents)}</span>
                    )}
                    {item.serves && <span className="text-neutral-500"> · serve {item.serves} {item.serves === 1 ? "pessoa" : "pessoas"}</span>}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button className={botao} disabled={pending}
                    onClick={() => rodar(() => pausarItem(slug, item.id, !item.available), item.available ? "Item pausado." : "Item disponível.")}>
                    {item.available ? "Pausar" : "Reativar"}
                  </button>
                  {podeEditar && (
                    <>
                      <button className={botao} disabled={pending || ii === 0} aria-label="Subir item"
                        onClick={() => rodar(() => moverItem(slug, item.id, "up"))}>↑</button>
                      <button className={botao} disabled={pending || ii === cat.items.length - 1} aria-label="Descer item"
                        onClick={() => rodar(() => moverItem(slug, item.id, "down"))}>↓</button>
                      <button className={botao} onClick={() => setEditando({ tipo: "item", item, categoryId: cat.id })}>Editar</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {podeEditar && (
            <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
              <button className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
                onClick={() => setEditando({ tipo: "item", item: null, categoryId: cat.id })}>
                + Adicionar item em {cat.name}
              </button>
            </div>
          )}
        </section>
      ))}

      {editando?.tipo === "categoria" && (
        <CategoriaForm slug={slug} cat={editando.cat} onClose={() => setEditando(null)} />
      )}
      {editando?.tipo === "item" && (
        <ItemForm slug={slug} item={editando.item} categoryId={editando.categoryId}
          categorias={menu} onClose={() => setEditando(null)} />
      )}
    </div>
  );
}

function Selo({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 align-middle text-xs font-normal text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
      {children}
    </span>
  );
}

function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={titulo}
        className="my-8 w-full max-w-lg rounded-lg bg-[var(--background)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button aria-label="Fechar" className="text-xl text-neutral-500" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useSalvar(onClose: () => void) {
  const [erros, setErros] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const salvar = (fn: () => Promise<MenuResult>, msg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(msg);
        onClose();
      } else {
        setErros(r.fields);
        toast.error(r.message);
      }
    });
  return { erros, pending, salvar };
}

function CategoriaForm({ slug, cat, onClose }: { slug: string; cat: MenuCategory | null; onClose: () => void }) {
  const [f, setF] = useState({ name: cat?.name ?? "", description: cat?.description ?? "", active: cat?.active ?? true });
  const { erros, pending, salvar } = useSalvar(onClose);
  return (
    <Modal titulo={cat ? "Editar categoria" : "Nova categoria"} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        salvar(() => salvarCategoria(slug, cat?.id ?? null, f), cat ? "Categoria salva." : "Categoria criada.");
      }}>
        <Campo label="Nome" erro={erros.name}>
          <input autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} />
        </Campo>
        <Campo label="Descrição (opcional)" erro={erros.description}
          dica="Vale para todos os itens. Ex.: “Todos os pratos acompanham arroz, feijão e farofa.”">
          <textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={input} />
        </Campo>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Mostrar no cardápio
        </label>
        <button type="submit" disabled={pending} className={primario}>{pending ? "Salvando..." : "Salvar"}</button>
      </form>
    </Modal>
  );
}

function ItemForm({ slug, item, categoryId, categorias, onClose }: {
  slug: string;
  item: MenuItem | null;
  categoryId: string;
  categorias: MenuTree;
  onClose: () => void;
}) {
  const [f, setF] = useState({
    categoryId: item?.categoryId ?? categoryId,
    name: item?.name ?? "",
    description: item?.description ?? "",
    price: centsToInput(item?.priceCents),
    promoPrice: centsToInput(item?.promoPriceCents),
    serves: item?.serves ? String(item.serves) : "",
    featured: item?.featured ?? false,
    available: item?.available ?? true,
  });
  const { erros, pending, salvar } = useSalvar(onClose);
  const [excluindo, startExcluir] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <Modal titulo={item ? "Editar item" : "Novo item"} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        salvar(() => salvarItem(slug, item?.id ?? null, f), item ? "Item salvo." : "Item criado.");
      }}>
        <Campo label="Categoria" erro={erros.categoryId}>
          <select value={f.categoryId} onChange={set("categoryId")} className={input}>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Campo>
        <Campo label="Nome" erro={erros.name} dica="Inclua a gramatura, se houver. Ex.: “Picanha 200grs”.">
          <input autoFocus required value={f.name} onChange={set("name")} className={input} />
        </Campo>
        <Campo label="Descrição (opcional)" erro={erros.description}>
          <textarea rows={3} value={f.description} onChange={set("description")} className={input} />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo label="Preço (R$)" erro={erros.price}>
            <input required inputMode="decimal" placeholder="39,90" value={f.price} onChange={set("price")} className={input} />
          </Campo>
          <Campo label="Preço promocional (R$)" erro={erros.promoPrice} dica="Opcional. Mostra “de/por”.">
            <input inputMode="decimal" placeholder="31,90" value={f.promoPrice} onChange={set("promoPrice")} className={input} />
          </Campo>
        </div>
        <Campo label="Serve quantas pessoas? (opcional)" erro={erros.serves}>
          <input inputMode="numeric" value={f.serves} onChange={set("serves")} className={`${input} max-w-24`} />
        </Campo>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} />
            Destaque (aparece no topo do cardápio)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />
            Disponível para pedido
          </label>
        </div>
        {item ? (
          <FotoUpload slug={slug} alvo={{ tipo: "item", id: item.id }} url={mediaUrl(item.imageKey)} rotulo="Foto do item" />
        ) : (
          <p className="text-xs text-neutral-500">Salve o item para adicionar a foto.</p>
        )}
        <div className="flex items-center justify-between">
          <button type="submit" disabled={pending} className={primario}>{pending ? "Salvando..." : "Salvar"}</button>
          {item && (
            <button type="button" disabled={excluindo} className="text-sm text-red-600 hover:underline"
              onClick={() => {
                if (!confirm(`Excluir "${item.name}"?`)) return;
                startExcluir(async () => {
                  const r = await excluirItem(slug, item.id);
                  if (r.ok) { toast.success("Item excluído."); onClose(); } else toast.error(r.message);
                });
              }}>
              Excluir item
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function Campo({ label, erro, dica, children }: { label: string; erro?: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      {children}
      {erro ? <span className="block text-xs text-red-600">{erro}</span> : dica && <span className="block text-xs text-neutral-500">{dica}</span>}
    </label>
  );
}
