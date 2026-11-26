/**
 * O que é uma ligação e o que é só texto, nos contactos (F3-06a, 6.2 a 6.4).
 *
 * É a fronteira de segurança do que chega a um `href` (S-13: nada de
 * `javascript:`). Três regras que valem para todas:
 *
 * 1. **O `href` é a cadeia original, byte a byte.** Nunca se corrige o que o
 *    dono escreveu: uma ligação que só passa depois de a «arranjar» é uma que
 *    ele não escreveu.
 * 2. **Qualquer espaço ou caractere de controlo recusa.** O `URL()` apaga as
 *    tabulações e quebras de linha do meio e aceita-as como se não existissem,
 *    e o `href` que se escrevia na página levava-as.
 * 3. **`null` é «isto não é uma ligação»**: o bloco desaparece (4.4) ou, no
 *    telefone, fica só texto. Nunca é «inválida» no ecrã.
 */

/** O rótulo quando o endereço não traz um nome de conta (`/p/…`, a raiz). */
const SEM_NOME_DE_CONTA = "Ver no Instagram";

/** Os caminhos de primeiro nível do Instagram que não são contas. */
const NAO_SAO_CONTAS = new Set(["p", "reel", "reels", "explore", "stories", "tv"]);

const CONTA_DO_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

/** Espaços e controlos em qualquer posição, incluindo os das pontas. */
// eslint-disable-next-line no-control-regex
const ESPACO_OU_CONTROLO = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * Um `https://anfitrião/…` sem credenciais, ou `null`.
 *
 * O `https:///x` e o `https:exemplo.test/x` são aceites pelo `URL()` (que os
 * «arranja» para `https://x/` e `https://exemplo.test/x`), por isso o formato
 * exige-se à mão: `https://` e logo a seguir o anfitrião.
 */
function lerHttps(texto: string | null): URL | null {
  if (texto === null || ESPACO_OU_CONTROLO.test(texto)) return null;
  if (!/^https:\/\/[^/\\?#]/i.test(texto)) return null;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname === "") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url;
}

/** O `href` do botão do Google Maps: qualquer `https` válido, tal e qual. */
export function ligacaoDoMaps(url: string | null): string | null {
  return lerHttps(url) === null ? null : url;
}

/** A ligação do Instagram e o seu rótulo («@nome» ou «Ver no Instagram»). */
export function ligacaoDoInstagram(url: string | null): { href: string; rotulo: string } | null {
  const lida = lerHttps(url);
  if (url === null || lida === null) return null;
  // `www.` é o único subdomínio aceite, e a porta recusa-se (a regra da gestão também).
  if (lida.hostname !== "instagram.com" && lida.hostname !== "www.instagram.com") return null;
  if (lida.port !== "") return null;

  const primeiro = lida.pathname.split("/")[1] ?? "";
  const eConta = CONTA_DO_INSTAGRAM.test(primeiro) && !NAO_SAO_CONTAS.has(primeiro.toLowerCase());

  return { href: url, rotulo: eConta ? `@${primeiro}` : SEM_NOME_DE_CONTA };
}

/**
 * O `href` `tel:` de um telefone, **só se o texto for um número**.
 *
 * Tiram-se espaços, pontos, hífenes e parênteses; o resto tem de ser 9 a 15
 * dígitos, com um `+` ou um `00` à frente se quiser. `00` vira `+` no `href`.
 * Tudo o resto («Pergunta no balcão», «234 123 456 (chamada para a rede fixa)»)
 * fica como texto, tal como o dono o escreveu.
 */
export function ligacaoDoTelefone(texto: string | null): string | null {
  if (texto === null) return null;

  const numero = texto.replace(/[\s.\-()]/g, "");
  if (!/^(\+|00)?[0-9]{9,15}$/.test(numero)) return null;

  return `tel:${numero.startsWith("00") ? `+${numero.slice(2)}` : numero}`;
}
