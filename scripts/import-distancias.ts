/**
 * Importa a planilha de distâncias por bairro (CSV) para um restaurante. Por padrão só SIMULA.
 *
 *   node dist-scripts/import-distancias.mjs <slug> <arquivo.csv>           # simulação
 *   node dist-scripts/import-distancias.mjs <slug> <arquivo.csv> --apply   # grava
 *
 * Bairro novo entra; bairro existente tem a distância e o "entrega?" atualizados. Nada é apagado.
 * As faixas de frete são cadastradas no painel (Entrega → Frete por distância).
 */
import { readFileSync } from "node:fs";
import { importDistrictDistancesOn, getDeliverySettingsOn } from "@/lib/db/orders";
import { makeDb, resolveTenantOn } from "@/lib/db/core";
import { parseDistancesCsv } from "@/lib/orders/import-distances";
import { bandFor, metersToKm } from "@/lib/orders/rules";
import { formatBrl } from "@/lib/menu/rules";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [slug, arquivo] = args.filter((a) => !a.startsWith("--"));
if (!slug || !arquivo) {
  console.error("uso: node dist-scripts/import-distancias.mjs <slug> <arquivo.csv> [--apply]");
  process.exit(2);
}

const p = parseDistancesCsv(readFileSync(arquivo, "utf8"));
if (!p.ok) {
  console.error("✗ planilha com problemas, nada foi gravado:");
  p.errors.forEach((e) => console.error("  - " + e));
  process.exit(1);
}

const { db, close } = makeDb(process.env.DATABASE_URL!, { max: 1 });
try {
  const t = await resolveTenantOn(db, slug);
  if (!t) throw new Error(`restaurante "${slug}" não encontrado`);
  const { bands } = await getDeliverySettingsOn(db, t.id);
  for (const r of p.rows) {
    const f = r.distanceM !== null ? bandFor(bands, r.distanceM) : null;
    const frete = !r.active ? "não entregamos" : !bands.length ? "(sem faixas cadastradas)" : f ? formatBrl(f.feeCents) : "fora da área";
    console.log(`  ${r.name} — ${r.distanceM !== null ? metersToKm(r.distanceM) + " km" : "-"} — ${frete}`);
  }
  console.log(`\n${p.rows.length} bairros para gravar; ${p.skipped} sem distância ignorados.`);
  if (!bands.length) console.log("Atenção: este restaurante ainda não tem faixas de frete (painel → Entrega).");
  if (!apply) console.log("Simulação: nada foi gravado. Rode de novo com --apply para gravar.");
  else console.log(`✓ gravados ${await importDistrictDistancesOn(db, t.id, p.rows)} bairros em "${slug}".`);
} catch (e) {
  console.error("✗ " + (e instanceof Error ? e.message : String(e)));
  process.exitCode = 1;
} finally {
  await close();
}
