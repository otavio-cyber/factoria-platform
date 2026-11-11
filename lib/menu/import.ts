/**
 * Importação de cardápio a partir de um arquivo JSON (ex.: transcrição do cardápio que o
 * restaurante já tem em outro canal). Puro: valida tudo com as MESMAS regras do painel
 * (categorySchema / itemSchema) antes de qualquer escrita no banco.
 *
 * Formato:
 * { "categories": [ { "name": "Carnes", "description": "...", "items": [
 *     { "name": "Picanha 200g", "description": "...", "price": "34,99",
 *       "promoPrice": "29,99", "serves": 1, "featured": true, "available": true,
 *       "image": "https://.../foto.jpg" } ] } ] }
 *
 * "image" (opcional): URL https da foto. O script baixa, confere e envia ao armazenamento.
 */
import { z } from "zod";
import { isHttpsUrl } from "@/lib/media/fetch-image";
import { categorySchema, itemSchema, type CategoryData, type ItemData } from "./rules";

const texto = z.string().optional().default("");
const preco = z.union([z.string(), z.number()]).transform((v) => (typeof v === "number" ? v.toFixed(2).replace(".", ",") : v));

const fileSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string(),
        description: texto,
        active: z.boolean().optional().default(true),
        items: z
          .array(
            z.object({
              name: z.string(),
              description: texto,
              price: preco,
              promoPrice: preco.optional().default(""),
              serves: z.union([z.string(), z.number()]).optional().default("").transform(String),
              featured: z.boolean().optional().default(false),
              available: z.boolean().optional().default(true),
              image: z
                .string()
                .trim()
                .max(500)
                .optional()
                .default("")
                .refine((v) => v === "" || isHttpsUrl(v), "a foto precisa ser uma URL https"),
            }),
          )
          .max(300),
      }),
    )
    .min(1, "O arquivo não tem categorias.")
    .max(60),
});

/** Item validado, ainda sem categoria (o id só existe depois de criar a categoria). */
export type ImportItem = Omit<ItemData, "categoryId"> & {
  /** URL da foto no arquivo (o script baixa e envia). */
  image?: string | null;
  /** Chave da foto já enviada ao armazenamento (preenchida pelo script antes de gravar). */
  imageKey?: string | null;
};
export type MenuImport = Array<CategoryData & { items: ImportItem[] }>;

// Placeholder só para reaproveitar o itemSchema (que exige um uuid de categoria).
const SEM_CATEGORIA = "00000000-0000-4000-8000-000000000000";

export function parseMenuImport(raw: unknown): { ok: true; menu: MenuImport } | { ok: false; errors: string[] } {
  const f = fileSchema.safeParse(raw);
  if (!f.success) return { ok: false, errors: f.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };

  const errors: string[] = [];
  const nomes = new Set<string>();
  const menu: MenuImport = [];
  f.data.categories.forEach((c, ci) => {
    const cat = categorySchema.safeParse({ name: c.name, description: c.description, active: c.active });
    if (!cat.success) {
      cat.error.issues.forEach((i) => errors.push(`categoria ${ci + 1} (${c.name}): ${i.message}`));
      return;
    }
    const chave = cat.data.name.toLowerCase();
    if (nomes.has(chave)) errors.push(`categoria ${ci + 1}: "${cat.data.name}" repetida`);
    nomes.add(chave);

    const items: ImportItem[] = [];
    c.items.forEach((it, ii) => {
      const r = itemSchema.safeParse({ ...it, categoryId: SEM_CATEGORIA });
      if (!r.success) {
        r.error.issues.forEach((i) => errors.push(`${cat.data.name} › item ${ii + 1} (${it.name}): ${i.message}`));
        return;
      }
      const { name, description, price, promoPrice, serves, featured, available } = r.data;
      items.push({ name, description, price, promoPrice, serves, featured, available, image: it.image || null });
    });
    menu.push({ ...cat.data, items });
  });
  return errors.length ? { ok: false, errors } : { ok: true, menu };
}
