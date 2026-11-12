/**
 * As fotos de teste e o texto visível da secção (F3-05).
 *
 * Mesma razão de ser que `src/testes/eventos.ts`: os testes Vitest (um
 * cliente falso) e os testes Playwright (`page.route`) precisam da mesma
 * fixtura, e duas cópias acabam por divergir sem ninguém dar por isso.
 *
 * **Tipada como `Galeria`**, o tipo gerado a partir do OpenAPI do backend —
 * `{id, ficheiro, descricao}`, sem largura nem altura (F3-05, secção 4.2) e
 * sem `enviada_por` (que nunca chega ao `GET /galeria` público, secção 6.3).
 * No dia em que o contrato mudar, isto parte a compilação em vez de
 * continuar verde contra uma forma que já não existe.
 *
 * Nomes de ficheiro no formato real (`uuid4().hex` + `.webp`, ver
 * `backend/app/services/fotos.py`), mas falsos — nenhum destes ficheiros
 * existe em `media/`.
 */
import type { Galeria } from "../lib/api/publico";

/** Uma foto da resposta pública, sem repetir o caminho do tipo gerado. */
export type FotoPublica = Galeria["fotos"][number];

/**
 * Todo o texto fixo da secção 13 da especificação, literal — o `dominio-bar`
 * lê esta tabela para validar o ecrã, e um ficheiro de teste que a
 * reescrevesse por concatenação deixava de ser o que ele validou.
 *
 * As três frases com um número lá dentro (o tempo do `429`, "Foto {n} de
 * {m}.") têm função própria, abaixo, porque dependem de um valor que só se
 * sabe em tempo de execução.
 */
export const TEXTOS_DA_GALERIA = {
  titulo: "Galeria",
  enviarUmaFoto: "Enviar uma foto",
  vazioTitulo: "Ainda não há fotos.",
  vazioLinha: "Sê o primeiro a mostrar uma noite no bar.",
  erroTitulo: "Não consegui carregar a galeria.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  aTentar: "A tentar…",
  verMaisFotos: "Ver mais fotos",
  altSemLegenda: "Fotografia do bar enviada por um cliente.",
  fecharVisualizador: "Fechar",
  fotoAnterior: "Foto anterior",
  fotoSeguinte: "Foto seguinte",
  tentarOutraVez: "Tentar outra vez",

  folhaTitulo: "Enviar uma foto",
  promessa: "A tua foto aparece depois de aprovada.",
  campoFoto: "Foto (obrigatório)",
  semEscolha: "Escolhe uma foto para enviar.",
  aPreparar: "A preparar a foto…",
  avisoDemora: "Pode demorar um pouco em fotos grandes.",
  falhaAPreparar: "Não consegui preparar esta foto. Tenta outra, ou tira uma fotografia nova.",
  trocarFoto: "Trocar foto",
  campoLegenda: "Legenda (opcional)",
  campoNome: "O teu nome (opcional)",
  notaDoNome: "Fica só para o dono — não aparece no site.",
  enviarFoto: "Enviar foto",
  aEnviar: "A enviar…",

  erroImagemInvalida:
    "Não consegui usar esta fotografia. Tenta enviá-la outra vez ou escolhe outra foto.",
  erroImagemDemasiadoGrande: "Esta foto é demasiado grande para o site. Tenta outra foto.",
  erroFicheiroGrandeDemais: "O ficheiro é demasiado grande. O limite é de 8 MB. Tenta outra foto.",
  erroDescricaoGrandeDemais:
    "Essa legenda é demasiado longa (até 255 carateres). Tenta encurtá-la.",
  erroEnviadaPorGrandeDemais: "Esse nome é demasiado longo (até 60 carateres). Tenta encurtá-lo.",
  erroDadosInvalidos: "Os dados enviados não são válidos. Verifica os campos e tenta novamente.",
  erroTamanhoEmFalta: "Não consegui perceber o tamanho deste envio. Tenta enviar a foto outra vez.",
  erroLimiteDeEnvios: "Já chegaste ao limite de 5 fotos nesta hora. Tenta outra vez daqui a pouco.",
  erroLimiteSuavizacao:
    "Numa noite cheia, este limite é partilhado por todos os que estão no WiFi do bar — " +
    "pode não ter sido só esta foto a gastá-lo.",
  erroSemRespostaAoEnviar: "Não consegui enviar a foto. Verifica a ligação e tenta outra vez.",
  erroServidorAoEnviar:
    "Não consegui enviar a foto. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  sucessoTitulo: "Foto enviada.",
  sucessoBotao: "Enviar outra foto",
} as const;

/** "Foto {n} de {m}." — a linha de posição do Visualizador (5.3). */
export function posicao(n: number, m: number): string {
  return `Foto ${String(n)} de ${String(m)}.`;
}

/**
 * A frase «Podes tentar outra vez daqui a…», reexportada do módulo partilhado
 * (`src/lib/formato/tempo-em-falta.ts`) e não reimplementada aqui: as duas
 * versões já tinham divergido na fronteira dos 60–119 s. Desde a F4-01 a
 * regra é arredondar sempre para cima acima dos 60 s.
 */
export { tempoComposto as tempoDeEspera } from "../lib/formato/tempo-em-falta";

export const ID_DA_SECCAO = "galeria";
export const ID_DO_TITULO = "titulo-galeria";

/** Um ficheiro no formato real: `uuid4().hex` + `.webp`. Nunca existe de verdade. */
function nomeDeFicheiro(semente: number): string {
  return `${semente.toString(16).padStart(8, "0")}cafebabedeadbeef0123456789abcdef.webp`;
}

/** Uma foto, com o mínimo escrito à mão. `descricao` a `null` por omissão. */
export function foto(campos: Partial<FotoPublica> & { id: number }): FotoPublica {
  return {
    ficheiro: nomeDeFicheiro(campos.id),
    descricao: null,
    ...campos,
  };
}

/** O corpo de `GET /galeria` à volta de uma lista. */
export function resposta(fotos: FotoPublica[]): Galeria {
  return { fotos };
}

/** Com legenda — é a que aparece no Visualizador, por baixo da foto (5.3). */
export const FOTO_COM_LEGENDA = foto({
  id: 1,
  descricao: "Noite de samba de quinta-feira, mesa cheia.",
});

/** Sem legenda — o `alt` genérico tem de aparecer (5.4). */
export const FOTO_SEM_LEGENDA = foto({ id: 2 });

/** Nada aprovado ainda: o estado de lançamento (4.3), não um caso de borda. */
export const SEM_FOTOS = resposta([]);

/** Uma só: a grelha existe e "Enviar uma foto" aparece no topo (6.1). */
export const UMA_FOTO = resposta([FOTO_COM_LEGENDA]);

/** Exatamente seis: a grelha inteira, e **sem** "Ver mais fotos" (4.6). */
export const SEIS_FOTOS = resposta(
  Array.from({ length: 6 }, (_valor, indice) => foto({ id: indice + 1 })),
);

/** Sete: seis na grelha e "Ver mais fotos" revela a sétima (4.6). */
export const SETE_FOTOS = resposta(
  Array.from({ length: 7 }, (_valor, indice) => foto({ id: indice + 1 })),
);
