import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { Botao } from "./Botao";
import { juntar } from "./juntar";

/**
 * Aviso temporário (secção 7.5 de `docs/ecras/F3-01.md`).
 *
 * Confirma uma ação do dono e, quando ela é reversível, oferece "Desfazer"
 * durante cinco segundos — a especificação prefere isto a uma confirmação.
 *
 * Três coisas que parecem detalhe e não são:
 *
 *  - **A região vive no DOM desde o início, vazia.** Uma região inserida já
 *    com texto muitas vezes não é anunciada: o leitor de ecrã repara no que
 *    muda dentro de uma região que já lá estava, não na região a aparecer.
 *  - **A contagem é `setTimeout`/`clearTimeout`.** Nem `Date.now()` em laço
 *    nem `requestAnimationFrame`: assim os testes podem parar o relógio em
 *    vez de esperar cinco segundos a sério.
 *  - **O tempo pára com o rato por cima ou com o foco dentro** (WCAG 2.2.1).
 *    Sem isso, quem navega por teclado chega ao "Desfazer" depois de ele já
 *    ter desaparecido — e o "Desfazer" é o que está no lugar das
 *    confirmações.
 *
 * Não há barra de contagem. Ela teria de ser uma animação CSS de duração
 * fixa (um `style` com percentagem é bloqueado pela CSP), e uma duração fixa
 * discordaria em silêncio de um `duracaoMs` diferente de 5000.
 */
export type PropriedadesDoAviso = {
  tipo: "sucesso" | "erro";
  /** Sem mensagem, a região fica no DOM, vazia e sem desenho nenhum. */
  mensagem?: string;
  /** Só quando a ação é reversível. */
  aoDesfazer?: () => void;
  aoFechar: () => void;
  duracaoMs?: number;
};

const DURACAO_PADRAO_MS = 5000;

export function AvisoTemporario({
  tipo,
  mensagem,
  aoDesfazer,
  aoFechar,
  duracaoMs = DURACAO_PADRAO_MS,
}: PropriedadesDoAviso): ReactElement {
  const [parado, setParado] = useState(false);

  // O `aoFechar` costuma ser uma função nova a cada render de quem usa isto.
  // Se o temporizador dependesse dele, recomeçava a contagem a cada render e
  // o aviso nunca se ia embora. A referência mantém a contagem presa à
  // mensagem e ao tempo, que é o que de facto a define.
  const fecharAgora = useRef(aoFechar);
  useEffect(() => {
    fecharAgora.current = aoFechar;
  });

  useEffect(() => {
    if (mensagem === undefined || parado) return;

    const temporizador = setTimeout(() => {
      fecharAgora.current();
    }, duracaoMs);

    return () => {
      clearTimeout(temporizador);
    };
  }, [mensagem, parado, duracaoMs]);

  const visivel = mensagem !== undefined;

  return (
    <div
      className={juntar(
        "pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-4 pt-4",
        // A folga de baixo é `--espaco-4` mais a margem de sistema do
        // telemóvel: sem ela, no iPhone o aviso assenta em cima do
        // indicador de home.
        "folga-de-sistema-em-baixo",
      )}
    >
      <div
        // Sucesso é `status` (aria-live polite); erro é `alert`, que
        // interrompe. A região é sempre a mesma: só o texto muda.
        role={tipo === "erro" ? "alert" : "status"}
        onMouseEnter={() => {
          setParado(true);
        }}
        onMouseLeave={() => {
          setParado(false);
        }}
        onFocus={() => {
          setParado(true);
        }}
        onBlur={() => {
          setParado(false);
        }}
        className={juntar(
          visivel &&
            "superficie-painel pointer-events-auto flex w-full max-w-folha items-center gap-3 " +
              "rounded-cartao border border-contorno-superficie p-4",
        )}
      >
        {visivel && (
          <>
            <p className="flex-1 text-corpo">
              {/* A palavra de estado, e não só a cor, é o que distingue
                  sucesso de erro (1.4.1). */}
              <span
                className={tipo === "erro" ? "font-forte text-erro" : "font-forte text-sucesso"}
              >
                {tipo === "erro" ? "Erro." : "Feito."}
              </span>{" "}
              {mensagem}
            </p>

            {aoDesfazer !== undefined && (
              <Botao variante="secundario" onClick={aoDesfazer}>
                Desfazer
              </Botao>
            )}

            <Botao variante="discreto" rotulo="Fechar aviso" onClick={aoFechar}>
              <span aria-hidden="true">×</span>
            </Botao>
          </>
        )}
      </div>
    </div>
  );
}
