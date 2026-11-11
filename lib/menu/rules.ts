/**
 * Regras do cardápio — puras (sem banco), usadas pelo painel, pelas Server Actions
 * e, depois, pelo cardápio público e pelo atendimento automático.
 * Dinheiro sempre em centavos (inteiro).
 */
import { z } from "zod";

/** "31,90" | "31.90" | "R$ 1.234,50" | "32" → centavos. null se inválido. */
export function parseBrl(valor: string): number | null {
  let v = valor.replace(/R\$|\s/g, "");
  if (v === "") return null;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", "."); // formato brasileiro
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const cents = Math.round(Number(v) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valor para preencher um campo de preço ("31,90"). */
export const centsToInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/** Preço que o cliente paga: o promocional, quando houver. */
export const effectivePrice = (item: { priceCents: number; promoPriceCents: number | null }) =>
  item.promoPriceCents ?? item.priceCents;

const textoOpcional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
    z.string().max(max, `Máximo de ${max} caracteres`).nullable(),
  );

function centavos(v: string, ctx: z.RefinementCtx): number {
  const c = parseBrl(v);
  if (c === null || c <= 0) {
    ctx.addIssue({ code: "custom", message: "Preço inválido (ex.: 31,90)" });
    return z.NEVER;
  }
  if (c > 10_000_000) {
    ctx.addIssue({ code: "custom", message: "Preço alto demais" });
    return z.NEVER;
  }
  return c;
}

const precoObrigatorio = z.string().transform((v, ctx): number => {
  if (v.trim() === "") {
    ctx.addIssue({ code: "custom", message: "Informe o preço" });
    return z.NEVER;
  }
  return centavos(v, ctx);
});

const precoOpcional = z.string().transform((v, ctx): number | null => (v.trim() === "" ? null : centavos(v, ctx)));

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da categoria").max(60, "Máximo de 60 caracteres"),
  description: textoOpcional(300),
  active: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categorySchema>;
export type CategoryData = z.output<typeof categorySchema>;

export const itemSchema = z
  .object({
    categoryId: z.uuid("Escolha a categoria"),
    name: z.string().trim().min(1, "Informe o nome do item").max(100, "Máximo de 100 caracteres"),
    description: textoOpcional(1000),
    price: precoObrigatorio,
    promoPrice: precoOpcional,
    serves: z
      .string()
      .trim()
      .transform((v, ctx) => {
        if (v === "") return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          ctx.addIssue({ code: "custom", message: "Entre 1 e 50 pessoas" });
          return z.NEVER;
        }
        return n;
      }),
    featured: z.boolean().default(false),
    available: z.boolean().default(true),
  })
  .refine((i) => i.promoPrice == null || i.promoPrice < i.price, {
    path: ["promoPrice"],
    message: "O preço promocional precisa ser menor que o normal",
  });
export type ItemInput = z.input<typeof itemSchema>;
export type ItemData = z.output<typeof itemSchema>;
