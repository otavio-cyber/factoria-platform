/**
 * Importa um cardápio (JSON) para um restaurante. Por padrão só SIMULA: valida o arquivo e
 * mostra o que seria criado. Grava apenas com --apply.
 *
 *   node dist-scripts/import-menu.mjs <slug> <arquivo.json>                          # simulação
 *   node dist-scripts/import-menu.mjs <slug> <arquivo.json> --apply                  # grava (cardápio vazio)
 *   node dist-scripts/import-menu.mjs <slug> <arquivo.json> --substituir             # simula a troca
 *   node dist-scripts/import-menu.mjs <slug> <arquivo.json> --substituir --apply     # APAGA o atual e grava
 *
 * --substituir: apaga categorias e itens atuais e grava o arquivo, numa transação só.
 * Fotos de itens com o mesmo nome são reaproveitadas. Pedidos já feitos não mudam.
 * Formato do arquivo: ver lib/menu/import.ts.
 *
 * Fotos: item com "image" (URL https) tem a foto baixada, conferida (JPEG/PNG/WebP, até 1,5 MB)
 * e enviada ao armazenamento. A simulação só baixa e confere. Foto que falhar não trava a
 * importação: o item entra sem foto e aparece no relatório. --sem-fotos ignora as URLs.
 * Fotos antigas que ficarem sem uso depois de gravar são apagadas do armazenamento.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { importMenuOn, itemNameKey, listMenuOn } from "@/lib/db/menu";
import { makeDb, resolveTenantOn } from "@/lib/db/core";
import { fetchImage } from "@/lib/media/fetch-image";
import { buildKey } from "@/lib/media/keys";
import { mediaStorage } from "@/lib/media/storage";
import { parseMenuImport, type ImportItem } from "@/lib/menu/import";
import { formatBrl } from "@/lib/menu/rules";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const replace = args.includes("--substituir");
const semFotos = args.includes("--sem-fotos");
const [slug, arquivo] = args.filter((a) => !a.startsWith("--"));
if (!slug || !arquivo) {
  console.error("uso: node dist-scripts/import-menu.mjs <slug> <arquivo.json> [--substituir] [--apply] [--sem-fotos]");
  process.exit(2);
}

const parsed = parseMenuImport(JSON.parse(readFileSync(arquivo, "utf8")));
if (!parsed.ok) {
  console.error("✗ arquivo com problemas, nada foi gravado:");
  parsed.errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}

for (const c of parsed.menu) {
  console.log(`\n${c.name} (${c.items.length})`);
  for (const i of c.items) {
    const preco = i.promoPrice ? `${formatBrl(i.promoPrice)} (de ${formatBrl(i.price)})` : formatBrl(i.price);
    console.log(`  ${i.featured ? "★" : "·"} ${i.name} — ${preco}${i.serves ? ` · serve ${i.serves}` : ""}`);
  }
}
const total = parsed.menu.reduce((t, c) => t + c.items.length, 0);
console.log(`\n${parsed.menu.length} categorias, ${total} itens no arquivo.`);

/** Roda `fn` em todos os itens, até `n` por vez. */
async function emLotes<T>(lista: T[], n: number, fn: (x: T) => Promise<void>) {
  const fila = [...lista];
  await Promise.all(Array.from({ length: Math.min(n, fila.length) }, async () => {
    for (let x = fila.shift(); x !== undefined; x = fila.shift()) await fn(x);
  }));
}
const comFotoNoArquivo: ImportItem[] = semFotos ? [] : parsed.menu.flatMap((c) => c.items.filter((i) => i.image));
const falhas: string[] = [];

if (comFotoNoArquivo.length && !apply) {
  console.log(`\nConferindo ${comFotoNoArquivo.length} fotos (só baixa, não envia)...`);
  await emLotes(comFotoNoArquivo, 4, async (i) => {
    const f = await fetchImage(i.image!);
    if (!f.ok) falhas.push(`${i.name}: ${f.reason}`);
  });
  console.log(`Fotos: ${comFotoNoArquivo.length - falhas.length} ok, ${falhas.length} com problema (o item entra sem foto).`);
  falhas.forEach((f) => console.log("  - " + f));
}

if (!apply && !replace) {
  console.log("Simulação: nada foi gravado. Rode de novo com --apply para gravar.");
  process.exit(0);
}

const { db, close } = makeDb(process.env.DATABASE_URL!, { max: 1 });
try {
  const t = await resolveTenantOn(db, slug);
  if (!t) throw new Error(`restaurante "${slug}" não encontrado`);

  if (replace) {
    const atual = await listMenuOn(db, t.id);
    const itens = atual.flatMap((c) => c.items);
    const novos = new Set(parsed.menu.flatMap((c) => c.items.map((i) => itemNameKey(i.name))));
    const comFoto = itens.filter((i) => i.imageKey);
    const fotoMantida = comFoto.filter((i) => novos.has(itemNameKey(i.name)));
    console.log(`\nCardápio ATUAL de "${slug}" que será APAGADO: ${atual.length} categorias, ${itens.length} itens.`);
    for (const c of atual) console.log(`  - ${c.name}: ${c.items.map((i) => i.name).join(", ") || "(sem itens)"}`);
    console.log(`Fotos: ${fotoMantida.length} reaproveitadas (mesmo nome), ${comFoto.length - fotoMantida.length} ficam sem uso.`);
    if (comFoto.length > fotoMantida.length) {
      console.log("  sem correspondência: " + comFoto.filter((i) => !fotoMantida.includes(i)).map((i) => i.name).join(", "));
    }
  }

  if (!apply) {
    console.log("\nSimulação: nada foi gravado. Rode de novo com --apply para gravar.");
  } else {
    const storage = comFotoNoArquivo.length ? mediaStorage() : null;
    const enviadas: string[] = [];
    if (storage) {
      console.log(`\nEnviando ${comFotoNoArquivo.length} fotos...`);
      await emLotes(comFotoNoArquivo, 4, async (i) => {
        const f = await fetchImage(i.image!);
        if (!f.ok) return void falhas.push(`${i.name}: ${f.reason}`);
        const key = buildKey(t.id, "item", f.type.ext, randomBytes(16).toString("hex"));
        try {
          await storage.put(key, f.bytes, f.type.mime);
          enviadas.push(key);
          i.imageKey = key;
        } catch (e) {
          falhas.push(`${i.name}: envio falhou (${e instanceof Error ? e.message : e})`);
        }
      });
      console.log(`Fotos: ${enviadas.length} enviadas, ${falhas.length} com problema (o item entra sem foto).`);
      falhas.forEach((f) => console.log("  - " + f));
    }
    let r;
    try {
      r = await importMenuOn(db, t.id, parsed.menu, { replace });
    } catch (e) {
      // Nada foi gravado no banco: apaga as fotos que acabaram de subir.
      if (storage) await Promise.allSettled(enviadas.map((k) => storage.delete(k)));
      throw e;
    }
    if (replace) console.log(`\n✓ apagados: ${r.removed.categories} categorias, ${r.removed.items} itens.`);
    console.log(`✓ gravado em "${slug}": ${r.categories} categorias, ${r.items} itens, ${enviadas.length} fotos novas, ${r.photosKept} reaproveitadas.`);
    if (r.orphanPhotos.length) {
      try {
        const st = mediaStorage();
        const res = await Promise.allSettled(r.orphanPhotos.map((k) => st.delete(k)));
        console.log(`✓ ${res.filter((x) => x.status === "fulfilled").length} fotos antigas sem uso apagadas do armazenamento.`);
      } catch {
        console.log(`! ${r.orphanPhotos.length} fotos antigas ficaram sem uso no armazenamento.`);
      }
    }
  }
} catch (e) {
  console.error("✗ " + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
} finally {
  await close();
}
