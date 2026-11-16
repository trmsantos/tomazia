import type { PointerEvent as EventoDePonteiro, ReactElement } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { juntar } from "../../../components/ui/juntar";
import { type Movimento, moverNaLista } from "./estado-da-ementa";
import { jaEmPrimeiro, jaEmUltimo, posicao, TEXTOS } from "./textos";

/**
 * A lista do modo «Ordenar» (F4-02, 6, decisão D2): sem biblioteca, e **sem
 * `style`** (a CSP `style-src 'self'` do ADR 0008 proíbe-o, e as bibliotecas de
 * arrastar movem as linhas com `transform` num `style`).
 *
 * Duas maneiras de mudar a ordem, e as duas só mexem na ordem **local** (quem
 * grava é o «Guardar ordem» do cartão):
 *
 *  - os **botões** — «Subir», «Descer», «Para o início», «Para o fim» — cobrem o
 *    teclado, o leitor de ecrã e a mão que falha (WCAG 2.1.1 e 2.5.7);
 *  - a **pega**, com Pointer Events: a linha muda de lugar **no DOM** quando o
 *    meio dela passa o meio da vizinha, e ganha uma classe enquanto é arrastada.
 *
 * É genérica em `{ id, nome }` e **controlada**: `itens` vem pela ordem atual e
 * cada movimento chama `aoMudarOrdem` com os ids pela ordem nova.
 */
export type ItemOrdenavel = { id: number; nome: string };

type Acao = "subir" | "descer" | "inicio" | "fim";

/** Menos do que isto, o ponteiro não «arrastou»: ficou onde um toque fica. */
const DESLOCAMENTO_MINIMO_PX = 8;
/** Perto do bordo do ecrã, a página desloca sozinha. */
const MARGEM_DE_DESLOCACAO_PX = 64;
const PASSO_DE_DESLOCACAO_PX = 12;

/** Estas ações estão desativadas na linha `indice` de `total`? */
function estaDesativada(acao: Acao, indice: number, total: number): boolean {
  if (acao === "subir" || acao === "inicio") return indice === 0;
  return indice === total - 1;
}

type Arrasto = {
  id: number;
  pointerId: number;
  yInicial: number;
  /** Onde, dentro da linha, o ponteiro pegou (a pega não está a meio da linha). */
  deslocamentoNaLinha: number;
  ordemInicial: number[];
  ativo: boolean;
  cancelado: boolean;
};

function Pega(): ReactElement {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

export function ListaOrdenavel({
  itens,
  bloqueado,
  aoMudarOrdem,
}: {
  itens: readonly ItemOrdenavel[];
  /** A guardar: os botões e a pega ficam parados. */
  bloqueado: boolean;
  aoMudarOrdem: (ids: number[]) => void;
}): ReactElement {
  const base = useId();
  const lista = useRef<HTMLUListElement>(null);
  const botoes = useRef(new Map<string, HTMLButtonElement>());
  const focoPendente = useRef<string | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const [emArrasto, setEmArrasto] = useState<number | null>(null);

  // O arrasto lê sempre a ordem e o callback mais recentes, sem se refazer.
  const itensAtuais = useRef(itens);
  const aoMudarAtual = useRef(aoMudarOrdem);
  const terminarArrasto = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    itensAtuais.current = itens;
    aoMudarAtual.current = aoMudarOrdem;
  });

  // Ao abrir o modo: o foco vai ao primeiro «Subir» que não está desativado (o da
  // segunda linha).
  useEffect(() => {
    const segunda = itensAtuais.current[1];
    const primeira = itensAtuais.current[0];
    const alvo =
      segunda !== undefined
        ? botoes.current.get(`${String(segunda.id)}:subir`)
        : primeira !== undefined
          ? botoes.current.get(`${String(primeira.id)}:descer`)
          : undefined;
    alvo?.focus();
  }, []);

  // Depois de um movimento, o foco volta ao botão da linha movida: o React move o
  // nó e o browser larga o foco.
  useEffect(() => {
    const chave = focoPendente.current;
    if (chave === null) return;
    focoPendente.current = null;
    botoes.current.get(chave)?.focus();
  }, [itens]);

  // Desmontar a meio de um arrasto largar os ouvintes da janela.
  useEffect(() => {
    return () => {
      terminarArrasto.current?.();
    };
  }, []);

  function mover(id: number, acao: Acao): void {
    if (bloqueado) return;
    const nova = moverNaLista(itens, id, acao satisfies Movimento);
    const indice = nova.findIndex((item) => item.id === id);
    if (indice === -1) return;

    // O botão equivalente da linha movida; se ficou desativado, o «Descer»; se
    // esse também (a linha foi para o fim), o «Subir». Nunca o <body>.
    const alvo = ([acao, "descer", "subir"] as const).find(
      (candidata) => !estaDesativada(candidata, indice, nova.length),
    );
    if (alvo !== undefined) focoPendente.current = `${String(id)}:${alvo}`;

    const item = nova[indice];
    if (item !== undefined) setAnuncio(posicao(item.nome, indice + 1, nova.length));
    aoMudarOrdem(nova.map((outro) => outro.id));
  }

  function comecarArrasto(evento: EventoDePonteiro<HTMLElement>, id: number): void {
    if (bloqueado || evento.button !== 0) return;
    const linha = evento.currentTarget.closest("li");
    if (linha === null) return;

    const estado: Arrasto = {
      id,
      pointerId: evento.pointerId,
      yInicial: evento.clientY,
      deslocamentoNaLinha: evento.clientY - linha.getBoundingClientRect().top,
      ordemInicial: itensAtuais.current.map((item) => item.id),
      ativo: false,
      cancelado: false,
    };
    terminarArrasto.current?.();

    try {
      evento.currentTarget.setPointerCapture(evento.pointerId);
    } catch {
      // Sem captura do ponteiro (jsdom, ou o ponteiro já acabou): os ouvintes
      // da janela chegam.
    }

    const deOutroPonteiro = (outro: globalThis.PointerEvent): boolean =>
      Number.isFinite(estado.pointerId) && outro.pointerId !== estado.pointerId;

    function trocar(y: number): void {
      const ul = lista.current;
      if (ul === null) return;
      const linhas = Array.from(ul.children);
      const ids = itensAtuais.current.map((item) => item.id);
      const indice = ids.indexOf(estado.id);
      const propria = linhas[indice]?.getBoundingClientRect();
      if (propria === undefined) return;

      // O centro que a linha arrastada teria se seguisse o ponteiro: quando passa
      // o meio da vizinha, trocam. (Uma linha com a pega no topo não tem o ponteiro
      // no centro; é o deslocamento do primeiro toque que o corrige.)
      const centro = y - estado.deslocamentoNaLinha + propria.height / 2;
      const seguinte = linhas[indice + 1]?.getBoundingClientRect();
      const anterior = linhas[indice - 1]?.getBoundingClientRect();

      if (seguinte !== undefined && centro > seguinte.top + seguinte.height / 2) {
        aoMudarAtual.current(
          moverNaLista(itensAtuais.current, estado.id, "descer").map((i) => i.id),
        );
      } else if (anterior !== undefined && centro < anterior.top + anterior.height / 2) {
        aoMudarAtual.current(
          moverNaLista(itensAtuais.current, estado.id, "subir").map((i) => i.id),
        );
      }
    }

    function aoMover(outro: globalThis.PointerEvent): void {
      if (estado.cancelado || deOutroPonteiro(outro)) return;
      const y = outro.clientY;
      if (!Number.isFinite(y)) return;

      if (!estado.ativo) {
        if (Math.abs(y - estado.yInicial) < DESLOCAMENTO_MINIMO_PX) return;
        estado.ativo = true;
        setEmArrasto(estado.id);
      }

      if (y < MARGEM_DE_DESLOCACAO_PX) window.scrollBy(0, -PASSO_DE_DESLOCACAO_PX);
      else if (y > window.innerHeight - MARGEM_DE_DESLOCACAO_PX) {
        window.scrollBy(0, PASSO_DE_DESLOCACAO_PX);
      }
      trocar(y);
    }

    function reporOrdemInicial(): void {
      if (estado.ativo) aoMudarAtual.current(estado.ordemInicial);
    }

    function aoLargar(outro: globalThis.PointerEvent): void {
      if (deOutroPonteiro(outro)) return;
      // Largar fora da lista cancela o arrasto; largar dentro deixa a linha onde está.
      const caixa = lista.current?.getBoundingClientRect();
      const fora =
        caixa !== undefined &&
        Number.isFinite(outro.clientX) &&
        Number.isFinite(outro.clientY) &&
        (outro.clientX < caixa.left ||
          outro.clientX > caixa.right ||
          outro.clientY < caixa.top ||
          outro.clientY > caixa.bottom);
      if (fora && !estado.cancelado) reporOrdemInicial();
      terminar();
    }

    function aoCancelarPonteiro(outro: globalThis.PointerEvent): void {
      if (deOutroPonteiro(outro)) return;
      if (!estado.cancelado) reporOrdemInicial();
      terminar();
    }

    function aoTeclar(tecla: KeyboardEvent): void {
      if (tecla.key !== "Escape" || estado.cancelado) return;
      reporOrdemInicial();
      estado.cancelado = true;
      setEmArrasto(null);
    }

    function terminar(): void {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoLargar);
      window.removeEventListener("pointercancel", aoCancelarPonteiro);
      document.removeEventListener("keydown", aoTeclar);
      terminarArrasto.current = null;
      setEmArrasto(null);
    }

    // Na janela e não na pega: o React move o nó da linha ao reordenar, e o
    // browser pode largar a captura do ponteiro quando o nó sai do documento.
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoLargar);
    window.addEventListener("pointercancel", aoCancelarPonteiro);
    document.addEventListener("keydown", aoTeclar);
    terminarArrasto.current = terminar;
  }

  function botao(item: ItemOrdenavel, indice: number, acao: Acao): ReactElement {
    const nome = item.nome;
    const desativado = bloqueado || estaDesativada(acao, indice, itens.length);
    const limite = estaDesativada(acao, indice, itens.length);
    const rotulos: Record<Acao, [string, string]> = {
      subir: [TEXTOS.subir, `${TEXTOS.subir} ${nome}`],
      descer: [TEXTOS.descer, `${TEXTOS.descer} ${nome}`],
      inicio: [TEXTOS.paraOInicio, `Mover ${nome} para o início`],
      fim: [TEXTOS.paraOFim, `Mover ${nome} para o fim`],
    };
    const [visivel, rotulo] = rotulos[acao];
    const razao = acao === "subir" || acao === "inicio" ? "primeiro" : "ultimo";
    const chave = `${String(item.id)}:${acao}`;

    return (
      <Botao
        ref={(no) => {
          if (no !== null) botoes.current.set(chave, no);
          else botoes.current.delete(chave);
        }}
        rotulo={rotulo}
        desativado={desativado}
        descritoPor={limite ? `${base}-${razao}-${String(item.id)}` : undefined}
        onClick={() => {
          mover(item.id, acao);
        }}
      >
        {visivel}
      </Botao>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="sr-only">
        {anuncio}
      </p>
      <ul ref={lista} className="flex flex-col">
        {itens.map((item, indice) => (
          <li
            key={item.id}
            className={juntar(
              "flex select-none flex-col gap-2 border border-transparent py-3",
              indice > 0 && emArrasto !== item.id && "border-t-fio-interno",
              emArrasto === item.id && "border-foco bg-fundo",
            )}
          >
            <div className="flex items-center gap-3">
              <div
                aria-hidden="true"
                data-pega=""
                onPointerDown={(evento) => {
                  comecarArrasto(evento, item.id);
                }}
                className={
                  "touch-none flex min-h-toque min-w-toque shrink-0 cursor-grab items-center " +
                  "justify-center rounded-pequeno text-texto-suave"
                }
              >
                <Pega />
              </div>
              <span className="min-w-0 break-words text-corpo font-forte text-texto">
                {item.nome}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {botao(item, indice, "subir")}
              {botao(item, indice, "descer")}
              {botao(item, indice, "inicio")}
              {botao(item, indice, "fim")}
            </div>
            {indice === 0 && (
              <span id={`${base}-primeiro-${String(item.id)}`} className="sr-only">
                {jaEmPrimeiro(item.nome)}
              </span>
            )}
            {indice === itens.length - 1 && (
              <span id={`${base}-ultimo-${String(item.id)}`} className="sr-only">
                {jaEmUltimo(item.nome)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
