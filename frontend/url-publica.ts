/**
 * O endereço público do site, para o `og:image` absoluto (F3-08, secção 5).
 *
 * O `index.html` traz `%URL_PUBLICA%` e **não** o domínio escrito: o domínio
 * muda no corte (F5-02) e vive só na variável do CI, `VITE_URL_PUBLICA`.
 *
 * **Em qualquer build, variável em falta, vazia ou que não seja `https://` +
 * anfitrião (sem caminho, sem espaços) faz o build falhar**, com o nome dela
 * na mensagem. Regra 10: "sem domínio" nunca pode dar o mesmo que um
 * `og:image` relativo ou torto em silêncio. O servidor de desenvolvimento e o
 * `preview` não precisam dela e usam `http://localhost:5173`.
 *
 * Lê-se do ambiente do processo e **não** de `.env*`. Uma barra final tira-se,
 * para que o endereço nunca fique com `//`.
 */
export const VARIAVEL_URL_PUBLICA = "VITE_URL_PUBLICA";
export const URL_EM_DESENVOLVIMENTO = "http://localhost:5173";

const FORMA_VALIDA = /^https:\/\/[^/\s"'<>]+$/;

export function resolverUrlPublica(
  command: "build" | "serve",
  ambiente: Record<string, string | undefined> = process.env,
): string {
  const valor = (ambiente[VARIAVEL_URL_PUBLICA] ?? "").trim().replace(/\/+$/, "");
  if (command !== "build") return valor === "" ? URL_EM_DESENVOLVIMENTO : valor;

  if (!FORMA_VALIDA.test(valor)) {
    throw new Error(
      `${VARIAVEL_URL_PUBLICA} não está definida ou não é válida («${valor}»): o og:image do ` +
        "index.html precisa de https:// e o anfitrião, sem caminho nem espaços. Define-a, " +
        `por exemplo ${VARIAVEL_URL_PUBLICA}=https://novo.bardatomazia.pt, e volta a construir.`,
    );
  }
  return valor;
}
