/**
 * Mensagem clara para cada erro de autenticação.
 *
 * Única exceção de propósito: e-mail inexistente e senha errada têm a MESMA mensagem.
 * Diferenciar permitiria descobrir quais e-mails são clientes da Factoria (enumeração de contas).
 */
type AuthError = { status?: number; code?: string; message?: string } | null | undefined;

export function authErrorMessage(error: AuthError): string {
  if (!error) return "Algo deu errado. Tente de novo.";
  const { status, code } = error;

  if (status === 429) return "Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.";
  if (code === "BANNED_USER") return "Esta conta está bloqueada. Fale com a Factoria.";
  if (code === "INVALID_ORIGIN" || code === "MISSING_OR_NULL_ORIGIN") {
    return "Acesso por um endereço não autorizado. Abra o sistema pelo endereço oficial.";
  }
  if (code === "INVALID_TOKEN" || code === "INVALID_TOKEN_OR_EXPIRED") {
    return "Este link é inválido, já foi usado ou expirou. Peça um novo link à Factoria.";
  }
  if (code === "PASSWORD_TOO_SHORT") return "A senha precisa ter pelo menos 10 caracteres.";
  if (code === "PASSWORD_TOO_LONG") return "A senha é longa demais.";
  if (code === "INVALID_EMAIL_OR_PASSWORD" || status === 401) return "E-mail ou senha inválidos.";
  if (!status) return "Sem conexão com o servidor. Verifique sua internet.";
  if (status >= 500) return "O servidor teve um problema. Tente de novo em instantes.";
  return error.message || "Algo deu errado. Tente de novo.";
}
