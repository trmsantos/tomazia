import { useState } from "react";
import type { ReactElement } from "react";

import { Botao } from "../../components/ui/Botao";
import { Folha } from "../../components/ui/Folha";
import type { EstadoDoInfo } from "./Cabecalho";

/**
 * A Folha do WiFi (`docs/ecras/F3-03.md`, secções 7 e 8).
 *
 * Uma de três coisas lá dentro, e a escolha é do estado do `/info` que lhe
 * desce por propriedade:
 *
 *  - **a carregar:** as duas etiquetas com os valores em forma de bloco e
 *    `aria-busy`. É o único dos cinco estados que **não** manda ninguém ao
 *    balcão, e a razão é estreita: aqui o passo seguinte da pessoa é esperar
 *    meio segundo, e nós sabemos disso (6.4);
 *  - **rede e password:** a escada de 14 → 21 → 34, o "Copiar password" e a
 *    linha viva por baixo dele;
 *  - **tudo o resto** — sem rede, sem password, ou o pedido falhado: a frase
 *    "Pergunta no balcão." e mais nada (7.3).
 *
 * Os três últimos desenham-se iguais porque dão a mesma informação útil e
 * porque o passo seguinte da pessoa é o mesmo nos três. **No `App.tsx` eles
 * continuam a ser três**: desenhá-los igual é uma decisão de desenho,
 * reescrever um como o outro é um defeito, e a F3-06 herda-os separados
 * (6.5).
 *
 * Em estado nenhum esta Folha afirma que o bar não tem WiFi. `null` é "não
 * sei", e uma afirmação sobre o negócio só o dono a pode fazer (10, nota 5).
 */

/** Secção 10, palavra por palavra. */
const TEXTOS = {
  wifi: "WiFi",
  rede: "Rede",
  password: "Password",
  perguntaNoBalcao: "Pergunta no balcão.",
  copiar: "Copiar password",
  copiou: "Password copiada.",
  naoCopiou: "Não consegui copiar. A password está aqui em cima.",
} as const;

/**
 * `id` do elemento da password.
 *
 * Existe pela mesma razão que o da barra de chips da F3-02: há asserções que
 * medem **aquele** elemento — o tamanho de letra, o `user-select`, a quebra —
 * e chegar-lhe pelo texto não serve, porque a password pode acabar num espaço
 * e os localizadores normalizam o espaço antes de comparar (7.2).
 */
export const ID_DA_PASSWORD = "password-do-wifi";

/** O que a linha viva diz, e com que cor. `null` é a linha vazia. */
type Resultado = { tipo: "copiou" | "falhou"; vez: number };

/**
 * A área de transferência, **lida pelo valor** e não por `"clipboard" in
 * navigator`.
 *
 * O teste do `in` responde "sim" a uma propriedade que exista e valha
 * `undefined`, e aí o botão aparecia para morrer no primeiro toque. O que
 * decide se a ação se oferece é haver mesmo com que a fazer (8.1).
 *
 * O tipo do DOM declara `navigator.clipboard` como sempre presente — não
 * está: fora de contexto seguro a propriedade não existe de todo. O
 * alargamento aqui é o que permite perguntar sem o TypeScript garantir uma
 * resposta que o browser não dá.
 */
function areaDeTransferencia(): Clipboard | undefined {
  return (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
}

/**
 * Uma das duas etiquetas, 14 px e suave.
 *
 * A escada de três tamanhos (14 → 21 → 34) é a hierarquia de 7.1: a rede
 * procura-se numa lista, a password escreve-se num teclado à distância de um
 * braço, no escuro.
 */
function Etiqueta({ children }: { children: string }): ReactElement {
  return <p className="text-nota text-texto-suave">{children}</p>;
}

/**
 * O esqueleto de 6.4 — a forma do que vem a seguir, em fio interno.
 *
 * As larguras são frações e não passos da escala de espaçamento, pela mesma
 * razão que as do esqueleto da ementa: a 32 e a 48 px não leriam como espera,
 * leriam como avaria.
 */
function Esqueleto(): ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <div>
        <Etiqueta>{TEXTOS.rede}</Etiqueta>
        <div className="mt-1 h-6 w-1/2 rounded-pequeno bg-fio-interno" />
      </div>
      <div>
        <Etiqueta>{TEXTOS.password}</Etiqueta>
        <div className="mt-1 h-8 w-3/4 rounded-pequeno bg-fio-interno" />
      </div>
    </div>
  );
}

export type PropriedadesDaFolhaWifi = {
  aberta: boolean;
  info: EstadoDoInfo;
  aoFechar: () => void;
};

export function FolhaWifi({ aberta, info, aoFechar }: PropriedadesDaFolhaWifi): ReactElement {
  return (
    <Folha aberta={aberta} titulo={TEXTOS.wifi} aoFechar={aoFechar}>
      {/*
       * O conteúdo só existe com a Folha aberta, e é **isso** que leva a
       * mensagem da cópia embora quando ela fecha.
       *
       * Não há temporizador nenhum, de propósito: quem fecha a Folha é a
       * pessoa, e a frase de falha é a que **não pode** desaparecer — quem
       * não conseguiu copiar está prestes a escrever dezasseis caracteres à
       * mão, e era essa a primeira a sumir-se (8.4). Desmontar com o fecho dá
       * esse comportamento sem um efeito a apagar estado por fora.
       */}
      {aberta && <ConteudoDoWifi info={info} />}
    </Folha>
  );
}

/** O que a Folha mostra enquanto está aberta — um dos três desenhos. */
function ConteudoDoWifi({ info }: { info: EstadoDoInfo }): ReactElement {
  const [resultado, setResultado] = useState<Resultado | null>(null);

  /*
   * As duas chaves do WiFi, ou `null` quando não há as duas.
   *
   * Uma password sem rede e uma rede sem password dão o mesmo ecrã porque dão
   * a mesma informação útil: não há aqui com que te ligares, pergunta lá
   * dentro. Não há caso especial para o dono que gravou um campo e não o
   * outro (6.2).
   */
  const configurado =
    info.estado === "pronto" && info.info.wifi.rede !== null && info.info.wifi.password !== null
      ? { rede: info.info.wifi.rede, password: info.info.wifi.password }
      : null;

  const copia = areaDeTransferencia();

  function copiar(): void {
    if (configurado === null || copia === undefined) return;

    /*
     * A `vez` é o que faz o segundo toque ser anunciado.
     *
     * Escrever o mesmo texto numa região viva que já o tem não anuncia nada —
     * o leitor de ecrã não vê mudança nenhuma porque não **há** mudança
     * nenhuma no DOM. Com a `vez` na `key`, o nó é substituído e o anúncio
     * repete-se (8.4).
     */
    const marcar = (tipo: Resultado["tipo"]) => (anterior: Resultado | null) => ({
      tipo,
      vez: (anterior?.vez ?? 0) + 1,
    });

    // A password vai **tal como veio da API**, sem aparar: um espaço no fim é
    // invisível no ecrã e é o caractere que separa "copiou a password" de
    // "copiou uma password parecida" (S-09, 7.2).
    copia.writeText(configurado.password).then(
      () => {
        setResultado(marcar("copiou"));
      },
      () => {
        setResultado(marcar("falhou"));
      },
    );
  }

  return (
    <>
      {info.estado === "a-carregar" && <Esqueleto />}

      {info.estado !== "a-carregar" && configurado === null && (
        <p className="text-corpo text-texto">{TEXTOS.perguntaNoBalcao}</p>
      )}

      {configurado !== null && (
        <>
          <div>
            <Etiqueta>{TEXTOS.rede}</Etiqueta>
            <p className="text-seccao font-forte text-texto">{configurado.rede}</p>
          </div>

          <div>
            <Etiqueta>{TEXTOS.password}</Etiqueta>
            {/*
             * Tabular porque uma password lê-se caractere a caractere contra
             * um teclado, e algarismos de largura variável desenham grupos que
             * não existem. `select-all` para que um toque longo a apanhe
             * inteira, sem pegas para acertar no escuro. E parte onde calhar,
             * porque uma password não tem fronteiras de palavra (7.2).
             */}
            <p
              id={ID_DA_PASSWORD}
              className="quebra-onde-calhar select-all text-destaque font-forte tabular-nums text-texto"
            >
              {configurado.password}
            </p>
          </div>

          {copia !== undefined && (
            <div className="flex flex-col">
              <Botao variante="principal" larguraTotal onClick={copiar}>
                {TEXTOS.copiar}
              </Botao>

              {/*
               * A linha viva, no DOM desde a primeira pintura e vazia: uma
               * região viva inserida já com texto muitas vezes não é anunciada
               * (F3-01, 7.5).
               *
               * O lugar está reservado com `min-h-contagem` para que a
               * mensagem que chega não empurre o botão para cima do polegar
               * que ainda lá está — e com `min-h` e não `h`, porque com o
               * tamanho de letra do sistema no dobro a frase de erro passa a
               * duas linhas e tem de poder crescer (8.2).
               *
               * `role="status"` também para a falha: nada se perdeu e a
               * password continua no ecrã, por isso um `alert` só interromperia
               * a leitura dela para dizer que ela não foi copiada (8.3).
               */}
              <div className="min-h-contagem pt-3">
                <p
                  role="status"
                  className={
                    resultado?.tipo === "falhou" ? "text-nota text-erro" : "text-nota text-sucesso"
                  }
                >
                  {resultado === null ? null : (
                    <span key={resultado.vez}>
                      {resultado.tipo === "copiou" ? TEXTOS.copiou : TEXTOS.naoCopiou}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
