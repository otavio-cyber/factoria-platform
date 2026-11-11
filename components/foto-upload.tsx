"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { enviarFoto, removerFoto, type FotoAlvo } from "@/app/t/[slug]/fotos-actions";
import { MAX_BYTES } from "@/lib/media/keys";

/**
 * Reduz a foto no navegador antes de enviar: celular tira fotos de 5–10 MB.
 * Redesenhar no canvas também descarta os metadados da câmera (inclusive localização).
 */
async function reduzir(file: File, ladoMax: number): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * escala);
  canvas.height = Math.round(bmp.height * escala);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const gerar = (tipo: string, q: number) =>
    new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, q));
  for (const q of [0.85, 0.7, 0.55]) {
    let b = await gerar("image/webp", q);
    if (!b || b.type !== "image/webp") b = await gerar("image/jpeg", q); // navegador sem WebP
    if (b && b.size <= MAX_BYTES) return b;
  }
  throw new Error("grande demais");
}

export function FotoUpload({
  slug,
  alvo,
  url,
  formato = "quadrado",
  podeEditar = true,
  rotulo = "Foto",
}: {
  slug: string;
  alvo: FotoAlvo;
  url: string | null;
  formato?: "quadrado" | "capa";
  podeEditar?: boolean;
  rotulo?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [atual, setAtual] = useState(url);
  const [pending, start] = useTransition();
  const caixa = formato === "capa" ? "aspect-[3/1] w-full" : "aspect-square w-28";

  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    start(async () => {
      let blob: Blob;
      try {
        blob = await reduzir(file, formato === "capa" ? 1920 : 1200);
      } catch {
        toast.error("Não consegui abrir essa imagem. Tente outra foto (JPG ou PNG).");
        return;
      }
      const form = new FormData();
      form.append("foto", blob, blob.type === "image/webp" ? "foto.webp" : "foto.jpg");
      const r = await enviarFoto(slug, alvo, form);
      if (!r.ok) return void toast.error(r.message);
      setAtual(r.url);
      toast.success("Foto salva.");
      router.refresh();
    });
  }

  function remover() {
    if (!confirm("Remover esta foto?")) return;
    start(async () => {
      const r = await removerFoto(slug, alvo);
      if (!r.ok) return void toast.error(r.message);
      setAtual(null);
      toast.success("Foto removida.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <span className="text-sm">{rotulo}</span>
      <div className={`${caixa} overflow-hidden rounded-md border border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900`}>
        {atual ? (
          // eslint-disable-next-line @next/next/no-img-element -- já otimizada no envio; servida com cache longo
          <img src={atual} alt={rotulo} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">Sem foto</div>
        )}
      </div>
      {podeEditar && (
        <div className="flex gap-3 text-sm">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={escolher} />
          <button type="button" disabled={pending} className="hover:underline disabled:opacity-50" onClick={() => input.current?.click()}>
            {pending ? "Enviando..." : atual ? "Trocar foto" : "Enviar foto"}
          </button>
          {atual && !pending && (
            <button type="button" className="text-red-600 hover:underline" onClick={remover}>Remover</button>
          )}
        </div>
      )}
    </div>
  );
}
