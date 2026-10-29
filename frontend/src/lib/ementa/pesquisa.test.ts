/**
 * F3-02, 12.2 — a pesquisa.
 *
 * Não há endpoint de pesquisa: a ementa inteira já veio num pedido e
 * filtra-se no cliente (4.1). Estas são as funções puras que o fazem.
 *
 * **O que este ficheiro prova:** "galao" encontra "Galão"; "Café" encontra
 * um produto escrito sem acento; "caca" encontra "caça"; um termo só com
 * espaços não filtra nada; o nome da categoria traz o cartão inteiro; a
 * descrição **não** condiz; a ordem das categorias e dos produtos mantém-se;
 * que o `&`, o apóstrofo e os algarismos de um nome de marca condizem como
 * qualquer outra letra — e que "12" condiz com o nome e nunca com o preço;
 * e o texto normalizado nunca chega ao resultado.
 *
 * **O que deixa passar:** que a normalização seja aplicada só ao termo —
 * daí o guarda das fixturas, aqui em baixo, com uma mensagem que não se
 * pode confundir com "a pesquisa não encontrou". E deixa passar a ligação
 * ao campo: a função pode estar perfeita e o componente filtrar por um
 * valor atrasado uma tecla. Isso é `Ementa.test.tsx` e o e2e.
 */
import { describe, expect, it } from "vitest";

import {
  EMENTA_DE_TESTE,
  contarProdutos,
  nomesPesquisaveis,
  type CategoriaDaEmenta,
} from "../../testes/ementa";
import { filtrarEmenta, indexarEmenta, normalizar } from "./pesquisa";

/** O índice da fixtura, construído uma vez — é assim que a página o faz. */
function indice() {
  return indexarEmenta(EMENTA_DE_TESTE.categorias);
}

function procurar(termo: string): CategoriaDaEmenta[] {
  return filtrarEmenta(indice(), termo);
}

/** Todos os nomes de produto do resultado, por ordem de aparecimento. */
function nomesEncontrados(termo: string): string[] {
  return procurar(termo).flatMap((categoria) => categoria.produtos.map((produto) => produto.nome));
}

describe("guarda das fixturas: os acentos têm de lá estar", () => {
  /**
   * Isto não testa a pesquisa. Testa **os dados do teste**.
   *
   * A normalização aplicada só ao termo é o erro clássico — "cafe" acha
   * "cafe" e falha "café" —, e uma bateria com fixturas sem acentos passa
   * com meia implementação. Uma limpeza bem intencionada das fixturas,
   * daqui a seis meses, tirava o único caso que interessa e nenhum teste
   * ficava vermelho. Este fica, e a mensagem diz porquê.
   */
  it.each([["ã"], ["õ"], ["ç"], ["á"], ["é"], ["à"]])(
    "o «%s» aparece em algum nome pesquisável da fixtura",
    (acento) => {
      const nomes = nomesPesquisaveis();

      expect(
        nomes.join(" | ").includes(acento),
        `as fixturas perderam os acentos: nenhum nome de categoria ou de produto tem «${acento}». ` +
          "Isto não quer dizer que a pesquisa falhou — quer dizer que os testes de " +
          "normalização abaixo passaram a não provar nada.",
      ).toBe(true);
    },
  );

  it("há um produto escrito sem o acento que devia ter", () => {
    const nomes = nomesPesquisaveis();

    expect(
      nomes,
      "as fixturas perderam o caso do dono que escreve sem acentos: sem ele, " +
        "a normalização do lado do **produto** deixa de ser exercitada",
    ).toContain("Cafe pingado");
  });
});

describe("normalizar", () => {
  it("tira os acentos e baixa as maiúsculas", () => {
    expect(normalizar("Galão")).toBe("galao");
    expect(normalizar("CAFÉ")).toBe("cafe");
    expect(normalizar("Moelas à caçadora")).toBe("moelas a cacadora");
    expect(normalizar("Rissóis de camarão")).toBe("rissois de camarao");
    expect(normalizar("Mexilhões")).toBe("mexilhoes");
  });

  it("é idempotente: normalizar o já normalizado não muda nada", () => {
    for (const nome of nomesPesquisaveis()) {
      expect(normalizar(normalizar(nome))).toBe(normalizar(nome));
    }
  });
});

describe("os acentos ignoram-se nos dois sentidos", () => {
  it("«galao» encontra «Galão»", () => {
    expect(nomesEncontrados("galao")).toEqual(["Galão"]);
  });

  it("«Galão» encontra «Galão» — escrever com acento não pode custar resultados", () => {
    expect(nomesEncontrados("Galão")).toEqual(["Galão"]);
  });

  it("«Café» encontra um produto escrito sem acento", () => {
    // Este é o sentido que uma implementação que normalize só o termo
    // falha. "Cafe pingado" vive numa categoria cujo nome não condiz com
    // "café", por isso só pode ter vindo pelo nome do produto.
    expect(nomesEncontrados("Café")).toContain("Cafe pingado");
  });

  it("«caca» encontra «caçadora»", () => {
    expect(nomesEncontrados("caca")).toEqual(["Moelas à caçadora"]);
  });

  it("«CAMARAO» encontra «camarão», com maiúsculas e sem til", () => {
    expect(nomesEncontrados("CAMARAO")).toEqual(["Rissóis de camarão"]);
  });
});

describe("o que condiz e o que não condiz", () => {
  it("o nome do produto condiz por subcadeia, em qualquer sítio do nome", () => {
    expect(nomesEncontrados("perial")).toEqual(["Imperial"]);
  });

  it("o nome da categoria traz o cartão inteiro", () => {
    const encontradas = procurar("cervejas");

    expect(encontradas).toHaveLength(1);
    expect(encontradas[0]?.nome).toBe("Cervejas");
    expect(
      encontradas[0]?.produtos.map((produto) => produto.nome),
      "quem escreve «cervejas» quer as cervejas todas, não os produtos com «cervejas» no nome",
    ).toEqual(["Imperial", "Caneca", "Cerveja sem álcool"]);
  });

  it("a descrição não condiz", () => {
    // "boa com" só existe numa descrição e em nenhum nome. Uma tónica a
    // aparecer numa pesquisa por causa da descrição é um resultado que a
    // pessoa não consegue explicar a olhar para o ecrã (4.3).
    expect(nomesEncontrados("boa com")).toEqual([]);
  });

  it("a descrição não condiz, nem quando a palavra está noutro produto", () => {
    // "gin" está no nome de dois produtos e no nome de uma categoria, e
    // está também na descrição da Tónica. A Tónica não pode vir.
    expect(nomesEncontrados("gin")).not.toContain("Tónica");
  });

  it("uma palavra que é nome de categoria **e** nome de um produto noutra traz as duas", () => {
    // A colisão entre categorias, que numa carta de bar acontece de certeza:
    // "tónica" é metade do nome da categoria dos gins e é, por si só, o nome
    // de um refrigerante. O cartão dos gins vem **inteiro** (condiz pelo nome
    // da categoria) e dos refrigerantes vem **uma linha só** (4.3).
    const encontradas = procurar("tonica");

    expect(encontradas.map((categoria) => categoria.nome)).toEqual([
      "Gins & Tónicas",
      "Refrigerantes",
    ]);
    expect(encontradas[0]?.produtos).toHaveLength(2);
    expect(encontradas[1]?.produtos.map((produto) => produto.nome)).toEqual(["Tónica"]);
  });
});

/**
 * Os três caracteres que nenhum nome desta fixtura tinha até à revisão do
 * dominio-bar, e que a importação dos produtos vai trazer de certeza: cinco
 * categorias de uma carta de bar são garrafas, e os nomes delas vêm com a
 * marca — `J&B`, `Ballantine's`, `Chivas 12 anos`.
 */
describe("«&», apóstrofo e algarismos são texto, não sintaxe", () => {
  it("o «&» condiz, no nome de um produto e no de uma categoria", () => {
    expect(nomesEncontrados("&")).toEqual(["Gin Gordon's", "Gin de morango", "J&B"]);
  });

  it("o apóstrofo condiz, e não parte o nome em dois", () => {
    expect(nomesEncontrados("gordon's")).toEqual(["Gin Gordon's"]);
    expect(nomesEncontrados("ballantine's")).toEqual(["Ballantine's"]);
  });

  it("os algarismos condizem com o **nome**, e nunca com o preço", () => {
    // 4.3 em voz alta: o que se pesquisa é o que se vê em letra grande. Há
    // dois produtos a "1,20 €" nesta fixtura — o chá de limão e a água com
    // gás —, e nenhum deles pode vir numa pesquisa por "12".
    expect(nomesEncontrados("12")).toEqual(["Chivas 12 anos"]);
  });
});

describe("um termo que não é uma pesquisa deixa a ementa inteira", () => {
  it.each([
    ["", "vazio"],
    ["   ", "só com espaços"],
    ["\t \n ", "só com espaço branco"],
  ])("«%s» (%s) devolve tudo", (termo) => {
    const todas = procurar(termo);

    expect(todas).toHaveLength(
      EMENTA_DE_TESTE.categorias.filter((categoria) => categoria.produtos.length > 0).length,
    );
    expect(contarProdutos(todas)).toBe(contarProdutos(EMENTA_DE_TESTE.categorias));
  });

  it("o termo é aparado nas pontas", () => {
    expect(nomesEncontrados("   Galão   ")).toEqual(["Galão"]);
  });

  it("os espaços interiores reduzem-se a um", () => {
    expect(nomesEncontrados("Sandes   de    pernil")).toEqual([
      "Sandes de pernil com queijo da serra",
    ]);
  });
});

describe("a ordem não se mexe", () => {
  it("as categorias saem pela ordem original", () => {
    const encontradas = procurar("garrafa");

    expect(encontradas.map((categoria) => categoria.nome)).toEqual(["Vinhos", "Garrafeira"]);
  });

  it("os produtos saem pela ordem original, dentro de cada cartão", () => {
    const encontradas = procurar("garrafa");

    expect(encontradas[0]?.produtos.map((produto) => produto.nome)).toEqual([
      "Vinho verde, garrafa",
      "Vinho tinto, garrafa",
      "Garrafa de reserva",
    ]);
  });

  it("uma categoria sem nenhuma linha a condizer desaparece", () => {
    const encontradas = procurar("garrafa");

    expect(encontradas.map((categoria) => categoria.nome)).not.toContain("Cafés");
  });

  it("sem resultado nenhum, a lista vem vazia — não vem a ementa inteira", () => {
    expect(procurar("xkcd")).toEqual([]);
  });
});

describe("o resultado normalizado nunca chega ao ecrã", () => {
  it("os nomes saem como o dono os escreveu", () => {
    const encontradas = procurar("galao");

    expect(encontradas[0]?.nome, "o nome da categoria sai com acento").toBe("Cafés");
    expect(encontradas[0]?.produtos[0]?.nome, "o nome do produto sai com acento").toBe("Galão");
  });

  it("nenhum nome do resultado vem em minúsculas sem acentos", () => {
    const todos = procurar("").flatMap((categoria) => [
      categoria.nome,
      ...categoria.produtos.map((produto) => produto.nome),
    ]);

    expect(todos).toContain("Água da casa");
    expect(todos).not.toContain("agua da casa");
  });
});

describe("indexarEmenta ignora categorias sem produtos", () => {
  /**
   * **Prova:** a invariante "um chip por cartão" na única função onde ela
   * pode ser garantida de uma vez. O backend nunca devolve uma categoria
   * sem produtos, mas o frontend não confia nisso (5.2).
   *
   * **Deixa passar:** que a página use o índice. Se alguém renderizar os
   * chips a partir de `ementa.categorias` em vez do índice, isto continua
   * verde — e é por isso que `Ementa.test.tsx` conta chips e cartões.
   */
  it("a categoria com zero produtos não entra no índice", () => {
    const indexadas = indexarEmenta(EMENTA_DE_TESTE.categorias);

    expect(indexadas).toHaveLength(EMENTA_DE_TESTE.categorias.length - 1);
    expect(procurar("").map((categoria) => categoria.nome)).not.toContain("Categoria sem produtos");
  });

  it("uma ementa só com categorias vazias indexa-se como lista vazia", () => {
    expect(
      indexarEmenta([
        { id: 90, nome: "Nada hoje", slug: "nada-hoje", produtos: [] },
        { id: 91, nome: "Também nada", slug: "tambem-nada", produtos: [] },
      ]),
    ).toEqual([]);
  });
});
