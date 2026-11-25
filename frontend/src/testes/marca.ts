/**
 * O contrato da F3-08 (`docs/ecras/F3-08.md`), num sítio só: os testes Vitest
 * e os Playwright partilham-no, como em `cabecalho.ts`.
 */

/** Secção 6, validada pelo dominio-bar. A `og:description` é exatamente esta. */
export const FRASE_DA_DESCRICAO =
  "Ementa com preços, password do WiFi, eventos e fotografias do Bar da Tomazia, em Estarreja.";

export const NOME_ACESSIVEL_DO_LOGOTIPO = "Bar da Tomazia";
export const ALT_DA_IMAGEM_DE_PARTILHA = "Logótipo do Bar da Tomazia";

/** `bordo-noite` e `creme-papel`, em RGB. */
export const BORDO_NOITE = [0x3d, 0x0f, 0x24] as const;
export const CREME_PAPEL = [0xf5, 0xe6, 0xd3] as const;

/** Secção 3: caminhos relativos a `frontend/public/`, e tetos em bytes. */
export const LOGOTIPOS = [
  { ficheiro: "marca/logo-44.webp", lado: 44, teto: 4 * 1024 },
  { ficheiro: "marca/logo-88.webp", lado: 88, teto: 8 * 1024 },
  { ficheiro: "marca/logo-132.webp", lado: 132, teto: 12 * 1024 },
] as const;

export const TETO_DA_SOMA_DOS_LOGOTIPOS = 24 * 1024;

export const OUTROS_ICONES = {
  "favicon.ico": 15 * 1024,
  "favicon-32.png": 4 * 1024,
  "apple-touch-icon.png": 25 * 1024,
  "og-image.jpg": 100 * 1024,
} as const;

/** Todos os ficheiros gerados pelo script, relativos a `public/`. */
export const FICHEIROS_GERADOS = [
  ...LOGOTIPOS.map((logotipo) => logotipo.ficheiro),
  ...Object.keys(OUTROS_ICONES),
];

/** O que as decisões do Tomás (2026-11-25) dizem sobre a variável. */
export const URL_PUBLICA_PROVISORIA = "https://novo.bardatomazia.pt";
export const URL_PUBLICA_FINAL = "https://bardatomazia.pt";
export const NOME_DA_VARIAVEL = "VITE_URL_PUBLICA";
