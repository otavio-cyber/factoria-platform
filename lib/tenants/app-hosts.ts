/** Hosts do próprio app (painel). Qualquer outro host é domínio de restaurante. */
function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

// APP_INTERNAL_URL: endereço do app na rede interna do Docker (ex.: http://factoria-app:3000),
// usado pela Evolution para entregar eventos. Só existe na rede interna do servidor; o público nunca chega por ele.
export const APP_HOSTS: string[] = [
  hostOf(process.env.BETTER_AUTH_URL),
  hostOf(process.env.APP_INTERNAL_URL),
  "localhost",
  "127.0.0.1",
].filter((h): h is string => Boolean(h));
