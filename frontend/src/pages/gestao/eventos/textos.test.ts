/**
 * F4-03, plano 7.1 e spec 16 — a tabela `TEXTOS` de `textos.ts` (a do dominio-bar).
 *
 * Os testes de componente prendem-se a `TEXTOS` e nunca a frases escritas à mão, para uma
 * mudança de frase não reescrever testes. **Isto é o contrato de nomes**: cada chave que os
 * testes usam tem de existir (sem esta lista, uma chave em falta dava `undefined` e um
 * `getByText(undefined)` partia com uma mensagem sobre outra coisa).
 *
 * Aqui prova-se o que **não** depende da frase: que as chaves existem, que as frases que a
 * regra 10 obriga a distinguir são diferentes, que as que têm buracos os usam, e as regras de
 * português de Portugal (a varredura geral está em `src/textos-pt-pt.test.ts`).
 */
import { describe, expect, it } from "vitest";

import * as modulo from "./textos";
import { ERRO_422_POR_CAMPO, TEXTOS } from "./textos";

/** As chaves de texto simples (`string`). */
const CHAVES_DE_TEXTO = [
  "titulo",
  "novoEvento",
  "proximos",
  "rascunhos",
  "arquivo",
  "linhaDosProximos",
  "linhaDosRascunhos",
  "divisoria",
  "esconderOArquivo",
  "semData",
  "notaSemData",
  "notaPassada",
  "notaHoje",
  "vazioTitulo",
  "vazioLinha",
  "proximosVazios",
  "carregarTitulo",
  "carregarSemResposta",
  "carregarServidor",
  "tentarOutraVez",
  "aTentar",
  "tituloCriar",
  "tituloEditar",
  "tituloDuplicar",
  "tituloEliminar",
  "etiquetaTitulo",
  "etiquetaDescricao",
  "etiquetaData",
  "etiquetaHora",
  "contadorUm",
  "contadorLimite",
  "avisoDeFuso",
  "ajudaMeiaNoite",
  "dataPassada",
  "dataPassadaRascunho",
  "dataLonge",
  "assimApareceTitulo",
  "legendaPublicado",
  "legendaRascunho",
  "temCartaz",
  "estadoRascunho",
  "estadoPublicado",
  "publicar",
  "guardarRascunho",
  "guardarAlteracoes",
  "aGuardar",
  "cancelar",
  "eliminarEvento",
  "eliminar",
  "aEliminar",
  "eliminarAviso",
  "desfazer",
  "erroTituloVazio",
  "erroTituloLongo",
  "erroDescricaoLonga",
  "erroDataVazia",
  "erroDataIncompleta",
  "erroDataInvalida",
  "erroHoraVazia",
  "erroHoraIncompleta",
  "erroHoraInexistente",
  "erroPublicarSemData",
  "erro422Titulo",
  "erro422Descricao",
  "erro422Data",
  "erro422SemCampo",
  "corrigeOsCampos",
  "eventoPublicadoNoSite",
  "eventoPublicadoSoTres",
  "eventoNoArquivo",
  "rascunhoGuardado",
  "eventoAtualizado",
  "rascunhoAtualizado",
  "rascunhoCriadoSemData",
  "duplicarSemSaber",
  "duplicar422",
  "duplicarServidor",
  "eventoEliminado",
  "eventoEliminadoNoSite",
  "eliminarContinuaLa",
  "eliminarSemSaber",
  "desfazerSemResposta",
  "desfazerServidor",
  "desfazerRascunhoFicou",
  "semRespostaGuardar",
  "semRespostaInterruptor",
  "eventoGuardadoSemResposta",
  "criarNaoEncontrado",
  "servidorGuardar",
  "servidorEliminar",
  "jaNaoExiste",
  "semDataCorrida",
  "recarregarFalhou",
  "recarregarSemResposta",
  "recarregarServidor",
  "atualizar",
  "saidaTitulo",
  "saidaLinha",
  "saidaSair",
  "saidaContinuar",
] as const;

/** As chaves que são funções (os buracos de cada frase), com os argumentos de exemplo. */
const CHAVES_DE_FUNCAO = [
  "comHora",
  "contadorFaltam",
  "daquiASemanas",
  "despublicadoDoSite",
  "duplicarDe",
  "mostrarMais",
  "publicadoDe",
  "publicadoNoArquivo",
  "publicadoNoSite",
  "publicadoSoTres",
  "rascunhoCriadoPara",
  "vaisEliminar",
  "verOArquivo",
] as const;

type Tabela = Record<string, unknown>;
const T = TEXTOS as unknown as Tabela;

function textoDe(chave: string): string {
  const v = T[chave];
  if (typeof v !== "string") throw new Error(`TEXTOS.${chave} não é um texto`);
  return v;
}
function frase(chave: (typeof CHAVES_DE_FUNCAO)[number], ...args: unknown[]): string {
  const f = T[chave];
  if (typeof f !== "function") throw new Error(`TEXTOS.${chave} não é uma função`);
  return (f as (...a: unknown[]) => string)(...args);
}

/** Tudo o que a tabela escreve, com exemplos para os buracos. */
function todasAsFrases(): string[] {
  return [
    ...CHAVES_DE_TEXTO.map(textoDe),
    frase("comHora", "22:00"),
    frase("comHora", "01:30"),
    frase("contadorFaltam", 100),
    frase("daquiASemanas", 1),
    frase("daquiASemanas", 2),
    frase("despublicadoDoSite", "Fado ao vivo"),
    frase("duplicarDe", "Fado ao vivo"),
    frase("mostrarMais", 20),
    frase("publicadoDe", "Fado ao vivo"),
    frase("publicadoNoArquivo", "Fado ao vivo"),
    frase("publicadoNoSite", "Fado ao vivo"),
    frase("publicadoSoTres", "Fado ao vivo"),
    frase("rascunhoCriadoPara", "quinta-feira, 26 de novembro, às 22:00"),
    frase("vaisEliminar", "Fado ao vivo", "Quinta-feira, 5 de novembro, às 22:00"),
    frase("vaisEliminar", "Fado ao vivo", null),
    frase("verOArquivo", 12),
  ];
}

describe("a tabela existe e está completa", () => {
  it.each(CHAVES_DE_TEXTO)("TEXTOS.%s é um texto não vazio, sem espaços nas pontas", (chave) => {
    const v = textoDe(chave);
    expect(v.length).toBeGreaterThan(0);
    expect(v).toBe(v.trim());
  });

  it.each(CHAVES_DE_FUNCAO)("TEXTOS.%s é uma função", (chave) => {
    expect(typeof T[chave]).toBe("function");
  });

  it("exporta o mapa `campo` → frase do 422 (ERRO_422_POR_CAMPO) com titulo, inicio e descricao", () => {
    const mapa = ERRO_422_POR_CAMPO as unknown as Record<string, string>;
    expect(Object.keys(mapa).sort()).toEqual(["descricao", "inicio", "titulo"]);
    expect(mapa["titulo"]).toBe(TEXTOS.erro422Titulo);
    expect(mapa["inicio"]).toBe(TEXTOS.erro422Data);
    expect(mapa["descricao"]).toBe(TEXTOS.erro422Descricao);
    expect(new Set(Object.values(mapa)).size).toBe(3);
  });

  it("o módulo exporta `TEXTOS` e o mapa (e nenhum literal avulso em vez de os usar)", () => {
    expect(modulo.TEXTOS).toBeDefined();
    expect(modulo.ERRO_422_POR_CAMPO).toBeDefined();
  });
});

describe("os buracos usam os argumentos (e nunca escrevem «undefined» nem «null»)", () => {
  it("as frases com o título levam o título", () => {
    for (const chave of [
      "despublicadoDoSite",
      "duplicarDe",
      "publicadoDe",
      "publicadoNoArquivo",
      "publicadoNoSite",
      "publicadoSoTres",
    ] as const) {
      expect(frase(chave, "Noite de samba"), chave).toContain("Noite de samba");
    }
  });

  it("os nomes acessíveis da linha distinguem-se entre si e entre eventos", () => {
    expect(frase("publicadoDe", "A")).not.toBe(frase("publicadoDe", "B"));
    expect(frase("duplicarDe", "A")).not.toBe(frase("duplicarDe", "B"));
    expect(frase("publicadoDe", "A")).not.toBe(frase("duplicarDe", "A"));
    // O botão do título tem como nome o próprio título: estes nomes não podem ser iguais a ele.
    expect(frase("publicadoDe", "A")).not.toBe("A");
    expect(frase("duplicarDe", "A")).not.toBe("A");
  });

  it("«Daqui a 1 semana» no singular; 2 e 3 no plural; as três são diferentes", () => {
    const [um, dois, tres] = [1, 2, 3].map((n) => frase("daquiASemanas", n)) as [
      string,
      string,
      string,
    ];
    expect(um).toContain("1");
    expect(um).not.toMatch(/semanas/);
    expect(um).toMatch(/semana/);
    expect(dois).toMatch(/semanas/);
    expect(dois).toContain("2");
    expect(tres).toContain("3");
    expect(new Set([um, dois, tres]).size).toBe(3);
  });

  it("a hora: à uma da manhã «à 01:00», nas outras «às»", () => {
    expect(frase("comHora", "01:00")).toMatch(/^à 01:00$/);
    expect(frase("comHora", "01:30")).toMatch(/^à 01:30$/);
    for (const h of ["00:30", "02:00", "13:00", "22:00"]) {
      expect(frase("comHora", h), h).toBe(`às ${h}`);
    }
  });

  it("o contador, o arquivo e «mostrar mais» levam o número", () => {
    expect(frase("contadorFaltam", 100)).toContain("100");
    expect(frase("verOArquivo", 25)).toContain("25");
    expect(frase("mostrarMais", 20)).toContain("20");
    expect(frase("mostrarMais", 5)).toContain("5");
  });

  it("«cópia criada para {data}» leva a data tal como vem", () => {
    const data = "quinta-feira, 26 de novembro, às 22:00";
    expect(frase("rascunhoCriadoPara", data)).toContain(data);
  });

  it("«Vais eliminar {título}, {data}» e a variante sem data são frases diferentes e sem buracos por preencher", () => {
    const com = frase("vaisEliminar", "Fado ao vivo", "Quinta-feira, 5 de novembro, às 22:00");
    const sem = frase("vaisEliminar", "Fado ao vivo", null);
    expect(com).toContain("Fado ao vivo");
    // A spec 8 escreve a data dentro dos parênteses em minúscula; a função põe a inicial como
    // convém, por isso compara-se sem olhar para a maiúscula.
    expect(com.toLowerCase()).toContain("quinta-feira, 5 de novembro, às 22:00");
    expect(sem).toContain("Fado ao vivo");
    expect(sem).not.toMatch(/null|undefined/);
    expect(sem).not.toBe(com);
  });

  it("nenhuma frase tem «undefined», «null», «NaN» nem chavetas por preencher", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(/undefined|\bnull\b|NaN|\{|\}/);
  });
});

describe("regra 10: o que é diferente diz-se diferente", () => {
  const diferentes: ReadonlyArray<readonly [string, string]> = [
    ["carregarSemResposta", "carregarServidor"],
    ["vazioTitulo", "carregarTitulo"],
    ["vazioLinha", "carregarSemResposta"],
    ["proximosVazios", "vazioTitulo"],
    ["erroHoraVazia", "erroHoraIncompleta"],
    ["erroDataVazia", "erroDataIncompleta"],
    ["erroHoraInexistente", "erroHoraIncompleta"],
    ["erroDataInvalida", "erroDataVazia"],
    ["semRespostaGuardar", "servidorGuardar"],
    ["semRespostaInterruptor", "servidorGuardar"],
    ["desfazerSemResposta", "desfazerServidor"],
    ["recarregarSemResposta", "recarregarServidor"],
    ["eventoEliminado", "eliminarContinuaLa"],
    ["eventoEliminado", "eliminarSemSaber"],
    ["eliminarContinuaLa", "eliminarSemSaber"],
    ["servidorEliminar", "servidorGuardar"],
    ["duplicarSemSaber", "duplicarServidor"],
    ["criarNaoEncontrado", "eventoGuardadoSemResposta"],
    ["eventoPublicadoNoSite", "eventoPublicadoSoTres"],
    ["eventoPublicadoSoTres", "eventoNoArquivo"],
    ["rascunhoGuardado", "rascunhoAtualizado"],
    ["eventoAtualizado", "rascunhoAtualizado"],
    ["eventoEliminado", "eventoEliminadoNoSite"],
    ["rascunhoCriadoSemData", "duplicarSemSaber"],
    ["erro422Titulo", "erro422Descricao"],
    ["erro422Data", "erroPublicarSemData"],
    ["jaNaoExiste", "eventoEliminado"],
  ];
  it.each(diferentes)("TEXTOS.%s ≠ TEXTOS.%s", (a, b) => {
    expect(textoDe(a)).not.toBe(textoDe(b));
  });

  it("sem resposta nunca diz «guardado» nem «não guardei» como facto", () => {
    for (const chave of [
      "semRespostaGuardar",
      "semRespostaInterruptor",
      "duplicarSemSaber",
      "eliminarSemSaber",
    ]) {
      // «Não sei se ficou guardado.» é a frase certa (diz que não se sabe); o que se proíbe é
      // dizê-lo como facto, sem o «não sei se» à frente.
      expect(textoDe(chave), chave).not.toMatch(
        /não guardei|(?<!não sei se )ficou guardado\.|(?<!não sei se )foi guardado\./i,
      );
    }
  });

  it("«sem resposta» ao duplicar não diz «Não consegui duplicar» (o servidor pode ter gravado)", () => {
    expect(TEXTOS.duplicarSemSaber).not.toMatch(/^Não consegui duplicar/);
    expect(TEXTOS.duplicarServidor).toMatch(/duplicar/);
  });

  it("as duas frases de «data passada» dizem coisas diferentes: a do rascunho condiciona («Se publicares»), a do publicado afirma", () => {
    expect(TEXTOS.dataPassadaRascunho).not.toBe(TEXTOS.dataPassada);
    expect(TEXTOS.dataPassadaRascunho).toMatch(/Se publicares/);
    expect(TEXTOS.dataPassada).not.toMatch(/Se publicares/);
    for (const frase_ of [TEXTOS.dataPassada, TEXTOS.dataPassadaRascunho]) {
      expect(frase_).toMatch(/arquivo/);
      expect(frase_).toMatch(/não aparece no site/);
    }
  });

  it("os avisos de publicar e de guardar lembram que o site pode levar um minuto, e o de «sem lugar» não", () => {
    expect(TEXTOS.eventoPublicadoNoSite).toMatch(/minuto/);
    expect(TEXTOS.eventoAtualizado).toMatch(/minuto/);
    expect(frase("publicadoNoSite", "X")).toMatch(/minuto/);
    expect(frase("despublicadoDoSite", "X")).toMatch(/minuto/);
    expect(TEXTOS.eventoEliminadoNoSite).toMatch(/minuto/);
    expect(TEXTOS.rascunhoGuardado).not.toMatch(/minuto/);
  });
});

describe("português de Portugal", () => {
  // «caractere» é do Brasil; «caracteres» (o plural de «carácter») é o nosso e tem de passar.
  const PROIBIDAS =
    /\b(deletar|deleta|cardápio|você|vocês|usuário|tela|celular|arquivar|arquive|salvar|salve|clique|baixar|caractere)\b/i;

  it("nenhuma frase tem uma palavra de outro português; «carácter», nunca «caractere»", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(PROIBIDAS);
  });

  it("o contador diz «carácter» (PT-PT)", () => {
    expect(frase("contadorFaltam", 100)).toMatch(/carácter|caracteres/);
    expect(TEXTOS.contadorUm).toMatch(/carácter/);
    expect(TEXTOS.erroTituloLongo).toMatch(/caracteres/);
  });

  it("sem emojis, sem setas e com «…» e nunca «...»", () => {
    for (const f of todasAsFrases()) {
      expect(f).not.toMatch(/\p{Extended_Pictographic}|→|←|↑|↓|\.\.\./u);
    }
    expect(TEXTOS.aGuardar).toContain("…");
    expect(TEXTOS.aEliminar).toContain("…");
    expect(TEXTOS.aTentar).toContain("…");
  });

  it("nunca a `mensagem` do backend nem uma frase a desculpar-se pelo desenho antigo", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(/mensagem do backend|genérica/i);
  });

  it("não há frase de um evento «atualizado e despublicado» (editar nunca despublica)", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(/atualizado e despublicado/i);
  });
});
