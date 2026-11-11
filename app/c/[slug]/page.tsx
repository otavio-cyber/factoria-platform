/**
 * Vitrine pública do cardápio (sem login). Abre em app.factoria.dev.br/c/<slug>
 * e, para restaurantes com domínio próprio, na raiz desse domínio (ver proxy.ts).
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getPublicMenu, type PublicItem, type PublicMenu } from "@/lib/db";
import { mediaUrl } from "@/lib/media/keys";
import { effectivePrice, formatBrl } from "@/lib/menu/rules";
import { CATEGORIES, formatCnpj, formatPhoneBr, openStatus, WEEKDAYS, type OpenStatus } from "@/lib/tenants/profile";
import { APP_HOSTS } from "@/lib/tenants/app-hosts";
import { vitrineBase } from "@/lib/tenants/routing";
import { AddToCart, CartBar, CartProvider } from "./cart";
import "./vitrine.css";

const carregar = cache(async (slug: string) => getPublicMenu(slug.toLowerCase()));

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const m = await carregar((await params).slug);
  if (!m) return { title: "Cardápio não encontrado" };
  const host = (await headers()).get("host");
  const capa = mediaUrl(m.coverKey);
  return {
    title: { absolute: `${m.name} | Cardápio` },
    description: `Cardápio de ${m.name}${m.address.city ? ` em ${m.address.city}` : ""}.`,
    robots: { index: true, follow: true },
    openGraph: capa && host ? { images: [`https://${host}${capa}`], title: m.name } : { title: m.name },
  };
}

export default async function Vitrine({ params }: PageProps<"/c/[slug]">) {
  const m = await carregar((await params).slug);
  if (!m) notFound();
  const status = openStatus(m.openingHours, m.timezone);
  const destaques = m.categories.flatMap((c) => c.items).filter((i) => i.featured && i.available);
  const base = vitrineBase((await headers()).get("host"), m.slug, APP_HOSTS);
  const podePedir = m.ordering.enabled && status.state === "open";

  return (
    <CartProvider slug={m.slug}>
    <div className="vitrine">
      <header className="v-topo">
        <div className="v-capa">
          {m.coverKey && (
            // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio
            <img src={mediaUrl(m.coverKey)!} alt="" />
          )}
        </div>
        <div className="v-identidade">
          {m.logoKey && (
            // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio
            <img className="v-logo" src={mediaUrl(m.logoKey)!} alt={`Logo ${m.name}`} />
          )}
          <h1 className="v-nome">{m.name}</h1>
          {m.category && <p className="v-tipo">{CATEGORIES[m.category as keyof typeof CATEGORIES] ?? null}</p>}
          <Status status={status} />
        </div>
        <Contato m={m} />
        {m.ordering.enabled && <Pedidos m={m} podePedir={podePedir} />}
      </header>

      {m.categories.length > 0 && (
        <nav className="v-nav" aria-label="Categorias do cardápio">
          {destaques.length > 0 && <a href="#destaques">Destaques</a>}
          {m.categories.map((c) => (
            <a key={c.id} href={`#c-${c.id}`}>{c.name}</a>
          ))}
        </nav>
      )}

      <main className="v-conteudo">
        {m.categories.length === 0 && <p className="v-vazio">O cardápio está sendo preparado. Volte em breve.</p>}

        {destaques.length > 0 && (
          <section id="destaques" className="v-secao">
            <h2>Destaques</h2>
            <ul className="v-destaques">
              {destaques.map((i) => (
                <li key={i.id} className="v-destaque">
                  {i.imageKey ? (
                    // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio
                    <img src={mediaUrl(i.imageKey)!} alt="" loading="lazy" />
                  ) : (
                    <div className="v-sem-foto" aria-hidden />
                  )}
                  <h3>{i.name}</h3>
                  <Preco item={i} />
                  {podePedir && <AddToCart id={i.id} name={i.name} unitCents={effectivePrice(i)} />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {m.categories.map((c) => (
          <section key={c.id} id={`c-${c.id}`} className="v-secao">
            <h2>{c.name}</h2>
            {c.description && <p className="v-cat-desc">{c.description}</p>}
            <ul className="v-itens">
              {c.items.map((i) => <Item key={i.id} item={i} podePedir={podePedir} />)}
            </ul>
          </section>
        ))}
      </main>

      <footer className="v-rodape">
        {(m.legalName || m.cnpj) && (
          <p>
            {m.legalName}
            {m.legalName && m.cnpj && <br />}
            {m.cnpj && `CNPJ ${formatCnpj(m.cnpj)}`}
          </p>
        )}
        <p className="v-assinatura">Cardápio digital Factoria</p>
      </footer>
      {podePedir && <CartBar checkoutHref={`${base}/pedido`} />}
    </div>
    </CartProvider>
  );
}

function Pedidos({ m, podePedir }: { m: PublicMenu; podePedir: boolean }) {
  const o = m.ordering;
  const modos = [o.delivery && "entrega", o.pickup && "retirada no balcão"].filter(Boolean).join(" e ");
  return (
    <div className="v-pedidos">
      <p>
        <strong>Peça por aqui</strong>{modos ? `: ${modos}` : ""}.
        {!podePedir && " Os pedidos abrem no horário de funcionamento."}
      </p>
      <ul>
        {o.delivery && <li>Taxa de entrega a partir de {formatBrl(o.deliveryFeeCents)}</li>}
        {o.minOrderCents > 0 && <li>Pedido mínimo {formatBrl(o.minOrderCents)}</li>}
        {o.prepTime && <li>Tempo estimado: {o.prepTime}</li>}
      </ul>
    </div>
  );
}

function Status({ status }: { status: OpenStatus }) {
  if (status.state === "unknown") return null;
  if (status.state === "open")
    return <p className="v-status v-aberto">Aberto agora, até as {status.closesAt}</p>;
  const quando = status.day === "hoje" || status.day === "amanhã" ? status.day : `${status.day.toLowerCase()}`;
  return <p className="v-status v-fechado">Fechado. Abre {quando} às {status.opensAt}</p>;
}

function Contato({ m }: { m: PublicMenu }) {
  const a = m.address;
  const rua = [a.street, a.number].filter(Boolean).join(", ");
  const linha = [rua, a.district, a.city && a.state ? `${a.city}/${a.state}` : a.city].filter(Boolean).join(" - ");
  const mapa = linha ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.name} ${linha}`)}` : null;
  const dias = [1, 2, 3, 4, 5, 6, 0];
  const temHorario = dias.some((d) => (m.openingHours[String(d) as keyof typeof m.openingHours]?.length ?? 0) > 0);
  if (!linha && !m.phone && !temHorario) return null;

  return (
    <div className="v-contato">
      {mapa && (
        <a href={mapa} target="_blank" rel="noopener noreferrer">{linha}</a>
      )}
      {m.phone && <a href={`tel:${m.phone}`}>{formatPhoneBr(m.phone)}</a>}
      {temHorario && (
        <details>
          <summary>Horário de funcionamento</summary>
          <dl>
            {dias.map((d) => {
              const turnos = m.openingHours[String(d) as keyof typeof m.openingHours] ?? [];
              return (
                <div key={d}>
                  <dt>{WEEKDAYS[d]}</dt>
                  <dd>{turnos.length ? turnos.map(([a, b]) => `${a} às ${b}`).join(" e ") : "Fechado"}</dd>
                </div>
              );
            })}
          </dl>
        </details>
      )}
    </div>
  );
}

function Preco({ item }: { item: PublicItem }) {
  return (
    <p className="v-preco">
      <span className="v-preco-atual">{formatBrl(effectivePrice(item))}</span>
      {item.promoPriceCents && <s className="v-preco-de">{formatBrl(item.priceCents)}</s>}
    </p>
  );
}

function Item({ item, podePedir }: { item: PublicItem; podePedir: boolean }) {
  return (
    <li className={`v-item${item.available ? "" : " v-indisponivel"}`}>
      <div className="v-item-texto">
        <h3>{item.name}</h3>
        {item.description && <p className="v-item-desc">{item.description}</p>}
        {item.serves && <p className="v-serve">Serve {item.serves} {item.serves === 1 ? "pessoa" : "pessoas"}</p>}
        {item.available ? <Preco item={item} /> : <p className="v-esgotado">Indisponível no momento</p>}
        {item.available && podePedir && <AddToCart id={item.id} name={item.name} unitCents={effectivePrice(item)} />}
      </div>
      {item.imageKey && (
        // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio
        <img className="v-item-foto" src={mediaUrl(item.imageKey)!} alt="" loading="lazy" />
      )}
    </li>
  );
}
