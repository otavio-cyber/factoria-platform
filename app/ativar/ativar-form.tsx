"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/errors";

const input = "w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 dark:border-neutral-700";

export function AtivarForm({ token }: { token: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  // onSubmit: evita o React 19 limpar os campos quando a validação falha.
  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const senha = String(formData.get("password") ?? "");
    const confirma = String(formData.get("confirm") ?? "");
    if (senha.length < 10) return void toast.error("A senha precisa ter pelo menos 10 caracteres.");
    if (senha !== confirma) return void toast.error("As senhas não conferem.");
    setEnviando(true);
    const { error } = await authClient
      .resetPassword({ newPassword: senha, token })
      .catch(() => ({ error: { status: 0 } }));
    setEnviando(false);
    if (error) {
      // Link inválido/usado costuma vir como 400 genérico: trata como link inválido.
      toast.error(error.status === 400 ? authErrorMessage({ code: "INVALID_TOKEN" }) : authErrorMessage(error));
      return;
    }
    router.replace("/login?ativado=1");
  }

  return (
    <form onSubmit={salvar} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Nova senha</span>
        <input name="password" type="password" autoComplete="new-password" minLength={10} required className={input} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">Repita a senha</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={input} />
      </label>
      <button type="submit" disabled={enviando}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-60 dark:bg-white dark:text-neutral-900">
        {enviando ? "Salvando..." : "Criar senha"}
      </button>
    </form>
  );
}
