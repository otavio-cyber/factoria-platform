/**
 * Planilha de distâncias por bairro (CSV exportado do Excel/LibreOffice) → linhas para o banco.
 * Colunas: "Bairro", "Distância (km)" e, opcional, "Entrega?" (Sim/Não). Separador ; ou ,
 * Linha sem distância e com Entrega = Sim é ignorada (o bairro entra sozinho quando aparecer num pedido).
 */
import { parseKm } from "./rules";

export type DistanceRow = { name: string; distanceM: number | null; active: boolean };

function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const norm = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function parseDistancesCsv(text: string): { ok: true; rows: DistanceRow[]; skipped: number } | { ok: false; errors: string[] } {
  const linhas = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return { ok: false, errors: ["Arquivo vazio ou sem linhas de bairro."] };
  const sep = linhas[0].includes(";") ? ";" : ",";
  const head = splitCsv(linhas[0], sep).map(norm);
  const iNome = head.findIndex((h) => h.startsWith("bairro"));
  const iDist = head.findIndex((h) => h.startsWith("distancia"));
  const iEnt = head.findIndex((h) => h.startsWith("entrega"));
  if (iNome < 0 || iDist < 0) return { ok: false, errors: ['Cabeçalho precisa ter as colunas "Bairro" e "Distância (km)".'] };

  const rows: DistanceRow[] = [];
  const errors: string[] = [];
  const vistos = new Set<string>();
  let skipped = 0;
  for (const [i, l] of linhas.slice(1).entries()) {
    const c = splitCsv(l, sep);
    const nome = (c[iNome] ?? "").slice(0, 80);
    if (!nome) continue;
    const entrega = iEnt < 0 ? true : !norm(c[iEnt] ?? "").startsWith("n");
    const dist = parseKm(c[iDist] ?? "");
    if (dist === undefined) {
      errors.push(`Linha ${i + 2} (${nome}): distância inválida "${c[iDist]}".`);
      continue;
    }
    if (dist === null && entrega) {
      skipped++;
      continue;
    }
    const chave = norm(nome).replace(/\s+/g, " ");
    if (vistos.has(chave)) {
      errors.push(`Linha ${i + 2}: bairro repetido "${nome}".`);
      continue;
    }
    vistos.add(chave);
    rows.push({ name: nome, distanceM: dist, active: entrega });
  }
  return errors.length ? { ok: false, errors } : { ok: true, rows, skipped };
}
