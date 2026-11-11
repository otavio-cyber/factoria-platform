/** Regras puras do cardápio: preço em reais → centavos e validação de item. */
import { describe, expect, it } from "vitest";
import { centsToInput, formatBrl, itemSchema, parseBrl } from "@/lib/menu/rules";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("preço", () => {
  it("entende os formatos que o dono digita", () => {
    expect(parseBrl("31,90")).toBe(3190);
    expect(parseBrl("31.90")).toBe(3190);
    expect(parseBrl("32")).toBe(3200);
    expect(parseBrl("R$ 1.234,50")).toBe(123450);
    expect(parseBrl("0,1")).toBe(10);
  });
  it("recusa texto e mais de 2 casas", () => {
    expect(parseBrl("abc")).toBeNull();
    expect(parseBrl("31,999")).toBeNull();
    expect(parseBrl("")).toBeNull();
  });
  it("formata para exibir e para editar", () => {
    expect(formatBrl(3190).replace(/\s/g, " ")).toBe("R$ 31,90");
    expect(centsToInput(3190)).toBe("31,90");
    expect(centsToInput(null)).toBe("");
  });
});

describe("item", () => {
  const base = { categoryId: UUID, name: " Picanha 200grs ", description: "", price: "34,99", promoPrice: "", serves: "" };
  it("normaliza", () => {
    expect(itemSchema.parse(base)).toMatchObject({ name: "Picanha 200grs", description: null, price: 3499, promoPrice: null, serves: null, featured: false, available: true });
  });
  it("preço promocional precisa ser menor que o normal", () => {
    expect(itemSchema.safeParse({ ...base, promoPrice: "34,99" }).success).toBe(false);
    expect(itemSchema.parse({ ...base, price: "39,90", promoPrice: "31,90" })).toMatchObject({ price: 3990, promoPrice: 3190 });
  });
  it("recusa preço vazio, zero e 'serve' fora da faixa", () => {
    expect(itemSchema.safeParse({ ...base, price: "" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...base, price: "0" }).success).toBe(false);
    expect(itemSchema.safeParse({ ...base, serves: "0" }).success).toBe(false);
    expect(itemSchema.parse({ ...base, serves: "4" }).serves).toBe(4);
  });
});
