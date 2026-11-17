/**
 * As tabelas de endereços do backend, **copiadas por script** (não escritas de
 * memória) de `backend/tests/seguranca/test_maps_url_e_instagram_so_aceitam_https.py`
 * (F2-05c): `PERIGOSOS` e as duas listas de anfitriões do Instagram. A validação
 * local das definições (F4-05a) tem de recusar tudo o que o backend recusa e
 * aceitar tudo o que ele aceita. `src/pages/gestao/definicoes/validar-campos.test.ts`
 * confere, lendo o ficheiro do backend, que o número de entradas ainda é este.
 *
 * Só para testes; nada em produção o importa.
 */

/** O ficheiro de origem, relativo à raiz do repositório. */
export const FICHEIRO_DE_ORIGEM_DOS_LINKS =
  "backend/tests/seguranca/test_maps_url_e_instagram_so_aceitam_https.py";

/** `PERIGOSOS`: o backend responde 422 a cada uma, em `maps_url` e em `instagram`. */
export const PERIGOSOS_DO_BACKEND: readonly string[] = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "JAVASCRIPT:alert(1)",
  "  javascript:alert(1)",
  "\tjavascript:alert(1)",
  "\njavascript:alert(1)",
  "java\tscript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "DATA:text/html;base64,PHNjcmlwdD4=",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "ftp://exemplo.test/x",
  "http://www.instagram.com/exemplo",
  "HTTP://maps.example.test/x",
  "//maps.example.test/x",
  "/place/tomazia",
  "www.instagram.com/exemplo",
  "https:maps.example.test",
  "https://",
  "https:///caminho",
  " https://maps.example.test/x",
  "\thttps://maps.example.test/x",
  "\nhttps://maps.example.test/x",
  "\u00a0https://maps.example.test/x",
];

/** `test_instagram_aceita_os_dois_anfitrioes_do_instagram`. */
export const INSTAGRAM_ACEITES_PELO_BACKEND: readonly string[] = [
  "https://www.instagram.com/tomazia.bar",
  "https://instagram.com/tomazia.bar",
];

/** `test_instagram_recusa_outros_anfitrioes_mesmo_com_https`. */
export const INSTAGRAM_RECUSADOS_PELO_BACKEND: readonly string[] = [
  "https://evil.example.test/tomazia",
  "https://instagram.com.evil.example.test/tomazia",
  "https://evilinstagram.com/tomazia",
  "https://www.instagram.com@evil.example.test/tomazia",
  "https://instagram.com:pass@evil.example.test/",
  "https://evil.example.test/www.instagram.com",
  "https://evil.example.test/?u=https://www.instagram.com/x",
];
