// @vitest-environment node
/**
 * F3-04, 12.5 — cada frase do ecrã está na tabela da especificação.
 *
 * Mesma forma do `textos-da-ementa.test.ts`, e existe pela razão que o outro
 * já provou: a varredura do Q-05 apanha "cardápio", o gerúndio e as
 * reticências de três pontos, **não** apanha uma frase inteira a dizer outra
 * coisa — e foi por essa fresta que passaram duas afirmações falsas sobre o
 * bar na F3-02.
 *
 * Nesta secção há ainda uma razão só dela: **dezanove das palavras visíveis
 * são uma tabela nossa** (os sete dias e os doze meses, 5.4). Um aparelho com
 * ICU reduzido escreveria "Thursday" no meio de uma página em português, o CI
 * nunca o apanharia — o Node tem ICU completo — e a varredura do Q-05 também
 * não, porque a palavra inglesa não estaria escrita em ficheiro nenhum nosso.
 * Aqui prende-se a tabela do teste à da especificação; `data-do-evento.test.ts`
 * prende a do código à do teste.
 *
 * **O que deixa passar:** uma frase que esteja na tabela e no código e esteja
 * errada nas duas. Isso é revisão humana, e é para isso que a secção 9 está
 * escrita de maneira a ser lida de uma vez.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DIAS_ESPERADOS,
  MESES_ESPERADOS,
  TEXTOS_DOS_EVENTOS,
  aPartirDas,
  comecouAs,
  dataPorExtenso,
  diaEHora,
} from "../../testes/eventos";
import { RAIZ_REPOSITORIO, lerTexto } from "../../testes/percorrer-arvore";

const ESPECIFICACAO = "docs/ecras/F3-04.md";

/**
 * O piso de contagem, que é o guarda da regra 10 (12.5).
 *
 * Uma expressão regular que deixe de condizer — porque o título da secção
 * mudou, porque a tabela ganhou outra forma — devolve zero frases, encontra
 * zero divergências e **passa**. Está abaixo do número real de propósito: é
 * um piso, não um espelho.
 */
const MINIMO_DE_FRASES = 20;

/** O texto da secção 9, cru. Falha a dizer que não conseguiu ler. */
function seccaoNove(): string {
  const caminho = join(RAIZ_REPOSITORIO, ESPECIFICACAO);
  const texto = lerTexto(caminho, `a especificação do ecrã (${ESPECIFICACAO})`);

  const seccao = /\n## 9\. Texto visível, todo ele\n([\s\S]*?)(?:\n## |$)/.exec(texto);
  if (seccao?.[1] === undefined) {
    throw new Error(
      `Não consegui ler ${ESPECIFICACAO}: não encontrei a secção «## 9. Texto ` +
        "visível, todo ele». Isto é uma falha de leitura, não um texto que não " +
        "corresponde — nada do que este ficheiro dissesse a seguir valeria nada.",
    );
  }

  return seccao[1];
}

/**
 * Todas as frases que as tabelas da secção 9 declaram.
 *
 * As células partem-se em ` / ` porque o estado de erro escreve as três
 * linhas numa só (`**Título.** / Linha. / \`Botão\``), e o destaque e as
 * plicas invertidas caem: são marcação do documento, não texto do ecrã.
 */
function frasesDaEspecificacao(): Set<string> {
  const frases = new Set<string>();

  for (const linha of seccaoNove().split("\n")) {
    if (!linha.trimStart().startsWith("|")) continue;

    for (const celula of linha.split("|").slice(2, -1)) {
      const limpa = celula.replaceAll("**", "").replaceAll("`", "");
      for (const pedaco of limpa.split(" / ")) {
        const frase = pedaco.trim();
        if (frase !== "" && frase !== "---" && frase !== "—") frases.add(frase);
      }
    }
  }

  return frases;
}

/**
 * As frases que a tabela escreve com buracos, com o valor posto de volta.
 *
 * É o que 12.5 manda fazer e o que a F3-02 já faz com o
 * `contagemDeResultados(7).replace("7", "{n}")`: uma frase construída por
 * concatenação passa ao lado de qualquer varredura, e a única maneira de a
 * comparar com a tabela é desfazer a construção.
 */
const COM_BURACOS: Record<string, string> = {
  "A partir das {hh:mm}": aPartirDas("22:00").replace(/\d\d:\d\d/, "{hh:mm}"),
  "Começou às {hh:mm}": comecouAs("22:00").replace(/\d\d:\d\d/, "{hh:mm}"),
  "{Dia da semana}, a partir das {hh:mm}": diaEHora("quinta-feira", "22:00")
    .replace("Quinta-feira", "{Dia da semana}")
    .replace(/\d\d:\d\d/, "{hh:mm}"),
  "{dia} de {mês}": dataPorExtenso(17, "dezembro")
    .replace("17", "{dia}")
    .replace("dezembro", "{mês}"),
  "{dia} de {mês} de {ano}": dataPorExtenso(1, "janeiro", 2027)
    .replace("1", "{dia}")
    .replace("janeiro", "{mês}")
    .replace("2027", "{ano}"),
};

describe(`o texto do ecrã é o da tabela de ${ESPECIFICACAO}`, () => {
  const frases = frasesDaEspecificacao();

  it("a tabela foi mesmo lida", () => {
    expect(
      frases.size,
      `li ${String(frases.size)} frases na secção 9 de ${ESPECIFICACAO} e esperava ` +
        `pelo menos ${String(MINIMO_DE_FRASES)}. A tabela mudou de forma e a ` +
        "expressão regular deixou de a apanhar: isto é «não consegui procurar», " +
        "não é «está tudo a condizer».",
    ).toBeGreaterThanOrEqual(MINIMO_DE_FRASES);
  });

  it.each(Object.entries(TEXTOS_DOS_EVENTOS))(
    "«%s» está na tabela, palavra por palavra",
    (chave, valor) => {
      expect(
        frases.has(valor),
        `o texto «${chave}» do ecrã é «${valor}» e essa frase não está na secção 9 ` +
          `de ${ESPECIFICACAO}. Ou a frase mudou no código sem passar pela ` +
          "especificação — e então o dominio-bar não a viu —, ou mudou na " +
          "especificação e falta mudá-la em `src/testes/eventos.ts` e em " +
          "`src/pages/publico/Eventos.tsx`.",
      ).toBe(true);
    },
  );

  it.each(Object.entries(COM_BURACOS))(
    "a frase construída «%s» é a da tabela, com o valor posto de volta",
    (daTabela, construida) => {
      expect(
        construida,
        "a frase que o ecrã constrói não condiz com a da tabela depois de lhe pôr o " +
          "buraco de volta. É aqui que uma concatenação muda de forma sem ninguém " +
          "dar por isso — «às 22:00» em vez de «a partir das 22:00», «22h» em vez " +
          "de «22:00», um ponto final numa etiqueta que não o leva (9, nota 5).",
      ).toBe(daTabela);
      expect(frases.has(daTabela), `«${daTabela}» não está na secção 9`).toBe(true);
    },
  );

  it.each(DIAS_ESPERADOS)("o dia «%s» está na tabela dos sete", (dia) => {
    // Os sete nomes, em minúsculas, como estão na tabela do código (9).
    expect(
      frases.has(dia),
      `«${dia}» não está na tabela dos dias da secção 9 de ${ESPECIFICACAO}. ` +
        "Dezanove palavras portuguesas visíveis não estão em mais lado nenhum — " +
        "um ICU reduzido escreve a inglesa e nada no CI o apanha (5.4).",
    ).toBe(true);
  });

  it("os doze meses estão lá, em minúsculas", () => {
    // Em prosa e não em tabela, por isso procuram-se no texto da secção.
    const texto = seccaoNove();
    const emFalta = MESES_ESPERADOS.filter((mes) => !texto.includes(mes));

    expect(emFalta, `meses que faltam à secção 9 de ${ESPECIFICACAO}`).toEqual([]);
  });

  it("nenhuma frase do ecrã leva seta, emoji ou etiqueta em maiúsculas (9)", () => {
    // O Q-05 varre o código; isto varre o que a **especificação** declara.
    // Uma frase com uma seta escrita na tabela passava no Q-05 no dia em
    // que alguém a copiasse para o componente — ela estaria na tabela.
    for (const frase of Object.values(TEXTOS_DOS_EVENTOS)) {
      expect(frase, `«${frase}» tem uma seta ou reticências de três pontos`).not.toMatch(
        /→|\.\.\./,
      );
      expect(frase, `«${frase}» tem uma etiqueta em maiúsculas`).not.toMatch(
        /\b[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ]{3,}\b/,
      );
    }
  });
});
