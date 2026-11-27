import { expect, test } from "@playwright/test";

import { lerCor } from "../src/testes/contraste";
import { blocosDosTokens, resolver } from "../src/testes/tokens";
import {
  TEXTOS_DA_EMENTA,
  abrirAEmenta,
  campoDePesquisa,
  cartoes,
  fingirEmentaFixa,
  lupa,
} from "./apoio/ementa";

/**
 * F3-02, 12.6 e 12.9 — o que só se vê medindo píxeis.
 *
 * Dois testes que nenhum ambiente sem motor de pintura consegue fazer: a
 * **coluna** dos preços (que é o que a tabularidade existe para produzir) e
 * o varrimento à procura de dourado dentro do creme.
 */

/** Os dois preços da fixtura, escolhidos por terem algarismos diferentes. */
const PRECO_ESTREITO = "11,11\u00a0€";
const PRECO_LARGO = "20,00\u00a0€";

test.describe("12.6: a coluna dos preços alinha", () => {
  /**
   * **Prova:** com duas linhas a "11,11 €" e "20,00 €" — mesmos dígitos,
   * algarismos diferentes — as duas caixas do preço têm a mesma largura.
   *
   * **Deixa passar, se fosse a única asserção:** uma fonte que já seja
   * tabular por omissão (passa sem a classe) e o caso de as fontes não
   * terem carregado, em que se está a medir a fonte do sistema. Daí
   * **três** asserções com mensagens diferentes — esperar por
   * `document.fonts.ready`, confirmar a família usada, confirmar o
   * `font-variant-numeric` computado. Três causas, três mensagens: se a
   * coluna desalinhar, o teste diz **qual** das três.
   */
  test("duas larguras iguais, e as três causas separadas", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const fontesProntas = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.status;
    });
    expect(
      fontesProntas,
      "as fontes não acabaram de carregar: tudo o que se medisse a seguir seria " +
        "a fonte do sistema, não a Bricolage Grotesque",
    ).toBe("loaded");

    const estreito = page.getByText(PRECO_ESTREITO, { exact: true });
    const largo = page.getByText(PRECO_LARGO, { exact: true });

    await expect(
      estreito,
      `não encontrei «${PRECO_ESTREITO}» na página — a fixtura perdeu o par de ` +
        "preços com que se mede a coluna. Isto não é um desalinhamento.",
    ).toBeVisible();
    await expect(largo).toBeVisible();

    // R-01 / ADR 0023: o preço passou para a Bricolage Grotesque (`font-preco`),
    // porque o DM Sans não tem algarismos tabulares (`tnum`) e o `tabular-nums`
    // não fazia nada nele. O nome do produto continua no DM Sans.
    const familia = await estreito.evaluate((elemento) => getComputedStyle(elemento).fontFamily);
    expect(
      familia,
      `o preço está a ser desenhado em «${familia}». A coluna só alinha com a ` +
        "Bricolage Grotesque; com a fonte do sistema esta medida não quer dizer nada.",
    ).toContain("Bricolage Grotesque");

    // E a Bricolage fica só no preço: o nome do produto é texto, no DM Sans.
    const nomeDoProduto = page
      .locator("section[id='ementa-sandes']")
      .getByText("Sandes de pernil com queijo da serra", { exact: true });
    await expect(nomeDoProduto, "guarda: não encontrei o nome do produto da fixtura").toBeVisible();
    const familiaDoNome = await nomeDoProduto.evaluate(
      (elemento) => getComputedStyle(elemento).fontFamily,
    );
    expect(
      familiaDoNome,
      `o nome do produto está em «${familiaDoNome}»: é texto corrido, e tem de ser o DM Sans`,
    ).toContain("DM Sans");

    const variante = await estreito.evaluate(
      (elemento) => getComputedStyle(elemento).fontVariantNumeric,
    );
    expect(
      variante,
      "falta `tabular-nums` no elemento do preço — é a declaração que alinha a coluna",
    ).toContain("tabular-nums");

    const caixaEstreita = await estreito.boundingBox();
    const caixaLarga = await largo.boundingBox();

    expect(caixaEstreita, "não consegui medir o preço estreito").not.toBeNull();
    expect(caixaLarga, "não consegui medir o preço largo").not.toBeNull();

    const diferenca = Math.abs((caixaEstreita?.width ?? 0) - (caixaLarga?.width ?? 0));
    expect(
      diferenca,
      `«${PRECO_ESTREITO}» e «${PRECO_LARGO}» têm larguras diferentes por ` +
        `${diferenca.toFixed(2)} px. A declaração «tabular-nums» está lá e não tem ` +
        "efeito — é o que acontece quando o subconjunto da fonte perdeu a função " +
        "«tnum», e só se nota quando um 1 e um 0 ficam na mesma coluna (6.1).",
    ).toBeLessThanOrEqual(0.5);
  });

  test("o preço alinha pela primeira linha de um nome que vai a duas", async ({ page }) => {
    // 6.3: `align-items: baseline`. Numa carta impressa o preço fica em
    // cima, à direita, e o fio encolhe até aos seus 24 px.
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    // Dentro do cartão, e não na página: há outro produto a 6,50 € noutra
    // categoria, e um localizador ambíguo falhava por "strict mode
    // violation" — uma mensagem que não diz nada sobre alinhamento.
    const cartao = page.locator("section[id='ementa-sandes']");
    const nome = cartao.getByText("Sandes de pernil com queijo da serra", { exact: true });
    const preco = cartao.getByText("6,50 €", { exact: true });

    await expect(nome).toBeVisible();
    const caixaDoNome = await nome.boundingBox();
    const caixaDoPreco = await preco.boundingBox();

    expect(caixaDoNome, "não consegui medir o nome longo").not.toBeNull();
    expect(caixaDoPreco, "não consegui medir o preço").not.toBeNull();

    const alturaDoNome = caixaDoNome?.height ?? 0;
    const alturaDoPreco = caixaDoPreco?.height ?? 0;

    expect(
      alturaDoNome,
      "guarda: a 390 px este nome devia ir a duas linhas. Se vai a uma, a fixtura " +
        "ou a largura da coluna mudaram, e este teste deixou de provar o que diz.",
    ).toBeGreaterThan(alturaDoPreco * 1.5);

    expect(
      Math.abs((caixaDoPreco?.y ?? 0) - (caixaDoNome?.y ?? 0)),
      "o preço tem de ficar na primeira linha do nome, não a meio nem no fim (6.3)",
    ).toBeLessThanOrEqual(4);
  });

  test("o fio nunca desaparece, mesmo com o nome mais longo", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const linha = page
      .locator("li")
      .filter({ hasText: "Sandes de pernil com queijo da serra" })
      .first();
    const fio = linha.locator('[aria-hidden="true"]').first();

    const caixa = await fio.boundingBox();
    expect(caixa, "não encontrei o fio na linha do nome longo").not.toBeNull();
    expect(
      caixa?.width ?? 0,
      "o fio fica com o que sobrar e nunca desce abaixo dos 24 px (6.3)",
    ).toBeGreaterThanOrEqual(23);
  });
});

test.describe("12.9: o dourado nunca dentro do creme", () => {
  /**
   * **Prova:** varrimento de píxeis dentro de cada `.superficie-creme` desta
   * página — nenhum píxel a menos de 24 por canal de `#d4af37`. É a
   * extensão a esta página do que já existe para a demonstração.
   *
   * O varrimento faz-se levando a captura de volta para dentro do browser e
   * lendo-a num `<canvas>`: sem dependência nenhuma, e olha para o que foi
   * **pintado** em vez de olhar para as classes. Um `border-dourado-latao`
   * escrito à mão é apanhado pelo `cores-so-nos-tokens.test.ts` antes disto;
   * o que isto apanha é o dourado que lá chegou por outro caminho.
   *
   * **Deixa passar:** dourado que só aparece depois de uma interação (nesta
   * página não há) e dourado na barra, que é onde ele deve estar.
   */
  test("nenhum píxel dourado dentro de um cartão", async ({ page }) => {
    test.setTimeout(90_000);

    const hex = resolver(blocosDosTokens(), ":root", "--cor-dourado-latao");
    const dourado = hex === null ? null : lerCor(hex);
    expect(
      dourado,
      "não consegui ler --cor-dourado-latao do tokens.css — falha de leitura, " +
        "não um dourado encontrado",
    ).not.toBeNull();

    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await expect(cartoes(page)).not.toHaveCount(0);

    const quantos = await page.locator(".superficie-creme").count();
    expect(
      quantos,
      "guarda: não há superfícies creme nesta página — não varri nada",
    ).toBeGreaterThan(3);

    let pixeisVarridos = 0;
    const achados: string[] = [];

    for (let indice = 0; indice < quantos; indice += 1) {
      const cartao = page.locator(".superficie-creme").nth(indice);
      await cartao.scrollIntoViewIfNeeded();
      const imagem = await cartao.screenshot();

      const resultado = await page.evaluate(
        async ({ base64, alvo }) => {
          const binario = atob(base64);
          const bytes = new Uint8Array(binario.length);
          for (let posicao = 0; posicao < binario.length; posicao += 1) {
            bytes[posicao] = binario.charCodeAt(posicao);
          }
          const mapa = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const tela = document.createElement("canvas");
          tela.width = mapa.width;
          tela.height = mapa.height;
          const pincel = tela.getContext("2d");
          if (pincel === null) return { total: 0, dourados: 0 };
          pincel.drawImage(mapa, 0, 0);
          const dados = pincel.getImageData(0, 0, tela.width, tela.height).data;

          let dourados = 0;
          for (let posicao = 0; posicao < dados.length; posicao += 4) {
            if (
              Math.abs((dados[posicao] ?? 0) - alvo.vermelho) < 24 &&
              Math.abs((dados[posicao + 1] ?? 0) - alvo.verde) < 24 &&
              Math.abs((dados[posicao + 2] ?? 0) - alvo.azul) < 24
            ) {
              dourados += 1;
            }
          }
          return { total: dados.length / 4, dourados };
        },
        {
          base64: imagem.toString("base64"),
          alvo: dourado ?? { vermelho: -99, verde: -99, azul: -99 },
        },
      );

      pixeisVarridos += resultado.total;
      if (resultado.dourados > 0) {
        achados.push(
          `cartão ${String(indice + 1)}: ${String(resultado.dourados)} píxeis a menos de ` +
            "24 por canal do dourado",
        );
      }
    }

    expect(
      pixeisVarridos,
      "guarda: as capturas dos cartões vieram vazias — não varri píxel nenhum",
    ).toBeGreaterThan(100_000);
    expect(
      achados,
      "dourado dentro de uma superfície creme é bloqueante (F3-02, secção 7): " +
        "contra o creme dá 1,72, e um preço ou um pontilhado a 1,72 desaparece",
    ).toEqual([]);
  });

  test("nenhum elemento dentro do creme escreve o dourado nas suas cores", async ({ page }) => {
    // A mesma pergunta pelo outro lado, e com outra mensagem: esta diz
    // **qual** é o elemento, o varrimento de píxeis diz que há um.
    const hex = resolver(blocosDosTokens(), ":root", "--cor-dourado-latao");
    const dourado = hex === null ? null : lerCor(hex);
    expect(dourado, "não consegui ler --cor-dourado-latao").not.toBeNull();

    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const achados = await page.evaluate(
      ({ vermelho, verde, azul }) => {
        const igual = (cor: string): boolean => {
          const numeros = cor.match(/\d+(?:\.\d+)?/g);
          if (numeros === null || numeros.length < 3) return false;
          return (
            Math.round(Number(numeros[0])) === vermelho &&
            Math.round(Number(numeros[1])) === verde &&
            Math.round(Number(numeros[2])) === azul
          );
        };

        const dentro = [...document.querySelectorAll(".superficie-creme *")];
        return {
          total: dentro.length,
          comDourado: dentro
            .filter((elemento) => {
              const estilo = getComputedStyle(elemento);
              return [
                estilo.color,
                estilo.backgroundColor,
                estilo.borderTopColor,
                estilo.borderBottomColor,
                estilo.borderLeftColor,
                estilo.borderRightColor,
                estilo.outlineColor,
              ].some(igual);
            })
            .map(
              (elemento) =>
                `${elemento.tagName.toLowerCase()} «${(elemento.textContent ?? "").trim().slice(0, 32)}»`,
            )
            .slice(0, 20),
        };
      },
      dourado ?? { vermelho: -99, verde: -99, azul: -99 },
    );

    expect(
      achados.total,
      "guarda: os cartões creme desta página estão vazios, não verifiquei nada",
    ).toBeGreaterThan(20);
    expect(achados.comDourado).toEqual([]);
  });

  test("a aresta do cartão é creme-sombra, não bordô-tomazia", async ({ page }) => {
    // Secção 7: `border-contorno-superficie` e não `border-contorno` —
    // esse é bordô-tomazia e desenharia uma moldura pesada à volta de cada
    // categoria.
    const tokens = blocosDosTokens();
    const sombra = resolver(tokens, ".superficie-creme", "--cor-contorno-superficie");
    const esperada = sombra === null ? null : lerCor(sombra);

    expect(esperada, "não consegui resolver --cor-contorno-superficie no creme").not.toBeNull();

    await fingirEmentaFixa(page);
    await abrirAEmenta(page);

    const medida = await cartoes(page)
      .first()
      .evaluate((elemento) => {
        const estilo = getComputedStyle(elemento);
        return { cor: estilo.borderTopColor, largura: estilo.borderTopWidth };
      });

    const lida = lerCor(medida.cor);
    expect(lida, `não consegui ler a cor da aresta («${medida.cor}»)`).not.toBeNull();
    expect(lida?.vermelho).toBe(esperada?.vermelho);
    expect(lida?.verde).toBe(esperada?.verde);
    expect(lida?.azul).toBe(esperada?.azul);
  });
});

test.describe("4.1: um «×» na barra, e não dois", () => {
  /**
   * **Prova:** que o «×» nativo da caixa de pesquisa não é pintado.
   *
   * Mede-se contando píxeis e não lendo o DOM, porque o nativo é um
   * pseudo-elemento: não aparece como elemento, e
   * `getComputedStyle(campo, "::-webkit-search-cancel-button")` não devolve
   * o estilo dele — medido, devolve o do próprio campo (274 px de largura,
   * que é a do campo). Uma asserção sobre esse valor passava sempre, com e
   * sem a regra.
   *
   * O que se conta é **branco puro**: o nativo pinta a branco e todos os
   * controlos desta barra são creme. Com a regra, zero píxeis com os três
   * canais acima de 245 dentro do campo; sem ela, medidos 474.
   *
   * E o controlo positivo é a metade que faz isto valer alguma coisa: no
   * fim, a regra é desfeita por cima e o mesmo varrimento tem de **passar a
   * encontrar** o botão. Sem ele, um varrimento partido — uma captura
   * vazia, um limiar impossível — dizia "está limpo" com a mesma cara.
   */
  test("nenhum píxel branco na caixa de pesquisa, e a medição sabe vê-lo", async ({ page }) => {
    await fingirEmentaFixa(page);
    await abrirAEmenta(page);
    await lupa(page).click();

    const campo = campoDePesquisa(page);
    await campo.fill("gin");
    await expect(
      page.getByRole("button", { name: TEXTOS_DA_EMENTA.fecharPesquisa }),
      "o nosso «×» é um só, e é ele que fica: `×` é o glifo de fechar deste projeto",
    ).toHaveCount(1);

    const comARegra = await contarBrancos(page, await campo.screenshot());

    expect(
      comARegra.total,
      "guarda: a captura do campo veio vazia — não varri píxel nenhum",
    ).toBeGreaterThan(10_000);
    expect(
      comARegra.brancos,
      "com texto escrito, a barra mostrava dois «×» a 52 px um do outro a fazer " +
        "coisas diferentes: o de dentro limpa e fica, o de fora limpa e fecha. O " +
        "nativo pinta a branco puro, mais forte do que todos os nossos controlos " +
        "em creme (4.1).",
    ).toBe(0);

    // Controlo positivo: desfazer a regra e ver se o varrimento o apanha.
    await page.addStyleTag({
      content:
        'input[type="search"]::-webkit-search-cancel-button { appearance: auto; display: inline-block; }',
    });
    const semARegra = await contarBrancos(page, await campo.screenshot());

    expect(
      semARegra.brancos,
      "não vi o «×» nativo nem depois de o voltar a ligar. Isto é uma falha de " +
        "medição — o varrimento não sabe ver o que devia ver —, e não a prova de " +
        "que ele não lá está.",
    ).toBeGreaterThan(50);
  });
});

/** Quantos píxeis de uma captura são branco puro, e quantos foram vistos. */
async function contarBrancos(
  pagina: import("@playwright/test").Page,
  imagem: Buffer,
): Promise<{ total: number; brancos: number }> {
  return pagina.evaluate(async (base64: string) => {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let posicao = 0; posicao < binario.length; posicao += 1) {
      bytes[posicao] = binario.charCodeAt(posicao);
    }
    const mapa = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const tela = document.createElement("canvas");
    tela.width = mapa.width;
    tela.height = mapa.height;
    const pincel = tela.getContext("2d");
    if (pincel === null) return { total: 0, brancos: 0 };
    pincel.drawImage(mapa, 0, 0);
    const dados = pincel.getImageData(0, 0, tela.width, tela.height).data;

    let brancos = 0;
    for (let posicao = 0; posicao < dados.length; posicao += 4) {
      if (
        (dados[posicao] ?? 0) >= 245 &&
        (dados[posicao + 1] ?? 0) >= 245 &&
        (dados[posicao + 2] ?? 0) >= 245
      ) {
        brancos += 1;
      }
    }
    return { total: dados.length / 4, brancos };
  }, imagem.toString("base64"));
}
