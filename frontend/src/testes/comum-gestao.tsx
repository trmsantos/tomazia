/**
 * O que os testes de componente de Início e Clientes (F4-05b) partilham: relógio preso, promessas
 * pendentes, sessão fingida, tocar, voltar à aba, o aviso e a linha de estado, e a varredura de
 * dados pessoais. Só para testes; nada em produção o importa.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, vi, type Mock } from "vitest";

import { ErroDaApi } from "../lib/api/cliente";
import { AGORA } from "./eventos";

export { AGORA };

afterEach(() => {
  vi.useRealTimers();
});

/** Falsifica `Date`, `setTimeout` e `clearTimeout`: o aviso de 3 s e os prazos correm só com `avancar`. */
export function prenderORelogio(): void {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: AGORA });
  // O jsdom não tem `scrollIntoView`.
  Element.prototype.scrollIntoView = vi.fn();
}

export function pendente<T>() {
  let resolver: (valor: T) => void = () => undefined;
  let rejeitar: (erro: unknown) => void = () => undefined;
  const promessa = new Promise<T>((cumprir, falhar) => {
    resolver = cumprir;
    rejeitar = falhar;
  });
  return { promessa, resolver, rejeitar };
}

/** Deixa as promessas pendentes (e os efeitos que delas dependem) assentar. */
export async function assentar(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Faz correr o relógio simulado `ms` milissegundos (temporizadores e promessas incluídos). */
export async function avancar(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export type SessaoFalsa = { aoPerderSessao: Mock<() => void>; aoConfirmarSessao: Mock<() => void> };

export function sessaoFalsa(): SessaoFalsa {
  return { aoPerderSessao: vi.fn<() => void>(), aoConfirmarSessao: vi.fn<() => void>() };
}

/** Em pedidos ao servidor: o último argumento é sempre `{ sinal }`. */
export const comSinal = expect.objectContaining({ sinal: expect.any(AbortSignal) as unknown });

export async function tocar(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(elemento);
    await Promise.resolve();
  });
  await assentar();
}

/** Dois toques no mesmo instante, antes de o React assentar. */
export async function tocarDuasVezes(elemento: HTMLElement): Promise<void> {
  act(() => {
    fireEvent.click(elemento);
  });
  act(() => {
    fireEvent.click(elemento);
  });
  await assentar();
}

/** `aria-disabled="true"`: inerte (nunca `disabled`: o foco não cai). */
export function inerte(elemento: HTMLElement): boolean {
  return elemento.getAttribute("aria-disabled") === "true";
}

/** Faz a aba voltar a ficar visível (o ecrã relê em silêncio). */
export async function voltarAAba(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await assentar();
}

/** A aba passa a oculta (não é motivo para reler). */
export async function esconderAAba(): Promise<void> {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  await assentar();
}

/**
 * Uma promessa que só acaba quando o `{ sinal }` (o último argumento) é abortado — com o erro de
 * «sem resposta» (`estado: null`), como o cliente faz com um prazo esgotado.
 */
export function ficarPendenteAteAbortar(...args: unknown[]): Promise<never> {
  const opcoes = args.at(-1) as { sinal?: AbortSignal } | undefined;
  return new Promise((_cumprir, falhar) => {
    opcoes?.sinal?.addEventListener("abort", () => {
      falhar(erroSemResposta());
    });
  });
}

// ---------------------------------------------------------------------------
// Os erros, como o cliente os lança. A `mensagem` do backend nunca pode chegar ao ecrã.
// ---------------------------------------------------------------------------

export const MENSAGEM_DO_BACKEND = "MENSAGEM-DO-BACKEND-NUNCA-NO-ECRA";

export function erroSemResposta(): ErroDaApi {
  return new ErroDaApi("Não consegui falar com o servidor.", { estado: null, codigo: null });
}
export function erroDe(estado: number, codigo: string | null = null): ErroDaApi {
  return new ErroDaApi(MENSAGEM_DO_BACKEND, { estado, codigo });
}
/** Um `200` cujo corpo não se sabe ler (`ErroDaApi` de estado 200). */
export function erroIlegivel(): ErroDaApi {
  return new ErroDaApi("O corpo não se sabe ler.", { estado: 200, codigo: null });
}

// ---------------------------------------------------------------------------
// O DOM
// ---------------------------------------------------------------------------

export function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

/** O aviso temporário atual (sucesso é `status`, erro é `alert`), ou `null`. */
export function aviso(): HTMLElement | null {
  const candidatos = Array.from(
    document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return candidatos.find((no) => /^\s*(Feito|Erro)\./.test(no.textContent ?? "")) ?? null;
}

/** A linha de estado (`role="status"` que não é o aviso) com `texto`, ou `null`. */
export function linhaDeEstado(texto: string): HTMLElement | null {
  const todos = Array.from(
    document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return (
    todos.find(
      (no) =>
        (no.textContent ?? "").includes(texto) && !/^\s*(Feito|Erro)\./.test(no.textContent ?? ""),
    ) ?? null
  );
}

/** Os esqueletos: `aria-busy="true"` dentro do `<main>` **sem botões nem ligações**. */
export function esqueletos(): HTMLElement[] {
  const principal = document.querySelector("main");
  if (principal === null) return [];
  return Array.from(principal.querySelectorAll<HTMLElement>('[aria-busy="true"]')).filter(
    (no) => no.tagName !== "BUTTON",
  );
}

export function haEsqueleto(): boolean {
  return esqueletos().length > 0;
}

/** Um botão (fora de folhas), pelo nome. */
export function botaoDaPagina(nome: string | RegExp): HTMLElement {
  const todos = screen.getAllByRole("button", { name: nome });
  const daPagina = todos.find((b) => b.closest("dialog") === null);
  if (daPagina === undefined)
    throw new Error(`não há um botão «${String(nome)}» fora de uma folha`);
  return daPagina;
}
export function haBotaoDaPagina(nome: string | RegExp): boolean {
  return screen.queryAllByRole("button", { name: nome }).some((b) => b.closest("dialog") === null);
}

// ---------------------------------------------------------------------------
// Dados pessoais (critério 13): nome, email e telemóvel só como texto visível
// ---------------------------------------------------------------------------

/**
 * Varre **todos** os atributos de **todos** os elementos do documento e devolve os que levam
 * alguma das `pistas` (nome, email, telemóvel e partes deles). Só o texto visível pode tê-las:
 * `aria-label`, `aria-labelledby`/`describedby` (que são ids), `title`, `alt`, `name`, `id`,
 * `href`, `src`, `data-*`, `class`, `value`, `placeholder`, `download`… e o `document.title`, o
 * endereço e o `history.state`.
 *
 * O `aria-describedby` do «Eliminar» aponta ao `<p>` do nome — mas o **id** (`cliente-nome-3`)
 * é por índice e nunca leva a pista; quem confirma que o que ele aponta é só o nome é outro teste.
 */
export function fugasDeDadosPessoais(pistas: readonly string[]): string[] {
  const fugas: string[] = [];
  const procurar = (onde: string, valor: string): void => {
    const minusculo = valor.toLowerCase();
    for (const pista of pistas) {
      if (minusculo.includes(pista.toLowerCase())) fugas.push(`${onde} leva «${pista}»: ${valor}`);
    }
  };
  for (const no of Array.from(document.querySelectorAll<Element>("*"))) {
    for (const atributo of Array.from(no.attributes)) {
      procurar(`<${no.tagName.toLowerCase()} ${atributo.name}>`, atributo.value);
    }
  }
  procurar("document.title", document.title);
  procurar("window.location", window.location.href);
  procurar("history.state", JSON.stringify(window.history.state ?? null));
  return fugas;
}

/**
 * Os nomes acessíveis dos papéis que costumam ter nome, que levam alguma pista. `getAllByRole`
 * com `name` calcula o nome a sério (`aria-label`, `aria-labelledby`, `title`, conteúdo): as
 * **linhas** e o **texto** podem tê-las; estes papéis, os botões e a folha, não.
 */
export function papeisComNomeComDados(pistas: readonly string[]): string[] {
  const achados: string[] = [];
  const papeis = ["button", "link", "dialog", "region", "list", "img", "group", "status"] as const;
  for (const papel of papeis) {
    for (const pista of pistas) {
      const regex = new RegExp(pista.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const encontrados = screen.queryAllByRole(papel, { name: regex, hidden: true });
      for (const no of encontrados) {
        // Uma região viva (`status`) **pode** ter dados no texto, mas o nome dela vem do conteúdo
        // só para alguns papéis; para `status` o nome não vem do conteúdo, por isso conta igual.
        achados.push(`${papel} com o nome a levar «${pista}»: ${no.outerHTML.slice(0, 80)}`);
      }
    }
  }
  return achados;
}
