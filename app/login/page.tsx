import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next, ativado } = await searchParams;
  // Só aceita destinos internos (evita open redirect: ?next=https://site-malicioso)
  const destino = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold">Factoria</h1>
          <p className="text-sm text-neutral-500">Entre com o seu e-mail e senha</p>
        </div>
        {ativado && <p className="text-center text-sm text-green-600">Senha criada. Entre com o seu e-mail e a nova senha.</p>}
        <LoginForm next={destino} />
      </div>
    </main>
  );
}
