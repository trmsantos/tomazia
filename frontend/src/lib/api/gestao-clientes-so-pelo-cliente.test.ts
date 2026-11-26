// @vitest-environment node
/**
 * F4-05b, plano do arquiteto — os módulos novos da API **só falam com o servidor pelo cliente**
 * (`pedir` e o modo de resposta em bytes que o CSV acrescenta a `cliente.ts`): nenhum `fetch`,
 * `XMLHttpRequest` ou `sendBeacon` em `gestao-resumo.ts` nem em `gestao-clientes.ts` (a varredura
 * geral de `fetch-so-no-cliente.test.ts` deixa `src/lib/api/` de fora por inteiro, por ser o
 * sítio do cliente — e este é o buraco que isso abre: um `fetch` à mão num módulo irmão não leva
 * `X-Tomazia`, credenciais nem a base relativa), e **nenhum `createObjectURL`** (a CSP proíbe
 * `blob:`; o ficheiro sai por um endereço `data:`).
 *
 * Falha com «não consegui procurar» se os ficheiros não existem (regra 10): zero ficheiros lidos
 * nunca é «limpo».
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RAIZ_FRONTEND, lerTexto, linhasQueCorrespondem } from "../../testes/percorrer-arvore";

const MODULOS = ["src/lib/api/gestao-resumo.ts", "src/lib/api/gestao-clientes.ts"];
const PEDIDO_DIRETO = /\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(|\bcreateObjectURL\b/;

function codigo(linha: string): boolean {
  return !/^\s*(\/\/|\/\*|\*)/.test(linha);
}

describe("os módulos da API do Início e dos Clientes", () => {
  it("existem (sem isto, «não encontrei nada» não prova nada)", () => {
    const emFalta = MODULOS.filter((relativo) => !existsSync(join(RAIZ_FRONTEND, relativo)));
    expect(emFalta, "ficheiros em falta: a varredura não tem onde procurar").toEqual([]);
  });

  it.each(MODULOS)("%s não faz pedidos à mão nem cria blob:", (relativo) => {
    const texto = lerTexto(join(RAIZ_FRONTEND, relativo), relativo);
    const linhas = linhasQueCorrespondem(
      texto,
      (linha) => codigo(linha) && PEDIDO_DIRETO.test(linha),
    );
    expect(
      linhas,
      `${relativo}: usa o cliente (\`pedir\` ou o modo de bytes de cliente.ts), nunca \`fetch\` nem \`createObjectURL\``,
    ).toEqual([]);
  });

  it("e o cliente (cliente.ts) continua a ser o único sítio com `fetch` em src/lib/api", () => {
    const texto = lerTexto(join(RAIZ_FRONTEND, "src/lib/api/cliente.ts"), "src/lib/api/cliente.ts");
    expect(
      linhasQueCorrespondem(texto, (l) => codigo(l) && /\bfetch\s*\(/.test(l)).length,
    ).toBeGreaterThan(0);
  });
});
