/**
 * O que os testes da gestão (F4-01) partilham: o texto literal da
 * `docs/ecras/F4-01.md`, secção 9, e os apoios de histórico.
 *
 * O texto está escrito por extenso, não composto, pela mesma razão que
 * `TEXTOS_DA_GALERIA`: o dominio-bar validou esta tabela, e um teste que a
 * reescrevesse por concatenação deixava de ser o que ele validou. As duas frases
 * do backend (400 e 429) estão aqui só para os testes as devolverem em fingimentos
 * — o frontend **não** as escreve.
 *
 * Só para testes; nada em produção o importa.
 */
import { ErroDaApi } from "../lib/api/cliente";
import type { components } from "../lib/api/gerado/esquema";

export const TEXTOS_DA_GESTAO = {
  nomeDoBar: "Bar da Tomazia",
  tituloDoLogin: "Entrar na gestão",
  etiquetaUtilizador: "Utilizador (obrigatório)",
  etiquetaPassword: "Password (obrigatória)",
  erroUtilizadorVazio: "Escreve o utilizador.",
  erroPasswordVazia: "Escreve a password.",
  botaoEntrar: "Entrar",
  botaoAEntrar: "A entrar…",
  semResposta: "Não consegui entrar. Verifica a ligação e tenta outra vez.",
  servidor:
    "Não consegui entrar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  aAbrir: "A abrir a gestão…",
  erroDaGuardaTitulo: "Não consegui abrir a gestão.",
  erroDaGuardaSemResposta: "Verifica a ligação e tenta outra vez.",
  erroDaGuardaServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",

  saltar: "Saltar para o conteúdo",
  navegacao: "Gestão",

  vazioTitulo: "Ainda não há nada aqui.",
  vazioInicio: "Esta página não tem conteúdo nesta versão.",

  sair: "Sair",
  aSair: "A sair…",
  saiuSemResposta:
    "Não consegui sair, por isso a sessão continua aberta. Verifica a ligação e tenta outra vez.",
  saiuServidor:
    "Não consegui sair, por isso a sessão continua aberta. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
} as const;

/** As duas frases que vêm do backend, verbatim (`app/services/auth.py`). */
export const FRASE_400 = "Utilizador ou password inválidos. Confirma os dois e tenta novamente.";
export const FRASE_429 = "A conta está bloqueada por causa de várias tentativas falhadas.";

/** Os cinco destinos, por ordem, com a rota (secção 5.1). */
export const DESTINOS_ESPERADOS = [
  { rotulo: "Início", caminho: "/gestao" },
  { rotulo: "Ementa", caminho: "/gestao/ementa" },
  { rotulo: "Eventos", caminho: "/gestao/eventos" },
  { rotulo: "Galeria", caminho: "/gestao/galeria" },
  { rotulo: "Mais", caminho: "/gestao/mais" },
] as const;

export const SESSAO_DE_TESTE = { id: 1, utilizador: "dono" } as const;

/** O erro de um 400 do `POST /auth/login`. */
export function erro400(): ErroDaApi {
  return new ErroDaApi(FRASE_400, { estado: 400, codigo: "credenciais_invalidas" });
}

/** O erro de um 429; `extra` e `cabecalhos` à vontade de quem testa. */
export function erro429(
  extra: Record<string, unknown>,
  cabecalhos: Record<string, string> = {},
): ErroDaApi {
  return new ErroDaApi(FRASE_429, { estado: 429, codigo: "conta_bloqueada", extra, cabecalhos });
}

/** O erro de um 401 do `GET /auth/eu`. */
export function erro401(): ErroDaApi {
  return new ErroDaApi("Precisas de entrar.", { estado: 401, codigo: "sessao_em_falta" });
}

/** Sem resposta nenhuma (rede, DNS, prazo). A mensagem é a do cliente, que nenhum ecrã mostra. */
export function erroSemResposta(): ErroDaApi {
  return new ErroDaApi("Não consegui falar com o servidor. (mensagem do cliente)", {
    estado: null,
    codigo: null,
  });
}

/** O servidor respondeu com um código que não é 400 nem 429. */
export function erroDoServidor(estado: number): ErroDaApi {
  return new ErroDaApi("O servidor teve um problema. (mensagem do cliente)", {
    estado,
    codigo: null,
  });
}

/**
 * Põe o endereço onde o teste quer começar, sem acrescentar uma entrada ao
 * histórico. `estado` é o `history.state` (F4-02, D4: o destino depois do login
 * e o aviso «A sessão terminou» viajam aí, nunca no endereço).
 */
export function abrirEm(caminho: string, estado: unknown = null): void {
  window.history.replaceState(estado, "", caminho);
}

// ---------------------------------------------------------------------------
// F4-02 — a ementa na gestão. Dados claramente falsos; tipados com o OpenAPI
// gerado, para uma mudança de contrato partir a compilação.
// ---------------------------------------------------------------------------

export type ProdutoGestao = components["schemas"]["ProdutoGestao"];
export type CategoriaGestao = components["schemas"]["CategoriaGestao"];
export type RespostaEmentaGestao = components["schemas"]["RespostaEmentaGestao"];

/** Um produto falso; só o `id` é obrigatório. */
export function produtoDeTeste(
  parcial: Partial<ProdutoGestao> & Pick<ProdutoGestao, "id">,
): ProdutoGestao {
  return {
    categoria_id: 1,
    nome: `Produto ${String(parcial.id)}`,
    descricao: null,
    preco_cent: 100,
    disponivel: true,
    ...parcial,
  };
}

/**
 * A ementa de gestão de todos os testes: seis casos que a gestão tem de
 * mostrar e o público não. Ids: categoria `n`, produtos `n01`, `n02`…
 *
 *  - Cafetaria: 4 produtos, um indisponível (Cappuccino); ordenável.
 *  - Garrafeira: 3 produtos, o «Vinho tinto da casa» a 6,50 € e com descrição.
 *  - Sobremesas: **escondida** (`visivel: false`), com um produto.
 *  - Petiscos: visível e **sem produtos**.
 *  - Sumos: visível, com um único produto, **indisponível**.
 */
export function ementaDeGestaoDeTeste(): RespostaEmentaGestao {
  return {
    categorias: [
      {
        id: 1,
        nome: "Cafetaria",
        slug: "cafetaria",
        visivel: true,
        produtos: [
          produtoDeTeste({ id: 101, categoria_id: 1, nome: "Café", preco_cent: 120 }),
          produtoDeTeste({ id: 102, categoria_id: 1, nome: "Galão", preco_cent: 180 }),
          produtoDeTeste({
            id: 103,
            categoria_id: 1,
            nome: "Cappuccino",
            preco_cent: 250,
            disponivel: false,
          }),
          produtoDeTeste({ id: 104, categoria_id: 1, nome: "Café duplo", preco_cent: 160 }),
        ],
      },
      {
        id: 2,
        nome: "Garrafeira",
        slug: "garrafeira",
        visivel: true,
        produtos: [
          produtoDeTeste({
            id: 201,
            categoria_id: 2,
            nome: "Vinho tinto da casa",
            descricao: "Tinto, copo",
            preco_cent: 650,
          }),
          produtoDeTeste({ id: 202, categoria_id: 2, nome: "Espumante", preco_cent: 1200 }),
          produtoDeTeste({ id: 203, categoria_id: 2, nome: "Porto tawny", preco_cent: 800 }),
        ],
      },
      {
        id: 3,
        nome: "Sobremesas",
        slug: "sobremesas",
        visivel: false,
        produtos: [produtoDeTeste({ id: 301, categoria_id: 3, nome: "Pudim", preco_cent: 350 })],
      },
      { id: 4, nome: "Petiscos", slug: "petiscos", visivel: true, produtos: [] },
      {
        id: 5,
        nome: "Sumos",
        slug: "sumos",
        visivel: true,
        produtos: [
          produtoDeTeste({
            id: 501,
            categoria_id: 5,
            nome: "Sumo de laranja",
            preco_cent: 300,
            disponivel: false,
          }),
        ],
      },
    ],
  };
}

/**
 * Os textos de `docs/ecras/F4-02.md`, secção 14, por extenso (como os da F4-01:
 * o dominio-bar validou esta tabela). Os euros levam espaço normal; os testes
 * comparam com `rx()`, que aceita o espaço inquebrável de `formatarPreco`.
 */
export const TEXTOS_DA_EMENTA_GESTAO = {
  titulo: "Ementa",
  pesquisa: "Pesquisar produto",
  navegacaoDeCategorias: "Categorias",
  semResultados: "Não encontrei nada com esse nome.",
  limparPesquisa: "Limpar pesquisa",
  categoriaEscondida: "Esta categoria não aparece na ementa.",
  categoriaSemProdutos:
    "Ainda não há produtos nesta categoria. Enquanto estiver vazia, não aparece na ementa.",
  categoriaTodaIndisponivel:
    "Todos os produtos desta categoria estão indisponíveis. Enquanto for assim, não aparece na ementa.",
  adicionarProduto: "Adicionar produto",
  produtoIndisponivel: "Não aparece na ementa.",
  etiquetaDoPreco: "Preço, em euros",
  guardar: "Guardar",
  aGuardar: "A guardar…",
  cancelar: "Cancelar",
  erroPrecoVazio: "Escreve o preço.",
  erroPrecoInvalido: "Escreve só algarismos e vírgula, como 6,50.",
  erroPrecoDecimais: "Usa no máximo dois algarismos depois da vírgula, como 6,50.",
  erroPrecoAlto: "O preço é demasiado alto.",
  erroPreco422: "O preço não é válido.",
  avisoOferta: "Este produto fica como oferta na ementa.",
  desfazer: "Desfazer",
  ordenar: "Ordenar",
  guardarOrdem: "Guardar ordem",
  ordemGuardada: "Ordem guardada.",
  alteracaoDesfeita: "Alteração desfeita",
  erroGuardarSemResposta: "Não consegui guardar. Verifica a ligação e tenta outra vez.",
  erroCriarSemResposta:
    "Não sei se o produto ficou guardado. Atualizei a lista: vê se já lá está antes de tentar outra vez.",
  erroGuardarServidor:
    "Não consegui guardar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  erroOrdemSemResposta: "Não consegui guardar a ordem. Verifica a ligação e tenta outra vez.",
  erroOrdemServidor:
    "Não consegui guardar a ordem. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  erro409:
    "A ordem não ficou guardada porque a lista mudou entretanto. Atualizei-a: confirma a ordem e tenta outra vez.",
  erroDesfazerOrdem409:
    "Não consegui repor a ordem anterior: a ementa mudou entretanto. Já mostro a lista atual.",
  erro404Produto: "Este produto já não existe. Atualizei a ementa.",
  erro404Categoria: "Esta categoria já não existe. Atualizei a ementa.",
  erro422SemCampo: "Não consegui guardar. Confirma os campos e tenta outra vez.",
  vazioTitulo: "Ainda não há ementa.",
  vazioLinha: "Ainda não há categorias para mostrar.",
  erroDeCarregarTitulo: "Não consegui carregar a ementa.",
  erroDeCarregarSemResposta: "Verifica a ligação e tenta outra vez.",
  erroDeCarregarServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  tituloAdicionar: "Adicionar produto",
  tituloEditar: "Editar produto",
  etiquetaNome: "Nome (obrigatório)",
  etiquetaDescricao: "Descrição (opcional)",
  etiquetaPrecoDaFolha: "Preço, em euros, com IVA (obrigatório)",
  etiquetaCategoria: "Categoria (obrigatória)",
  etiquetaDisponivel: "Disponível",
  escolheACategoria: "Escolhe a categoria",
  guardarProduto: "Guardar produto",
  guardarAlteracoes: "Guardar alterações",
  erroNomeVazio: "Escreve o nome do produto.",
  erroNomeLongo: "O nome tem no máximo 120 caracteres.",
  erroDescricaoLonga: "A descrição tem no máximo 280 caracteres.",
  erroCategoriaEmFalta: "Escolhe a categoria.",
  erroCategoriaInexistente: "Essa categoria já não existe. Escolhe outra.",
  produtoAdicionado: "Produto adicionado.",
  produtoAtualizado: "Produto atualizado.",
  sessaoTerminou: "A sessão terminou. Entra outra vez.",
} as const;

/**
 * O 404 de um `PATCH` (`produto_inexistente`), de um `PUT` (`categoria_inexistente`), de
 * qualquer pedido a um evento (`evento_inexistente`, F4-03) ou a uma foto (`foto_nao_encontrada`,
 * F4-04).
 */
export function erro404(
  codigo:
    "produto_inexistente" | "categoria_inexistente" | "evento_inexistente" | "foto_nao_encontrada",
): ErroDaApi {
  return new ErroDaApi("Não encontrei isto. (mensagem do backend)", { estado: 404, codigo });
}

/** O 409 do `PUT .../produtos/ordem`. A `mensagem` do backend nunca pode chegar ao ecrã. */
export function erro409ListaDesatualizada(): ErroDaApi {
  return new ErroDaApi("Recarrega a página e tenta outra vez. (mensagem do backend)", {
    estado: 409,
    codigo: "lista_desatualizada",
  });
}

/** O 422 do envelope, com o `campo` em `extra` (ou sem ele). */
export function erro422(campo: string | null, codigo = "dados_invalidos"): ErroDaApi {
  return new ErroDaApi("o corpo não é válido (mensagem do backend)", {
    estado: 422,
    codigo,
    extra: campo === null ? {} : { campo },
  });
}

/**
 * Para comparar texto com euros: `formatarPreco` escreve U+00A0 antes do «€» e
 * o nome acessível não é normalizado pelo Testing Library. Devolve uma
 * expressão **exata** em que cada espaço aceita qualquer espaço em branco.
 */
export function rx(texto: string): RegExp {
  const escapado = texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s");
  return new RegExp(`^${escapado}$`);
}

/** Como `rx`, mas a frase só tem de aparecer dentro do texto. */
export function contem(texto: string): RegExp {
  const escapado = texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s");
  return new RegExp(escapado);
}

/**
 * A tabela do redirecionamento aberto (plano 5.2, já descodificada porque o
 * `history.state` não passa por `URLSearchParams`): tudo isto, como `voltar`,
 * tem de acabar em `/gestao`. Partilhada pelo teste da função pura e pelo do
 * `Entrar`, que a corre pelo componente.
 */
export const DESTINOS_MALICIOSOS: ReadonlyArray<readonly [string, string]> = [
  ["fora, com duas barras", "//evil.example"],
  ["fora, duas barras codificadas", "%2F%2Fevil.example"],
  ["barra e contrabarra", "/\\evil.example"],
  ["duas contrabarras", "\\\\evil.example"],
  ["contrabarra dentro de /gestao/", "/gestao/\\evil"],
  ["contrabarra codificada", "/gestao/%5Cevil"],
  ["URL absoluto", "https://evil.example/gestao/ementa"],
  ["esquema sem barras", "https:evil.example"],
  ["javascript:", "javascript:alert(1)"],
  ["JAVASCRIPT: em maiúsculas", "JAVASCRIPT:alert(1)"],
  ["data:", "data:text/html,x"],
  ["barras duplas por baixo de /gestao", "/gestao//evil.example"],
  ["segmento ..", "/gestao/../"],
  ["segmento .. sem barra final", "/gestao/.."],
  ["segmento .", "/gestao/./ementa"],
  ["ponto codificado", "/gestao/%2e%2e/"],
  ["codificação dupla", "/gestao/%252F%252Fevil"],
  ["tabulação à frente", "\t/gestao/ementa"],
  ["tabulação no meio (o browser apaga-a)", "/\t/evil.example"],
  ["quebra de linha no fim", "/gestao/ementa\n"],
  ["retorno de linha", "/gestao/ementa\r"],
  ["espaço à frente", " /gestao/ementa"],
  ["espaço no fim", "/gestao/ementa "],
  ["NUL no fim", "/gestao/ementa\u0000"],
  ["DEL no fim", "/gestao/ementa\u007f"],
  ["controlo U+001F", "/gestao/\u001fementa"],
  ["query desconhecida", "/gestao/ementa?x=1"],
  ["categoria vazia", "/gestao/ementa?categoria="],
  ["categoria em maiúsculas", "/gestao/ementa?categoria=Garrafeira"],
  ["categoria com espaço", "/gestao/ementa?categoria=a b"],
  ["categoria com acento", "/gestao/ementa?categoria=café"],
  ["categoria com barra", "/gestao/ementa?categoria=a/b"],
  ["categoria com `//`", "/gestao/ementa?categoria=//evil.example"],
  ["categoria com %", "/gestao/ementa?categoria=a%2Fb"],
  ["categoria com &", "/gestao/ementa?categoria=a&x=1"],
  ["duas categorias", "/gestao/ementa?categoria=a&categoria=b"],
  ["categoria com ponto", "/gestao/ementa?categoria=a.b"],
  ["query noutro destino", "/gestao/eventos?categoria=x"],
  ["fragmento", "/gestao/ementa#x"],
  ["fragmento e categoria", "/gestao/ementa?categoria=a#x"],
  ["barra a mais", "/gestao/ementa/"],
  ["maiúsculas no prefixo", "/GESTAO/ementa"],
  ["maiúsculas no destino", "/gestao/Ementa"],
  ["sem a barra inicial", "gestao/ementa"],
  ["o ciclo: o login", "/gestao/entrar"],
  ["o ciclo, com query", "/gestao/entrar?categoria=x"],
  ["destino que não existe", "/gestao/desconhecido"],
  ["destino parecido", "/gestaoX"],
  ["destino parecido com barra", "/gestaoX/ementa"],
  ["a raiz do site", "/"],
  ["fora da gestão", "/ementa"],
  ["a barra da gestão", "/gestao/"],
  ["65 caracteres a seguir a /gestao/", `/gestao/${"a".repeat(65)}`],
  ["categoria enorme", `/gestao/ementa?categoria=${"a".repeat(80)}`],
  ["destino válido com lixo no fim", "/gestao/ementaX"],
  ["destino válido com prefixo", "x/gestao/ementa"],
];

// ---------------------------------------------------------------------------
// F4-05a — as definições na gestão. Dados claramente falsos; tipados com o
// OpenAPI gerado.
// ---------------------------------------------------------------------------

export type DefinicoesGestao = components["schemas"]["DefinicoesGestao"];
export type PedidoDefinicoes = components["schemas"]["PedidoDefinicoes"];
export type DiaDoHorario = components["schemas"]["DiaDoHorario"];
export type PeriodoDoHorario = components["schemas"]["PeriodoDoHorario"];
export type DiaDaSemana = DiaDoHorario["dia"];

/** Os sete dias, de segunda a domingo (a ordem do backend e do editor). */
export const DIAS_PELA_ORDEM: readonly DiaDaSemana[] = [
  "segunda",
  "terca",
  "quarta",
  "quinta",
  "sexta",
  "sabado",
  "domingo",
];

/**
 * Os sete dias a partir de `{ dia: [[abre, fecha], …] }`; o que não se diz é
 * fechado (`periodos: []`). Espelha `semana()` de `backend/tests/gestao/test_definicoes.py`.
 */
export function semanaDeTeste(
  periodos: Partial<Record<DiaDaSemana, ReadonlyArray<readonly [string, string]>>> = {},
): DiaDoHorario[] {
  return DIAS_PELA_ORDEM.map((dia) => ({
    dia,
    periodos: (periodos[dia] ?? []).map(([abre, fecha]) => ({ abre, fecha })),
  }));
}

/** O horário de todos os testes: segunda fechada, sexta com almoço e noite, sábado a passar da meia-noite. */
export function horarioDeTeste(): DiaDoHorario[] {
  return semanaDeTeste({
    terca: [["17:00", "02:00"]],
    quarta: [["17:00", "02:00"]],
    quinta: [["17:00", "02:00"]],
    sexta: [
      ["12:00", "15:00"],
      ["19:00", "02:00"],
    ],
    sabado: [["17:00", "03:00"]],
    domingo: [["15:00", "23:00"]],
  });
}

/** Tudo preenchido, o horário `configurado`. A password leva um espaço no fim, de propósito. */
export function definicoesConfiguradas(): DefinicoesGestao {
  return {
    wifi_rede: "tomazia-exemplo",
    wifi_password: "cerveja-fresca-2026 ",
    morada: "Rua de Exemplo, 12, Estarreja",
    telefone: "912345678",
    instagram: "https://www.instagram.com/bar.exemplo",
    maps_url: "https://maps.example.test/tomazia",
    horario: horarioDeTeste(),
    horario_estado: "configurado",
  };
}

/** Instalação nova: tudo `""`, `horario: null`, `nao_configurado` (um estado normal, não um erro). */
export function definicoesVazias(): DefinicoesGestao {
  return {
    wifi_rede: "",
    wifi_password: "",
    morada: "",
    telefone: "",
    instagram: "",
    maps_url: "",
    horario: null,
    horario_estado: "nao_configurado",
  };
}

/** O horário guardado está estragado: vem `null`, mas o estado diz `invalido`. */
export function definicoesComHorarioInvalido(): DefinicoesGestao {
  return { ...definicoesConfiguradas(), horario: null, horario_estado: "invalido" };
}

/** O que o servidor devolveria a um `PUT` com `pedido` (o estado vem do horário). */
export function ecoDoPedido(pedido: PedidoDefinicoes): DefinicoesGestao {
  return {
    ...pedido,
    horario_estado: pedido.horario === null ? "nao_configurado" : "configurado",
  };
}

// ---------------------------------------------------------------------------
// F4-03 — os eventos na gestão. Dados claramente falsos; tipados com o OpenAPI
// gerado. O relógio de todos os testes é o `AGORA` de `./eventos` (segunda-feira,
// 2 de novembro de 2026, 10:00 em Lisboa); em novembro Lisboa está em UTC+0, por
// isso a hora de parede é a do `…Z`.
// ---------------------------------------------------------------------------

export type EventoGestao = components["schemas"]["EventoGestao"];
export type RespostaEventosGestao = components["schemas"]["RespostaEventosGestao"];

/** Um evento falso; só o `id` é obrigatório. Publicado, com data e sem cartaz por omissão. */
export function eventoDeTeste(
  parcial: Partial<EventoGestao> & Pick<EventoGestao, "id">,
): EventoGestao {
  return {
    titulo: `Evento ${String(parcial.id)}`,
    inicio: "2026-11-05T22:00:00Z",
    descricao: null,
    imagem: null,
    publicado: true,
    ...parcial,
  };
}

/** O nome do ficheiro do cartaz de teste (só se lê; a gestão não o muda, F4-07). */
export const CARTAZ_DA_GESTAO = "cartaz-de-teste.png";

/**
 * As três listas de todos os testes, **como o servidor as divide** (corte à
 * meia-noite de Lisboa de 2/11/2026, ADR 0010). Ids: próximos `1x`, rascunhos
 * `2x`, arquivo `3x`.
 *
 *  - Próximos (4, do mais próximo ao mais longe; o 4.º fica abaixo da divisória):
 *    «Fado ao vivo» (qui 5/11 22:00, descrição de duas linhas), «Karaoke de teste»
 *    (sex 6/11 **00:30**), «Sessão de jazz» (qui 12/11 22:00), «Concerto de teste»
 *    (qui 19/11 22:00).
 *  - Rascunhos: «Rascunho com data» (sex 20/11 22:00) e **«Rascunho importado»,
 *    sem data** (ADR 0009).
 *  - Arquivo: «Noite de samba» (qui 29/10 22:00, **com cartaz**) e «Fado de
 *    outubro» (qui 15/10 22:00 de Lisboa, hora de verão = 21:00Z).
 */
export function eventosDeGestaoDeTeste(): RespostaEventosGestao {
  return {
    proximos: [
      eventoDeTeste({
        id: 11,
        titulo: "Fado ao vivo",
        inicio: "2026-11-05T22:00:00Z",
        descricao: "Primeira linha da descrição.\nSegunda linha da descrição.",
      }),
      eventoDeTeste({ id: 12, titulo: "Karaoke de teste", inicio: "2026-11-06T00:30:00Z" }),
      eventoDeTeste({ id: 13, titulo: "Sessão de jazz", inicio: "2026-11-12T22:00:00Z" }),
      eventoDeTeste({ id: 14, titulo: "Concerto de teste", inicio: "2026-11-19T22:00:00Z" }),
    ],
    rascunhos: [
      eventoDeTeste({
        id: 21,
        titulo: "Rascunho com data",
        inicio: "2026-11-20T22:00:00Z",
        publicado: false,
      }),
      eventoDeTeste({ id: 22, titulo: "Rascunho importado", inicio: null, publicado: false }),
    ],
    arquivo: [
      eventoDeTeste({
        id: 31,
        titulo: "Noite de samba",
        inicio: "2026-10-29T22:00:00Z",
        imagem: CARTAZ_DA_GESTAO,
      }),
      eventoDeTeste({ id: 32, titulo: "Fado de outubro", inicio: "2026-10-15T21:00:00Z" }),
    ],
  };
}

/** As três listas vazias: um `200` normal (a instalação nova), nunca um erro. */
export function eventosDeGestaoVazios(): RespostaEventosGestao {
  return { proximos: [], rascunhos: [], arquivo: [] };
}

/**
 * O 422 de publicar um rascunho sem data (`evento_sem_data`, `campo = "inicio"`). A
 * `mensagem` do backend nunca pode chegar ao ecrã.
 */
export function erro422EventoSemData(): ErroDaApi {
  return new ErroDaApi("O evento não tem data. (mensagem do backend)", {
    estado: 422,
    codigo: "evento_sem_data",
    extra: { campo: "inicio" },
  });
}

// ---------------------------------------------------------------------------
// F4-04 — a moderação de fotos na gestão. Dados claramente falsos; tipados com o
// OpenAPI gerado. O relógio de todos os testes é o `AGORA` de `./eventos` (segunda-feira,
// 2 de novembro de 2026, 10:00 em Lisboa; em novembro Lisboa está em UTC+0).
// ---------------------------------------------------------------------------

export type FotoPendente = components["schemas"]["FotoPendente"];
export type RespostaFilaDeModeracao = components["schemas"]["RespostaFilaDeModeracao"];

/** Uma foto pendente falsa; só o `id` é obrigatório. Sem legenda nem nome por omissão. */
export function fotoPendenteDeTeste(
  parcial: Partial<FotoPendente> & Pick<FotoPendente, "id">,
): FotoPendente {
  return {
    ficheiro: `foto-${String(parcial.id)}.webp`,
    descricao: null,
    enviada_por: null,
    criada_em: "2026-11-02T09:15:00Z",
    ...parcial,
  };
}

/** A legenda mais comprida que o backend aceita, sem um único espaço para quebrar. */
export const LEGENDA_DE_255 = "Z".repeat(255);

/**
 * A fila de todos os testes, **como o servidor a manda** (da mais antiga para a mais recente).
 * `filaDeTeste(n)` devolve as `n` primeiras (até 5). Ids 101 a 105; relógio em `AGORA`.
 *
 *  - 101: legenda com `&`, apóstrofo e emoji, enviada por «Rita»; **ontem**, 23:40.
 *  - 102: sem legenda e sem nome; hoje, 00:30.
 *  - 103: legenda de 255 carateres sem espaços, por «Zé»; hoje, **01:10** («à 01:10»).
 *  - 104: legenda curta, por «Marta»; hoje, 08:00.
 *  - 105: sem legenda, por «Quim»; hoje, 09:15.
 */
export function filaDeTeste(n = 3): FotoPendente[] {
  const todas: FotoPendente[] = [
    fotoPendenteDeTeste({
      id: 101,
      descricao: "Noite de samba 🎶 & amigos d'a casa",
      enviada_por: "Rita",
      criada_em: "2026-11-01T23:40:00Z",
    }),
    fotoPendenteDeTeste({ id: 102, criada_em: "2026-11-02T00:30:00Z" }),
    fotoPendenteDeTeste({
      id: 103,
      descricao: LEGENDA_DE_255,
      enviada_por: "Zé",
      criada_em: "2026-11-02T01:10:00Z",
    }),
    fotoPendenteDeTeste({
      id: 104,
      descricao: "Quarta foto",
      enviada_por: "Marta",
      criada_em: "2026-11-02T08:00:00Z",
    }),
    fotoPendenteDeTeste({
      id: 105,
      enviada_por: "Quim",
      criada_em: "2026-11-02T09:15:00Z",
    }),
  ];
  return todas.slice(0, n);
}

/** O 409 de aprovar ou rejeitar uma foto que já não está pendente. A `mensagem` nunca chega ao ecrã. */
export function erro409FotoJaModerada(): ErroDaApi {
  return new ErroDaApi("A foto já foi moderada. (mensagem do backend)", {
    estado: 409,
    codigo: "foto_ja_moderada",
  });
}

// ---------------------------------------------------------------------------
// F4-04b — as fotos aprovadas (a secção «Fotos no site»). Mesmos dados falsos.
// ---------------------------------------------------------------------------

export type FotoAprovada = components["schemas"]["FotoAprovada"];

/** Uma foto aprovada falsa; só o `id` é obrigatório. Sem legenda nem nome por omissão. */
export function fotoAprovadaDeTeste(
  parcial: Partial<FotoAprovada> & Pick<FotoAprovada, "id">,
): FotoAprovada {
  return {
    ficheiro: `foto-${String(parcial.id)}.webp`,
    descricao: null,
    enviada_por: null,
    criada_em: "2026-10-30T12:00:00Z",
    moderada_em: "2026-11-02T08:05:00Z",
    ...parcial,
  };
}

/**
 * As três aprovadas de todos os testes, **da mais recente para a mais antiga** (a ordem do
 * servidor). `quando` é o que o item diz (relógio em `AGORA`).
 *
 *  - 201: legenda com `&` e emoji, por «Marta»; «hoje, às 08:05».
 *  - 202: **sem legenda nem nome**; «hoje, à 01:10».
 *  - 203: legenda de 255 carateres sem espaços, por «Zé»; «ontem, às 23:40».
 */
export const QUANDO_DAS_APROVADAS: Record<number, string> = {
  201: "hoje, às 08:05",
  202: "hoje, à 01:10",
  203: "ontem, às 23:40",
};
export const LEGENDA_DA_201 = "Aniversário da Marta 🎉 & amigos d'a casa";

export function aprovadasDeTeste(n = 3): FotoAprovada[] {
  const todas: FotoAprovada[] = [
    fotoAprovadaDeTeste({
      id: 201,
      descricao: LEGENDA_DA_201,
      enviada_por: "Marta",
      moderada_em: "2026-11-02T08:05:00Z",
    }),
    fotoAprovadaDeTeste({ id: 202, moderada_em: "2026-11-02T01:10:00Z" }),
    fotoAprovadaDeTeste({
      id: 203,
      descricao: "Z".repeat(255),
      enviada_por: "Zé",
      moderada_em: "2026-11-01T23:40:00Z",
    }),
  ];
  return todas.slice(0, n);
}

/** `n` aprovadas (ids 1 a `n`), a de id maior é a mais recente; pela ordem do servidor (a mais recente primeiro). */
export function muitasAprovadas(n: number): FotoAprovada[] {
  const fotos: FotoAprovada[] = [];
  for (let id = n; id >= 1; id -= 1) {
    const minutos = String(id).padStart(2, "0");
    fotos.push(
      fotoAprovadaDeTeste({
        id,
        descricao: `Legenda ${String(id)}`,
        moderada_em: `2026-10-20T10:${minutos}:00Z`,
      }),
    );
  }
  return fotos;
}
