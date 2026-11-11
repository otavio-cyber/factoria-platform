import { describe, expect, it } from "vitest";
import { parseMenuImport } from "@/lib/menu/import";

const base = (items: unknown[], extra = {}) => ({ categories: [{ name: "Carnes", items, ...extra }] });

describe("parseMenuImport", () => {
  it("aceita preço em texto ou número e converte para centavos", () => {
    const r = parseMenuImport(
      base([
        { name: "Picanha", price: "34,99" },
        { name: "Combo", price: 39.9, promoPrice: "31,90", serves: 1, featured: true },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.menu[0].items).toEqual([
      expect.objectContaining({ name: "Picanha", price: 3499, promoPrice: null, serves: null, featured: false, available: true }),
      expect.objectContaining({ name: "Combo", price: 3990, promoPrice: 3190, serves: 1, featured: true }),
    ]);
  });

  it("aplica as mesmas regras do painel e junta todos os erros", () => {
    const r = parseMenuImport(
      base([
        { name: "", price: "10,00" },
        { name: "Caro na promo", price: "10,00", promoPrice: "12,00" },
        { name: "Sem preço", price: "" },
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(3);
    expect(r.errors.join("\n")).toMatch(/promocional precisa ser menor/);
  });

  it("recusa categoria repetida e arquivo sem categorias", () => {
    const dup = parseMenuImport({ categories: [{ name: "Bebidas", items: [] }, { name: "bebidas", items: [] }] });
    expect(dup.ok).toBe(false);
    expect(parseMenuImport({ categories: [] }).ok).toBe(false);
    expect(parseMenuImport("lixo").ok).toBe(false);
  });
  it("foto: aceita URL https, recusa outro esquema", () => {
    const ok = parseMenuImport({ categories: [{ name: "A", items: [{ name: "X", price: "1,00", image: "https://cdn.exemplo.com/x.jpg" }] }] });
    expect(ok.ok && ok.menu[0].items[0].image).toBe("https://cdn.exemplo.com/x.jpg");
    const ruim = parseMenuImport({ categories: [{ name: "A", items: [{ name: "X", price: "1,00", image: "http://cdn.exemplo.com/x.jpg" }] }] });
    expect(ruim.ok).toBe(false);
  });
});
