"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/errors";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  // onSubmit (e não action): com action, o React 19 limpa o formulário ao terminar,
  // e o usuário perderia o e-mail digitado a cada senha errada.
  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setEnviando(true);
    const { error } = await authClient.signIn
      .email({
        email: String(formData.get("email") ?? "").trim(),
        password: String(formData.get("password") ?? ""),
      })
      .catch(() => ({ error: { status: 0 } })); // rede fora do ar
    setEnviando(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">E-mail</span>
        <input name="email" type="email" autoComplete="email" required
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Senha</span>
        <input name="password" type="password" autoComplete="current-password" required
          className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700" />
      </label>
      <button type="submit" disabled={enviando}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
        {enviando ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
