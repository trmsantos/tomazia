/**
 * O contrato do cabeçalho fixo e da Folha do WiFi, num sítio só (F3-03).
 *
 * Mesma função que `src/testes/ementa.ts` tem para a F3-02, e pela mesma
 * razão: os dois lados precisam disto. Os testes Vitest desenham os
 * componentes com estas leituras do `/info`; os testes Playwright fingem
 * `GET /api/info` com o mesmo payload. Duas cópias da mesma fixtura acabam a
 * divergir, e a que divergir passa a provar outra coisa sem ninguém dar por
 * isso.
 *
 * **A fixtura é tipada como `Info`**, o tipo gerado a partir do OpenAPI do
 * backend. No dia em que o contrato mudar, isto parte a compilação em vez de
 * continuar verde contra uma forma que já não existe.
 *
 * Os dados são falsos e é propositado que se note (regra 1 do `CLAUDE.md`):
 * nada aqui afirma seja o que for sobre a rede, a morada ou o telefone do bar
 * a sério.
 */
import type { Info } from "../lib/api/publico";

/** O `<h1>`, que a F3-03 leva do `App.tsx` para dentro do `<header>`. */
export { NOME_DO_BAR } from "./ementa";

/**
 * Todo o texto visível da secção 10 de `docs/ecras/F3-03.md`, palavra por
 * palavra.
 *
 * Escrito aqui para que a mudança de uma frase seja uma linha, e para o
 * dominio-bar poder validar a tabela inteira numa leitura.
 */
export const TEXTOS_DO_WIFI = {
  saltar: "Saltar para a ementa",
  wifi: "WiFi",
  fechar: "Fechar",
  rede: "Rede",
  password: "Password",
  perguntaNoBalcao: "Pergunta no balcão.",
  copiar: "Copiar password",
  copiou: "Password copiada.",
  naoCopiou: "Não consegui copiar. A password está aqui em cima.",
} as const;

/**
 * O destino da ligação de salto (5.2).
 *
 * **Não é `ementa`** — a barra de chips vive dentro dessa secção, e um salto
 * para lá deixava as doze paragens onde estavam. **Não é `ementa-conteudo`**
 * — o prefixo `ementa-` é o das âncoras das categorias, que saem de um `slug`
 * que o dono vai poder editar (F4-02).
 */
export const ID_DO_DESTINO_DO_SALTO = "lista-da-ementa";

/** Seletor do destino, para quem conta quantos elementos o têm. */
export const SELETOR_DO_DESTINO = `#${ID_DO_DESTINO_DO_SALTO}`;

/**
 * `id` do elemento que mostra a password.
 *
 * Existe pela mesma razão que o `ID_DA_BARRA` da F3-02: há asserções que
 * medem **aquele** elemento — o tamanho de letra, o `user-select`, a quebra
 * de linha — e chegar-lhe pelo texto não serve, porque a password de teste
 * acaba num espaço e os localizadores normalizam o espaço antes de comparar.
 * Procurá-la pelo texto daria "não encontrei" com a password certa no ecrã.
 */
export const ID_DA_PASSWORD = "password-do-wifi";

/** Uma rede falsa, com o ar de uma rede de bar. */
export const REDE_DE_TESTE = "tomazia-exemplo";

/**
 * Uma password falsa **com um espaço no fim**, de propósito.
 *
 * O critério S-09 diz que a API devolve o valor tal como o dono o gravou, sem
 * aparar. Um espaço no fim não se vê no ecrã e vai inteiro para a área de
 * transferência — é esse o caractere que separa "copiou a password" de
 * "copiou uma password parecida". Está aqui para que a asserção da cópia seja
 * caractere a caractere e não "parece bem".
 */
export const PASSWORD_DE_TESTE = "cerveja-fresca-2026 ";

/** O resto do payload do `/info`, que a F3-06 vai usar e esta tarefa não. */
const RESTO_DO_INFO = {
  horario: null,
  instagram: "barexemplo",
  maps_url: "https://exemplo.test/mapa",
  morada: "Rua de Exemplo, 12, Estarreja",
  telefone: "912345678",
} satisfies Omit<Info, "wifi">;

/** Rede e password configuradas: a Folha mostra a password grande. */
export const INFO_COM_WIFI: Info = {
  ...RESTO_DO_INFO,
  wifi: { rede: REDE_DE_TESTE, password: PASSWORD_DE_TESTE },
};

/** Rede gravada, password por gravar. "Pergunta no balcão." (6.2). */
export const INFO_SEM_PASSWORD: Info = {
  ...RESTO_DO_INFO,
  wifi: { rede: REDE_DE_TESTE, password: null },
};

/**
 * Nenhuma das duas chaves — **o estado de hoje em desenvolvimento** (6.2).
 * `null` quer dizer "nunca configurado", nunca "este bar não tem WiFi".
 */
export const INFO_SEM_REDE: Info = {
  ...RESTO_DO_INFO,
  wifi: { rede: null, password: null },
};

/**
 * As três leituras do `/info` que o `App.tsx` tem de manter distintas (6.5).
 *
 * Desenham-se em dois ecrãs, e isso é uma decisão de desenho. Reescrever uma
 * como a outra — o `.catch(() => setInfo({ wifi: { rede: null … } }))` que a
 * secção 6.5 escreve à vista como proibido — é um defeito, e é o que a F3-06
 * paga quando o horário e a morada passarem a ter desenhos diferentes.
 */
export type EstadoDoInfo =
  { estado: "a-carregar" } | { estado: "pronto"; info: Info } | { estado: "falhou" };

export const A_CARREGAR: EstadoDoInfo = { estado: "a-carregar" };
export const FALHOU: EstadoDoInfo = { estado: "falhou" };

/** Atalho: uma leitura pronta com este payload. */
export function pronto(info: Info): EstadoDoInfo {
  return { estado: "pronto", info };
}

/**
 * As cinco linhas da tabela de 6.2, pela mesma ordem.
 *
 * O cabeçalho tem de ser o mesmo nas cinco — é isso que faz dele um ecrã sem
 * estados, em que nada aparece, desaparece ou salta depois da primeira
 * pintura.
 */
export const CINCO_LEITURAS: { nome: string; info: EstadoDoInfo }[] = [
  { nome: "rede e password", info: pronto(INFO_COM_WIFI) },
  { nome: "rede sem password", info: pronto(INFO_SEM_PASSWORD) },
  { nome: "sem rede", info: pronto(INFO_SEM_REDE) },
  { nome: "o pedido falhou", info: FALHOU },
  { nome: "ainda não respondeu", info: A_CARREGAR },
];

/**
 * As três leituras que desenham "Pergunta no balcão." e mais nada (7.3).
 *
 * "ainda não respondeu" **não** está aqui, e é o ponto: é o único estado em
 * que o passo seguinte da pessoa não é ir ao balcão (6.4).
 */
export const LEITURAS_QUE_MANDAM_AO_BALCAO: { nome: string; info: EstadoDoInfo }[] = [
  { nome: "rede sem password", info: pronto(INFO_SEM_PASSWORD) },
  { nome: "sem rede", info: pronto(INFO_SEM_REDE) },
  { nome: "o pedido falhou", info: FALHOU },
];

/**
 * O que o site **nunca** diz, em estado nenhum (10, nota 5).
 *
 * Uma afirmação sobre o negócio só o dono a pode fazer. "Pergunta no balcão."
 * manda a pessoa a quem sabe; qualquer uma destas afirmava por ela. A
 * asserção é pela negativa porque é o único feitio que uma frase que não
 * existe pode ter.
 */
export const FRASES_QUE_O_SITE_NAO_DIZ = [
  /n[ãa]o (h[áa]|tem|temos)\s+wifi/i,
  /sem\s+wifi/i,
  /rede\s+aberta/i,
  /sem\s+password/i,
  /n[ãa]o\s+(h[áa]|tem|temos)\s+rede/i,
];

/** O que o teste observou da área de transferência falsa. */
export type AreaDeTransferenciaFalsa = {
  /** Tudo o que foi escrito, por ordem, sem aparar nada. */
  escrito: string[];
  restaurar(): void;
};

/**
 * Uma `navigator.clipboard` que aceita, que recusa, ou que não existe.
 *
 * **Ponto de extensão, não código de produção** — mesma família do
 * `dialogo-jsdom.ts`. O jsdom 30 não implementa `navigator.clipboard` de todo
 * (medido: a propriedade não existe nem no objeto nem no protótipo), por isso
 * sem isto os três caminhos de 8.1 não se podem exercitar: o do "não há API"
 * seria o único que acontecia, e os outros dois nunca.
 *
 * O que isto **não** faz: não guarda nada, não lê, e não simula permissões.
 * O que a pessoa vê quando cola é do browser; o que se prova aqui é o que o
 * ecrã diz e o que foi entregue à API — caractere a caractere.
 *
 * `"ausente"` não define propriedade nenhuma, e **falha se já lá houver uma**:
 * um ambiente que ganhasse `clipboard` punha este cenário a testar o caminho
 * errado em silêncio, que é a regra 10 noutra roupagem.
 */
export function instalarAreaDeTransferencia(
  comportamento: "aceita" | "recusa" | "ausente",
): AreaDeTransferenciaFalsa {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const escrito: string[] = [];

  const restaurar = (): void => {
    if (original === undefined) {
      delete (navigator as { clipboard?: unknown }).clipboard;
      return;
    }
    Object.defineProperty(navigator, "clipboard", original);
  };

  if (comportamento === "ausente") {
    if (navigator.clipboard !== undefined) {
      throw new Error(
        "o ambiente já tem `navigator.clipboard`: o cenário «ausente» não estaria a " +
          "testar o caminho sem API. Isto é uma falha de ambiente, não do ecrã.",
      );
    }
    return { escrito, restaurar };
  }

  const escrever = (texto: string): Promise<void> => {
    if (comportamento === "recusa") {
      return Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
    }
    escrito.push(texto);
    return Promise.resolve();
  };

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: escrever },
  });

  return { escrito, restaurar };
}
