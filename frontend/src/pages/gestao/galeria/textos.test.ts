/**
 * F4-04, plano 7.1 e spec 15 — a tabela `TEXTOS` de `textos.ts` (a do dominio-bar, validada em
 * 2026-11-19).
 *
 * Os testes de componente prendem-se a `TEXTOS` e nunca a frases escritas à mão, para uma mudança
 * de frase não reescrever testes. **Isto é o contrato de nomes**: cada chave que os testes usam
 * tem de existir, e **aqui** escreve-se cada uma por extenso, tal como a secção 15 da spec a
 * validou — o único sítio onde os testes duvidam do `TEXTOS` em vez de o seguir. Sem esta tabela,
 * trocar uma frase validada por outra passava todos os testes.
 *
 * Contrato (`src/pages/gestao/galeria/textos.ts`):
 *
 * ```ts
 * export const TEXTOS: { …chaves de texto… ; fotosAEsperaN(n); enviadaEm(quando); porNome(nome) };
 * export function altDaFoto(foto: FotoPendente, agora: Date): string;   // «Foto enviada {quando}»
 * export const DESTINO_POR_CODIGO: Record<string, "foto" | "legenda" | "geral">;
 * ```
 *
 * `DESTINO_POR_CODIGO` é a **cópia** do mapa da F3-05 (o público não importa da gestão nem o
 * contrário): diz onde cada erro do `POST /fotos` aparece (spec 7.5). Sem «nome» (a folha do dono
 * não tem esse campo).
 *
 * `altDaFoto` junta «Foto enviada » ao `quandoFoiEnviada(criada_em, agora)`: **nunca a legenda**
 * (texto de terceiros, não verificado) **nem o nome**.
 */
import { describe, expect, it } from "vitest";

import { fotoPendenteDeTeste, LEGENDA_DE_255 } from "../../../testes/gestao";
import { quandoFoiEnviada } from "./quando-foi-enviada";
import * as modulo from "./textos";
import { DESTINO_POR_CODIGO, TEXTOS, altDaFoto } from "./textos";

/** Cada chave e a frase **tal como a spec 15 a escreve**. */
const VALIDADOS: ReadonlyArray<readonly [string, string]> = [
  ["titulo", "Galeria"],
  ["enviarFoto", "Enviar foto"],
  ["fotosAEspera", "Fotos à espera"],
  ["aprovar", "Aprovar"],
  ["rejeitar", "Rejeitar"],
  ["aAprovar", "A aprovar…"],
  ["aRejeitar", "A rejeitar…"],
  ["legendaNoSite", "Legenda no site"],
  ["avisoAprovada", "Foto aprovada. Já aparece no site."],
  ["avisoRejeitada", "Foto rejeitada."],
  ["vazioTitulo", "Não há fotos à espera."],
  ["vazioLinha", "Quando um cliente enviar uma, aparece aqui."],
  ["carregarTitulo", "Não consegui carregar as fotos."],
  ["carregarSemResposta", "Verifica a ligação e tenta outra vez."],
  ["carregarServidor", "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco."],
  ["tentarOutraVez", "Tentar outra vez"],
  ["aTentar", "A tentar…"],
  ["tituloRejeitar", "Tem a certeza?"],
  ["rejeitarAviso", "A foto é apagada e não aparece no site. Não se pode desfazer."],
  ["cancelar", "Cancelar"],
  [
    "rejeitarServidor",
    "Não consegui rejeitar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  ],
  [
    "aprovarServidor",
    "Não consegui aprovar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  ],
  ["verificarAprovada", "Não consegui confirmar se a foto ficou aprovada. A verificar…"],
  ["verificarRejeitada", "Não consegui confirmar se a foto ficou rejeitada. A verificar…"],
  ["continuaAprovar", "Não consegui aprovar. Verifica a ligação e tenta outra vez."],
  ["continuaRejeitar", "Não consegui rejeitar. Verifica a ligação e tenta outra vez."],
  [
    "semConfirmarAprovada",
    "Não consegui confirmar se a foto ficou aprovada. Verifica a ligação e toca em Verificar outra vez.",
  ],
  [
    "semConfirmarRejeitada",
    "Não consegui confirmar se a foto ficou rejeitada. Verifica a ligação e toca em Verificar outra vez.",
  ],
  ["verificarOutraVez", "Verificar outra vez"],
  ["outroAparelhoRejeitada", "A foto anterior já tinha sido rejeitada noutro aparelho."],
  ["outroAparelhoAprovada", "A foto anterior já tinha sido aprovada noutro aparelho."],
  ["jaNaoExistia", "A foto anterior já não existia."],
  ["aVerificarFoto", "A verificar a foto…"],
  ["fotoSemLigacao", "Não consegui mostrar esta foto. Verifica a ligação."],
  ["fotoNaoSeMostra", "Esta foto não se consegue mostrar. Só a podes rejeitar."],
  ["fotoNaoSeMostraNaFolha", "Esta foto não se consegue mostrar."],
  ["jaModerada", "A foto anterior já tinha sido aprovada ou rejeitada."],
  ["tituloEnviar", "Enviar foto"],
  ["promessaEnviar", "A foto entra na fila e só aparece no site depois de a aprovares."],
  ["etiquetaFoto", "Foto"],
  ["etiquetaLegenda", "Legenda (opcional)"],
  ["ajudaLegenda", "Aparece no site, junto da foto."],
  ["enviar", "Enviar foto"],
  ["aEnviar", "A enviar…"],
  ["aPreparar", "A preparar a foto…"],
  ["demoraUmPouco", "Pode demorar um pouco em fotos grandes."],
  ["falhaAPreparar", "Não consegui preparar esta foto. Tenta outra, ou tira uma fotografia nova."],
  ["semEscolha", "Escolhe uma foto para enviar."],
  ["fotoEnviada", "Foto enviada. Está na fila para aprovares."],
  [
    "envioSemSaber",
    "Não sei se a foto foi enviada. Atualizei a fila: vê se já lá está antes de tentar outra vez.",
  ],
  [
    "envioServidor",
    "Não consegui enviar a foto. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  ],
  ["saidaTitulo", "Ainda não enviaste a foto."],
  ["saidaLinha", "Se saíres agora, a foto e a legenda perdem-se."],
  ["saidaSair", "Sair sem enviar"],
  ["saidaContinuar", "Continuar"],
];

type Tabela = Record<string, unknown>;
const T = TEXTOS as unknown as Tabela;

function textoDe(chave: string): string {
  const v = T[chave];
  if (typeof v !== "string") throw new Error(`TEXTOS.${chave} não é um texto`);
  return v;
}
function funcao(chave: string, ...args: unknown[]): string {
  const f = T[chave];
  if (typeof f !== "function") throw new Error(`TEXTOS.${chave} não é uma função`);
  return (f as (...a: unknown[]) => string)(...args);
}

function todasAsFrases(): string[] {
  return [
    ...VALIDADOS.map(([chave]) => textoDe(chave)),
    funcao("fotosAEsperaN", 1),
    funcao("fotosAEsperaN", 12),
    funcao("enviadaEm", "hoje, às 23:40"),
    funcao("porNome", "Rita"),
    altDaFoto(
      fotoPendenteDeTeste({ id: 1, descricao: "Legenda", enviada_por: "Rita" }),
      new Date("2026-11-02T10:00:00Z"),
    ),
  ];
}

describe("a tabela existe, está completa e diz o que a spec 15 validou", () => {
  it.each(VALIDADOS)("TEXTOS.%s", (chave, frase) => {
    expect(textoDe(chave)).toBe(frase);
  });

  it("o módulo exporta `TEXTOS`, `altDaFoto` e `DESTINO_POR_CODIGO`", () => {
    expect(modulo.TEXTOS).toBeDefined();
    expect(typeof modulo.altDaFoto).toBe("function");
    expect(modulo.DESTINO_POR_CODIGO).toBeDefined();
  });

  it("as frases com buracos escrevem o que a spec escreve", () => {
    expect(funcao("fotosAEsperaN", 3)).toBe("Fotos à espera (3)");
    expect(funcao("fotosAEsperaN", 1)).toBe("Fotos à espera (1)");
    expect(funcao("enviadaEm", "hoje, às 23:40")).toBe("Enviada hoje, às 23:40");
    expect(funcao("porNome", "Rita")).toBe(", por Rita");
    expect(
      funcao("enviadaEm", "ontem, à 01:10") + funcao("porNome", "Rita"),
      "a linha: «Enviada {quando}» + «, por {nome}»",
    ).toBe("Enviada ontem, à 01:10, por Rita");
  });

  it("nenhuma frase tem «undefined», «null», «NaN» nem chavetas por preencher", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(/undefined|\bnull\b|NaN|\{|\}/);
  });
});

describe("altDaFoto: «Foto enviada {quando}», nunca a legenda nem o nome (spec 4.1 e 4.3)", () => {
  const AGORA = new Date("2026-11-02T10:00:00Z");

  it("«Foto enviada hoje, às 23:40» — uma só fonte para a data", () => {
    const foto = fotoPendenteDeTeste({ id: 1, criada_em: "2026-11-02T09:15:00Z" });
    expect(altDaFoto(foto, AGORA)).toBe("Foto enviada hoje, às 09:15");
    expect(altDaFoto(foto, AGORA)).toBe(`Foto enviada ${quandoFoiEnviada(foto.criada_em, AGORA)}`);
  });

  it.each([
    ["uma legenda com `&`, apóstrofo e emoji", "Noite de samba 🎶 & amigos d'a casa"],
    ["uma legenda de 255 carateres sem espaços", LEGENDA_DE_255],
    ["uma legenda que parece uma descrição da imagem", "Foto de um gato preto a dormir num sofá"],
    ["uma legenda com HTML", '<img src=x onerror="alert(1)">'],
  ])("com %s: o `alt` não a contém", (_nome, descricao) => {
    const foto = fotoPendenteDeTeste({ id: 1, descricao, enviada_por: "Rita" });
    const alt = altDaFoto(foto, AGORA);
    expect(alt).not.toContain(descricao);
    expect(alt).not.toContain(descricao.slice(0, 12));
    expect(alt, "nem o nome de quem enviou").not.toContain("Rita");
    expect(alt.startsWith("Foto enviada ")).toBe(true);
  });

  it("com e sem legenda o `alt` é o mesmo (não depende do texto do cliente)", () => {
    const com = fotoPendenteDeTeste({ id: 1, descricao: "Olá", enviada_por: "Rita" });
    const sem = fotoPendenteDeTeste({ id: 1, descricao: null, enviada_por: null });
    expect(altDaFoto(com, AGORA)).toBe(altDaFoto(sem, AGORA));
  });

  it("nunca leva o `ficheiro` nem o `id`", () => {
    const foto = fotoPendenteDeTeste({ id: 4242, ficheiro: "segredo-4242.webp" });
    const alt = altDaFoto(foto, AGORA);
    expect(alt).not.toContain("4242");
    expect(alt).not.toContain("segredo");
  });
});

describe("DESTINO_POR_CODIGO: onde aparece cada erro do POST /fotos (spec 7.5)", () => {
  it("os sete códigos e o seu destino — sem «nome» (a folha do dono não tem esse campo)", () => {
    expect({ ...(DESTINO_POR_CODIGO as Record<string, string>) }).toEqual({
      imagem_invalida: "foto",
      imagem_demasiado_grande: "foto",
      ficheiro_grande_demais: "foto",
      descricao_grande_demais: "legenda",
      dados_invalidos: "geral",
      tamanho_do_pedido_em_falta: "geral",
      limite_de_envios_excedido: "geral",
    });
  });
});

describe("regra 10: o que é diferente diz-se diferente", () => {
  const diferentes: ReadonlyArray<readonly [string, string]> = [
    ["vazioTitulo", "carregarTitulo"],
    ["vazioLinha", "carregarSemResposta"],
    ["carregarSemResposta", "carregarServidor"],
    ["verificarAprovada", "verificarRejeitada"],
    ["verificarAprovada", "continuaAprovar"],
    ["verificarAprovada", "semConfirmarAprovada"],
    ["continuaAprovar", "aprovarServidor"],
    ["continuaRejeitar", "rejeitarServidor"],
    ["semConfirmarAprovada", "semConfirmarRejeitada"],
    ["outroAparelhoAprovada", "outroAparelhoRejeitada"],
    ["fotoNaoSeMostra", "fotoSemLigacao"],
    ["fotoNaoSeMostra", "fotoNaoSeMostraNaFolha"],
    ["jaModerada", "jaNaoExistia"],
    ["fotoEnviada", "envioSemSaber"],
    ["envioSemSaber", "envioServidor"],
    ["avisoAprovada", "avisoRejeitada"],
  ];
  it.each(diferentes)("TEXTOS.%s ≠ TEXTOS.%s", (a, b) => {
    expect(textoDe(a)).not.toBe(textoDe(b));
  });

  it("sem resposta nunca diz «aprovada», «rejeitada» nem «enviada» como facto", () => {
    // «Não consegui confirmar se a foto ficou aprovada.» diz que não se sabe; o que se proíbe é
    // dizê-lo como facto, sem o «se» à frente.
    for (const chave of [
      "verificarAprovada",
      "verificarRejeitada",
      "semConfirmarAprovada",
      "semConfirmarRejeitada",
    ]) {
      expect(textoDe(chave), chave).toMatch(/Não consegui confirmar se a foto ficou/);
    }
    expect(textoDe("envioSemSaber")).toMatch(/^Não sei se a foto foi enviada\./);
    expect(textoDe("envioSemSaber")).not.toMatch(/^Foto enviada/);
  });

  it("um erro do servidor ao moderar nunca diz «não foi aprovada»: pode ter agido (spec 9.6)", () => {
    for (const chave of ["aprovarServidor", "rejeitarServidor"]) {
      expect(textoDe(chave)).not.toMatch(/não foi (aprovada|rejeitada)/i);
    }
  });

  it("o aviso de aprovar começa por «Foto aprovada» (o «Feito quando» da tarefa)", () => {
    expect(TEXTOS.avisoAprovada.startsWith("Foto aprovada")).toBe(true);
    expect(TEXTOS.avisoRejeitada.startsWith("Foto rejeitada")).toBe(true);
  });
});

describe("português de Portugal", () => {
  const PROIBIDAS =
    /\b(deletar|deleta|cardápio|você|vocês|usuário|tela|celular|arquivo|arquivar|arquive|salvar|salve|clique|baixar|caractere)\b/i;

  it("nenhuma frase tem uma palavra de outro português", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(PROIBIDAS);
  });

  it("sem emojis, sem setas e com «…» e nunca «...»", () => {
    for (const f of todasAsFrases()) {
      // O emoji da legenda de teste nunca chega aqui: só as frases da tabela.
      expect(f).not.toMatch(/\p{Extended_Pictographic}|→|←|↑|↓|\.\.\./u);
    }
    for (const chave of [
      "aAprovar",
      "aRejeitar",
      "aTentar",
      "aEnviar",
      "aPreparar",
      "aVerificarFoto",
    ]) {
      expect(textoDe(chave), chave).toContain("…");
    }
  });

  it("«Tem a certeza?» é a única frase formal: o resto fala por «tu»", () => {
    expect(TEXTOS.tituloRejeitar).toBe("Tem a certeza?");
    for (const f of todasAsFrases()) expect(f).not.toMatch(/\b(você|deseja|pretende|queira)\b/i);
  });

  it("maiúscula só no início: nenhuma etiqueta em maiúsculas", () => {
    for (const f of todasAsFrases()) expect(f).not.toMatch(/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,}\b/);
  });
});
