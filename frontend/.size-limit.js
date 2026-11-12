// F4-01: mede o pacote de ENTRADA (o que o index.html construído carrega) e não
// todos os .js de `dist/assets`: com a gestão carregada à parte, a soma antiga
// contava-a como se fosse pública.
// Rebenta se `dist/` não existir — nunca uma lista vazia (regra 10).
import { join } from "node:path";

import { pacoteDeEntrada } from "./ferramentas/pacote-de-entrada.mjs";

const dist = join(import.meta.dirname, "dist");

export default [
  {
    name: "JavaScript da área pública (pacote de entrada)",
    path: pacoteDeEntrada(dist),
    limit: "100 kB",
    gzip: true,
  },
];
