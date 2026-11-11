/**
 * Armazenamento das fotos.
 * - Produção: bucket PRIVADO no Backblaze B2 (API S3), só o app lê e grava.
 * - Desenvolvimento: pasta local `.media/` (sem bucket).
 * As fotos chegam ao público pela rota /midia/<chave>, com cache longo na Cloudflare.
 */
import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { isValidKey } from "./keys";

export interface MediaStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class MediaNotConfigured extends Error {}

export function s3Storage(cfg: { endpoint: string; region: string; bucket: string; keyId: string; secret: string }): MediaStorage {
  const aws = new AwsClient({ accessKeyId: cfg.keyId, secretAccessKey: cfg.secret, service: "s3", region: cfg.region, retries: 2 }); // falha rápida: o usuário pode tentar de novo
  const url = (key: string) => `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${key}`;
  return {
    async put(key, body, contentType) {
      const r = await aws.fetch(url(key), {
        method: "PUT",
        body: body as BodyInit,
        headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
      });
      if (!r.ok) throw new Error(`armazenamento recusou o envio (${r.status})`);
    },
    async get(key) {
      const r = await aws.fetch(url(key));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`armazenamento indisponível (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async delete(key) {
      const r = await aws.fetch(url(key), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`falha ao apagar (${r.status})`);
    },
  };
}

function localStorage(dir: string): MediaStorage {
  const file = (key: string) => {
    if (!isValidKey(key)) throw new Error("chave inválida");
    return path.join(dir, key);
  };
  return {
    async put(key, body) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(file(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await rm(file(key), { force: true });
    },
  };
}

let cached: MediaStorage | null | undefined;

/** Armazenamento configurado. Em produção sem bucket: lança MediaNotConfigured. */
export function mediaStorage(): MediaStorage {
  if (cached === undefined) {
    const e = process.env;
    if (e.MEDIA_S3_BUCKET && e.MEDIA_S3_ENDPOINT && e.MEDIA_S3_KEY_ID && e.MEDIA_S3_SECRET) {
      const region = e.MEDIA_S3_REGION || /s3\.([a-z0-9-]+)\./.exec(e.MEDIA_S3_ENDPOINT)?.[1] || "us-east-1";
      cached = s3Storage({ endpoint: e.MEDIA_S3_ENDPOINT, region, bucket: e.MEDIA_S3_BUCKET, keyId: e.MEDIA_S3_KEY_ID, secret: e.MEDIA_S3_SECRET });
    } else if (e.NODE_ENV !== "production") {
      cached = localStorage(path.resolve(e.MEDIA_LOCAL_DIR || ".media"));
    } else {
      cached = null;
    }
  }
  if (!cached) throw new MediaNotConfigured("O armazenamento de fotos ainda não foi configurado.");
  return cached;
}
