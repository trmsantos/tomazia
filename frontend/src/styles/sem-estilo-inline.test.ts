// @vitest-environment node
/**
 * F3-01 — nenhum `style` inline, porque a CSP de produção o bloqueia.
 *
 * `deploy/htaccess.exemplo` serve
 * `Content-Security-Policy: … style-src 'self' …`, sem `'unsafe-inline'`.
 * Um `style={{ … }}` em JSX vira um atributo `style=` no HTML, e um
 * `style-src 'self'` estrito **não** permite atributos de estilo. O modo de
 * falha é o pior deste projeto: o servidor de desenvolvimento do Vite não
 * aplica CSP nenhuma, por isso funciona na máquina de quem escreve e parte
 * no servidor, onde ninguém está a olhar. É o mesmo raciocínio do ADR 0008.
 *
 * Dois mecanismos independentes, como no S-13:
 *  1. uma regra de ESLint, verificada contra a configuração real do
 *     projeto (`eslint.config.js`), e não contra uma config inventada aqui;
 *  2. uma varredura do código em disco, que nenhum `eslint-disable`
 *     desliga.
 *
 * Buraco conhecido do seletor (aceite, documentado): um objeto `{ style }`
 * montado fora do JSX e espalhado com `{...propriedades}`. Alargar o
 * seletor a `Property[key.name='style']` acusaria qualquer objeto com uma
 * chave `style`. A terceira rede é a verificação de CSP no
 * `e2e/componentes.spec.ts`, que vê o resultado e não a forma.
 */
import { join } from "node:path";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

import { COMPONENTES_DA_F3_01 } from "../testes/componentes";
import { FICHEIROS_DA_F3_05, FICHEIROS_DA_F4_02, FICHEIROS_DA_F4_05A } from "../testes/ecras";
import {
  RAIZ_FRONTEND,
  caminhoRelativo,
  exigirSentinelas,
  lerTexto,
  listarFicheiros,
} from "../testes/percorrer-arvore";

const CODIGO_COM_STYLE_EM_JSX = `
export function Exemplo({ largura }: { largura: number }) {
  return <div style={{ width: largura }} />;
}
`;

const CODIGO_SEM_STYLE = `
export function Exemplo({ estreito }: { estreito: boolean }) {
  return <div className={estreito ? "max-w-vazio" : "max-w-coluna"} />;
}
`;

/**
 * Arrancar o ESLint em processo custa segundos, não milissegundos: ele lê a
 * flat config, resolve os plugins e constrói o Linter. O primeiro `it` de
 * cada bloco paga essa conta inteira e chega a levar sete segundos numa
 * máquina ocupada — acima dos 5 s por omissão do Vitest. Sem este limite, o
 * teste falhava a dizer "timed out" e não "a regra não acusou", que são
 * coisas opostas: a primeira é a máquina lenta, a segunda é o S-13 a cair.
 */
const ESPERA_PELO_ESLINT = { timeout: 30_000 };

describe("o ESLint acusa um style inline", ESPERA_PELO_ESLINT, () => {
  it("um style={{ … }} em JSX dá erro com a config real do projeto", async () => {
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const [resultado] = await eslint.lintText(CODIGO_COM_STYLE_EM_JSX, {
      filePath: "src/exemplo-estilo-inline.tsx",
    });

    expect(resultado, "o ESLint tem de devolver exatamente um resultado").toBeDefined();
    expect(resultado?.errorCount ?? 0).toBeGreaterThan(0);
    expect(resultado?.messages.map((mensagem) => mensagem.ruleId)).toContain(
      "no-restricted-syntax",
    );
    expect(
      resultado?.messages.map((mensagem) => mensagem.message).join(" "),
      "a mensagem tem de dizer porquê, não só «proibido»",
    ).toMatch(/CSP|style-src/i);
  });

  it("o mesmo componente sem style passa — a regra não acusa tudo", async () => {
    const eslint = new ESLint({ cwd: RAIZ_FRONTEND });

    const [resultado] = await eslint.lintText(CODIGO_SEM_STYLE, {
      filePath: "src/exemplo-sem-estilo-inline.tsx",
    });

    expect(resultado?.errorCount ?? 0).toBe(0);
  });
});

describe("varredura em disco, que nenhum eslint-disable desliga", () => {
  it("nenhum componente nem página escreve um atributo style", () => {
    const ficheiros = listarFicheiros(join(RAIZ_FRONTEND, "src"), {
      extensoes: [".ts", ".tsx"],
    }).filter((ficheiro) => {
      const relativo = caminhoRelativo(ficheiro);
      return (
        // O cliente e os módulos de API escritos à mão entram (F4-02: `gestao-ementa.ts` é
        // sentinela); só o `gerado/`, que se escreve com `npm run gerar-api`, fica de fora.
        !relativo.startsWith("src/lib/api/gerado/") &&
        !relativo.endsWith("sem-estilo-inline.test.ts") &&
        !/\.test\.tsx?$/.test(relativo)
      );
    });

    exigirSentinelas(
      ficheiros,
      [
        ...COMPONENTES_DA_F3_01,
        "src/App.tsx",
        ...FICHEIROS_DA_F3_05,
        ...FICHEIROS_DA_F4_02,
        ...FICHEIROS_DA_F4_05A,
      ],
      "style inline",
    );

    const violacoes: string[] = [];
    for (const ficheiro of ficheiros) {
      const relativo = caminhoRelativo(ficheiro);
      lerTexto(ficheiro, relativo)
        .split("\n")
        .forEach((linha, indice) => {
          if (/\bstyle\s*=\s*[{"']/.test(linha)) {
            violacoes.push(`${relativo}:${indice + 1}`);
          }
        });
    }

    expect(
      violacoes,
      "A CSP `style-src 'self'` bloqueia style inline em produção. Usa uma classe.",
    ).toEqual([]);
  });
});
