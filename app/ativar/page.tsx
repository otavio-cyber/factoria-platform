import type { Metadata } from "next";
import { AtivarForm } from "./ativar-form";

export const metadata: Metadata = { title: "Criar senha" };

// Página pública: o Better Auth redireciona para cá com ?token=... (ou ?error=INVALID_TOKEN).
export default async function AtivarPage({ searchParams }: PageProps<"/ativar">) {
  const { token, error } = await searchParams;
  const valido = typeof token === "string" && token.length > 10 && !error;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Criar sua senha</h1>
          <p className="text-sm text-neutral-500">Factoria</p>
        </div>
        {valido ? (
          <AtivarForm token={token} />
        ) : (
          <p role="alert" className="text-center text-sm text-red-600">
            Este link é inválido ou expirou. Peça um novo link à Factoria.
          </p>
        )}
      </div>
    </main>
  );
}
