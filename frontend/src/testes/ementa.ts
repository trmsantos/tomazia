/**
 * A ementa de teste e o texto visível do ecrã, num sítio só.
 *
 * Vive em `src/testes/` e não dentro de um `*.test.ts` porque os dois lados
 * precisam dela: os testes Vitest (que renderizam a página com um cliente
 * falso) e os testes Playwright (que fingem `GET /api/ementa` com
 * `page.route`). Duas cópias da mesma fixtura acabavam a divergir, e a que
 * divergisse passaria a provar outra coisa sem ninguém dar por isso.
 *
 * **A fixtura é tipada como `Ementa`**, o tipo gerado a partir do OpenAPI do
 * backend (`src/lib/api/gerado/esquema.ts`). É de propósito: no dia em que o
 * contrato mudar, isto parte a compilação em vez de continuar verde contra
 * uma forma que já não existe.
 *
 * ## O que esta fixtura tem de ter, e porquê
 *
 * | O quê | Porquê |
 * | --- | --- |
 * | doze cartões | a barra de chips tem mesmo de deslizar a 390 px (F3-02, 3.2) |
 * | uma categoria com zero produtos | o frontend ignora-a, e ao chip dela também (5.2) |
 * | `ã õ ç á é à` nos **nomes** | a normalização de acentos é dos dois lados (4.4) |
 * | um produto sem acento onde devia ter | "Café" tem de encontrar "Cafe pingado" |
 * | um `slug` feio | `ancoraDaCategoria` cai no `ementa-categoria-${id}` (secção 2) |
 * | um produto a 0 **num cartão de nome neutro** | mostra "Oferta", nunca "0,00 €" (6.2) — e com um preço a pagar ao lado |
 * | `1111` e `2000` lado a lado | mesmos dígitos, algarismos diferentes: a coluna (12.6) |
 * | `12000` | o preço mais largo que esta carta tem de verdade: é ele que fixa a coluna nas capturas |
 * | um nome que vai a duas linhas | o preço alinha pela primeira linha (6.3) |
 * | uma descrição com uma palavra que não está em nenhum nome | a descrição **não** condiz (4.3) |
 * | um nome com `&` e outro com apóstrofo | é assim que as marcas se escrevem, e é onde uma escapatória a menos se vê |
 * | um nome com algarismos | pesquisar "12" condiz com o nome e **não** com o preço (4.3) |
 *
 * O que **não** está aqui, de propósito: o ponto dos milhares (6.1). Um preço
 * de 1.250,00 € nesta fixtura desenhava-se nas capturas e definia a largura da
 * coluna de preços que a revisão olha — uma largura que este bar nunca vai
 * praticar. O milhar vive onde não desenha ecrã nenhum: `preco.test.ts` e
 * `LinhaDeProduto.test.tsx`.
 *
 * Os dados são falsos e é propositado que se note: a regra 1 do `CLAUDE.md`
 * proíbe ler a base de dados antiga, por isso nada aqui afirma seja o que
 * for sobre a ementa verdadeira do bar.
 */
import type { Ementa } from "../lib/api/publico";

/** Uma categoria da resposta pública, sem repetir o caminho do tipo gerado. */
export type CategoriaDaEmenta = Ementa["categorias"][number];

/** Uma linha de produto da resposta pública. */
export type ProdutoDaEmenta = CategoriaDaEmenta["produtos"][number];

/** O `<h1>` da página pública, até a F3-03 o levar para o cabeçalho. */
export const NOME_DO_BAR = "Bar da Tomazia";

/**
 * Todo o texto visível da secção 9 da especificação.
 *
 * Escrito aqui para que a mudança de uma frase seja uma linha e não uma
 * caça ao texto por sete ficheiros — e para que o dominio-bar possa validar
 * a tabela inteira numa leitura, como a especificação pede.
 */
export const TEXTOS_DA_EMENTA = {
  titulo: "Ementa",
  nomeDaBarra: "Categorias",
  abrirPesquisa: "Pesquisar na ementa",
  campoDePesquisa: "Pesquisar na ementa",
  exemploDePesquisa: "Nome do produto",
  fecharPesquisa: "Fechar a pesquisa",
  semResultadosTitulo: "Não encontrei nada com esse nome.",
  semResultadosLinha: "Tenta outra palavra ou limpa a pesquisa para veres a ementa toda.",
  limparPesquisa: "Limpar pesquisa",
  vaziaTitulo: "Ainda não há ementa para mostrar.",
  vaziaLinha: "Pergunta no balcão.",
  erroTitulo: "Não consegui carregar a ementa.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  oferta: "Oferta",
} as const;

/**
 * A contagem de resultados, que é uma frase **construída**.
 *
 * Por isso não cabe na varredura de texto do Q-05 (12.10: "frases
 * construídas por concatenação" passam-lhe ao lado) e tem de ter teste
 * próprio para o singular e para o plural.
 */
export function contagemDeResultados(quantos: number): string {
  return quantos === 1 ? "1 produto encontrado." : `${quantos} produtos encontrados.`;
}

/**
 * `id` da secção da ementa, da barra fixa, e os seletores dos cartões e dos
 * chips.
 *
 * É o contrato entre os testes e a implementação, da mesma família do
 * `e2e/apoio/pagina.ts` da F3-01. A barra precisa de um `id` próprio porque
 * 12.11 mede a altura **dela** — e chegar-lhe pelo pai do `<nav>` deixaria
 * de funcionar no estado em que o `<nav>` não existe, que é exactamente o
 * estado com a pesquisa aberta, um dos dois que o teste tem de medir.
 */
export const ID_DA_SECCAO = "ementa";
export const ID_DO_TITULO = "titulo-ementa";
export const ID_DA_BARRA = "barra-da-ementa";
export const PREFIXO_DAS_ANCORAS = "ementa-";

/** Os cartões: `#ementa-cafes`, `#ementa-categoria-5`… e nunca o `#ementa`. */
export const SELETOR_DOS_CARTOES = 'section[id^="ementa-"]';

/** Os chips: ligações dentro da barra, com `href` para uma âncora de cartão. */
export const SELETOR_DOS_CHIPS = 'nav[aria-label="Categorias"] a[href^="#ementa-"]';

export const EMENTA_DE_TESTE: Ementa = {
  categorias: [
    {
      id: 1,
      nome: "Cafés",
      slug: "cafes",
      produtos: [
        { id: 101, nome: "Café", preco_cent: 70, descricao: null },
        {
          id: 102,
          nome: "Galão",
          preco_cent: 140,
          descricao: "Com leite acabado de tirar.",
        },
        { id: 103, nome: "Descafeinado", preco_cent: 75, descricao: null },
      ],
    },
    {
      id: 2,
      nome: "Bebidas quentes",
      slug: "bebidas-quentes",
      produtos: [
        { id: 201, nome: "Chá de limão", preco_cent: 120, descricao: null },
        // Sem acento de propósito: o dono escreve a ementa a uma mão atrás
        // do balcão. Quem pesquisar "Café" tem de o encontrar à mesma, e
        // esta linha vive numa categoria cujo nome **não** condiz com
        // "café" — senão o cartão vinha inteiro e o caso perdia-se.
        { id: 202, nome: "Cafe pingado", preco_cent: 80, descricao: null },
        { id: 203, nome: "Leite com chocolate", preco_cent: 150, descricao: null },
      ],
    },
    {
      id: 3,
      nome: "Cervejas",
      slug: "cervejas",
      produtos: [
        { id: 301, nome: "Imperial", preco_cent: 110, descricao: null },
        { id: 302, nome: "Caneca", preco_cent: 200, descricao: null },
        { id: 303, nome: "Cerveja sem álcool", preco_cent: 150, descricao: null },
      ],
    },
    {
      id: 4,
      nome: "Vinhos",
      slug: "vinhos",
      produtos: [
        // 1111 e 2000 ficam lado a lado de propósito: mesmos dígitos,
        // algarismos diferentes. É com estes dois que 12.6 mede a coluna.
        { id: 401, nome: "Vinho verde, garrafa", preco_cent: 1111, descricao: null },
        { id: 402, nome: "Vinho tinto, garrafa", preco_cent: 2000, descricao: null },
        // Três algarismos antes da vírgula: é o preço mais largo que esta
        // carta pode ter de verdade, e é ele que fixa a largura da coluna
        // nas capturas que a revisão olha. O milhar de 6.1 não desapareceu
        // — vive onde não desenha ecrã nenhum, em `preco.test.ts` e em
        // `LinhaDeProduto.test.tsx`.
        {
          id: 403,
          nome: "Garrafa de reserva",
          preco_cent: 12000,
          descricao: "Por encomenda.",
        },
      ],
    },
    {
      // `slug` feio: espaços, maiúsculas, um `&` e um acento. Não é um
      // seletor CSS válido, e é por isto que a âncora não pode sair dele.
      id: 5,
      nome: "Gins & Tónicas",
      slug: "Gins & Tónicas",
      produtos: [
        // Um gin nomeia-se pela marca, que é como o dono o escreve na
        // ardósia — e traz o apóstrofo, que é o caractere que uma marca
        // estrangeira mete num nome de produto. A colisão de palavras entre
        // categorias que esta categoria tinha de carregar não vive aqui:
        // vive no "Tónica" dos Refrigerantes, que condiz com o nome desta
        // categoria sem lhe pertencer (teste em `pesquisa.test.ts`).
        { id: 501, nome: "Gin Gordon's", preco_cent: 600, descricao: null },
        { id: 502, nome: "Gin de morango", preco_cent: 650, descricao: null },
      ],
    },
    {
      id: 6,
      nome: "Refrigerantes",
      slug: "refrigerantes",
      produtos: [
        // "boa com" só existe aqui, e só na descrição. É a prova de que a
        // descrição não condiz (4.3).
        { id: 601, nome: "Tónica", preco_cent: 200, descricao: "Boa com gin, se quiseres." },
        { id: 602, nome: "Sumo de laranja", preco_cent: 250, descricao: null },
      ],
    },
    {
      id: 7,
      nome: "Petiscos",
      slug: "petiscos",
      produtos: [
        { id: 701, nome: "Moelas à caçadora", preco_cent: 450, descricao: null },
        { id: 702, nome: "Tremoços", preco_cent: 300, descricao: null },
        { id: 703, nome: "Rissóis de camarão", preco_cent: 400, descricao: null },
        // O «õ» do guarda das fixturas vivia no «camarões» e o rissol passou
        // ao singular. Fica aqui, num nome que uma carta portuguesa tem.
        { id: 704, nome: "Mexilhões", preco_cent: 500, descricao: null },
      ],
    },
    {
      id: 8,
      nome: "Sandes",
      slug: "sandes",
      produtos: [
        // O nome longo de 6.3: a 390 px vai a duas linhas e o preço tem de
        // ficar alinhado pela primeira.
        {
          id: 801,
          nome: "Sandes de pernil com queijo da serra",
          preco_cent: 650,
          descricao: "O pão é de cá.",
        },
        { id: 802, nome: "Tosta mista", preco_cent: 350, descricao: null },
      ],
    },
    {
      id: 9,
      nome: "Doces",
      slug: "doces",
      produtos: [
        { id: 901, nome: "Bola de Berlim", preco_cent: 150, descricao: null },
        { id: 902, nome: "Pastel de nata", preco_cent: 130, descricao: null },
      ],
    },
    {
      // Nome neutro, de propósito. Chamar-lhe «cortesia» preparava a
      // leitura do "Oferta" que está aqui dentro, e na carta a sério o
      // produto a 0 vai estar numa categoria normal, sem preparação
      // nenhuma — além de que nenhuma carta portuguesa tem uma categoria
      // chamada cortesia. A captura passa a provar o que parece provar.
      id: 10,
      nome: "Águas",
      slug: "aguas",
      produtos: [
        // O 0 da secção 6.2. Mostra "Oferta" — e tem um preço a pagar ao
        // lado, no mesmo cartão, que é o que faz a comparação valer.
        { id: 1001, nome: "Água da casa", preco_cent: 0, descricao: null },
        { id: 1002, nome: "Água com gás", preco_cent: 120, descricao: null },
      ],
    },
    {
      id: 11,
      nome: "Garrafeira",
      slug: "garrafeira",
      produtos: [
        { id: 1101, nome: "Garrafa do Douro", preco_cent: 1800, descricao: null },
        { id: 1102, nome: "Garrafa do Alentejo", preco_cent: 1600, descricao: null },
      ],
    },
    {
      // Cinco das categorias de uma carta de bar são garrafas, e os nomes
      // delas vêm com a marca. É daqui que saem os três caracteres que
      // nenhum nome desta fixtura tinha e que a importação dos produtos
      // vai trazer: o «&», o apóstrofo e os algarismos.
      id: 12,
      nome: "Whiskys",
      slug: "whiskys",
      produtos: [
        // «&» num **nome de produto**, e não só no `slug` de uma
        // categoria: é o caractere que uma escapatória a menos transforma
        // em "J&amp;B" no ecrã.
        { id: 1201, nome: "J&B", preco_cent: 350, descricao: null },
        { id: 1202, nome: "Ballantine's", preco_cent: 400, descricao: null },
        // Algarismos no nome. Pesquisar «12» tem de dar esta linha e só
        // esta: os preços não são pesquisáveis, e há dois produtos a
        // "1,20 €" para o provar.
        { id: 1203, nome: "Chivas 12 anos", preco_cent: 600, descricao: null },
      ],
    },
    {
      // O backend nunca devolve isto (o JOIN interno trata disso), mas o
      // frontend ignora-a na mesma — e ignora o chip dela. É daqui que sai a
      // invariante "um chip por cartão, sempre" (5.2).
      id: 13,
      nome: "Categoria sem produtos",
      slug: "categoria-sem-produtos",
      produtos: [],
    },
  ],
};

/** `{"categorias": []}` com 200 — uma resposta legítima (5.2). */
export const EMENTA_VAZIA: Ementa = { categorias: [] };

/** Só categorias sem produtos: para o ecrã é o mesmo que vazia. */
export const EMENTA_SO_COM_CATEGORIAS_VAZIAS: Ementa = {
  categorias: [
    { id: 90, nome: "Nada hoje", slug: "nada-hoje", produtos: [] },
    { id: 91, nome: "Também nada", slug: "tambem-nada", produtos: [] },
  ],
};

/** Quantos cartões a fixtura devia produzir: as categorias com produtos. */
export const CARTOES_ESPERADOS = EMENTA_DE_TESTE.categorias.filter(
  (categoria) => categoria.produtos.length > 0,
).length;

/** Todo o texto **pesquisável** da fixtura: nomes de categoria e de produto. */
export function nomesPesquisaveis(ementa: Ementa = EMENTA_DE_TESTE): string[] {
  return ementa.categorias.flatMap((categoria) => [
    categoria.nome,
    ...categoria.produtos.map((produto) => produto.nome),
  ]);
}

/** Quantos produtos, ao todo, numa lista de categorias. */
export function contarProdutos(categorias: readonly CategoriaDaEmenta[]): number {
  return categorias.reduce((soma, categoria) => soma + categoria.produtos.length, 0);
}
