/**
 * Apoio dos testes de componente das definições na gestão (F4-05a): monta
 * `DefinicoesGestao` com `src/lib/api/gestao-definicoes.ts` fingido e a sessão
 * fingida.
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** o `vi.mock` do módulo da API:
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-definicoes", () => ({
 *   obterDefinicoes: vi.fn(), guardarDefinicoes: vi.fn(),
 * }));
 * ```
 *
 * Contrato do componente (`src/pages/gestao/definicoes/DefinicoesGestao.tsx`):
 *
 * ```tsx
 * export function DefinicoesGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê a sessão por `useSessaoDaGestao()` (`aoPerderSessao`) e desenha: o `<h1>`
 * «Definições» (`tabindex="-1"`), a ligação «Voltar a Mais» (`href="/gestao/mais"`),
 * e **só depois de um GET 200** o `<form>` com três painéis (`<section>` com `<h2>`),
 * o editor do horário e a barra de guardar. `obterDefinicoes({ sinal })` e
 * `guardarDefinicoes(pedido, { sinal })`: o último argumento é sempre `{ sinal }`.
 * Os campos são `<input type="text">` com a etiqueta visível (`TEXTOS.etiqueta*`);
 * o interruptor de cada dia é um `role="switch"` com o nome do dia (`nomeDoDia`);
 * cada dia é um `<fieldset>` com `<legend>` (`role="group"`, `legendaDoDia`). O botão
 * «Guardar alterações» tem `aria-disabled="true"` sem alterações; o único aviso da
 * página é o `AvisoTemporario` («Feito. Definições guardadas.»).
 *
 * Só para testes; nada em produção o importa.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import * as api from "../lib/api/gestao-definicoes";
import { DefinicoesGestao } from "../pages/gestao/definicoes/DefinicoesGestao";
import {
  TEXTOS,
  legendaDoDia,
  nomeDeAbre,
  nomeDeFecha,
  nomeDoDia,
} from "../pages/gestao/definicoes/textos";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import {
  abrirEm,
  definicoesConfiguradas,
  ecoDoPedido,
  type DefinicoesGestao as DefinicoesDaApi,
  type DiaDaSemana,
  type PedidoDefinicoes,
} from "./gestao";

export const obterFalso = vi.mocked(api.obterDefinicoes);
export const guardarFalso = vi.mocked(api.guardarDefinicoes);

/** O que a API de verdade devolveria: uma cópia nova a cada `GET`; o `PUT` ecoa o pedido. */
export function prepararApi(definicoes: DefinicoesDaApi = definicoesConfiguradas()): void {
  obterFalso.mockReset();
  guardarFalso.mockReset();
  obterFalso.mockImplementation(() => Promise.resolve(structuredClone(definicoes)));
  guardarFalso.mockImplementation((pedido: PedidoDefinicoes) =>
    Promise.resolve(structuredClone(ecoDoPedido(pedido))),
  );
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
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export type SessaoFalsa = { aoPerderSessao: Mock<() => void>; aoConfirmarSessao: Mock<() => void> };

export function sessaoFalsa(): SessaoFalsa {
  return { aoPerderSessao: vi.fn<() => void>(), aoConfirmarSessao: vi.fn<() => void>() };
}

/** Abre as definições (por omissão em `/gestao/mais/definicoes`) e espera o primeiro `GET`. */
export async function abrirDefinicoes(
  caminho = "/gestao/mais/definicoes",
  sessao: SessaoFalsa = sessaoFalsa(),
): Promise<SessaoFalsa> {
  abrirEm(caminho);
  render(
    <ContextoDaSessao.Provider value={sessao}>
      <DefinicoesGestao />
    </ContextoDaSessao.Provider>,
  );
  await assentar();
  return sessao;
}

/** Em pedidos ao servidor: o último argumento é sempre `{ sinal }`. */
export const comSinal = expect.objectContaining({ sinal: expect.any(AbortSignal) as unknown });

export function campo(etiqueta: string): HTMLInputElement {
  return screen.getByLabelText(etiqueta);
}

export function escrever(etiqueta: string, valor: string): void {
  fireEvent.change(campo(etiqueta), { target: { value: valor } });
}

export async function tocar(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(elemento);
    await Promise.resolve();
  });
  await assentar();
}

export function botaoDeGuardar(): HTMLElement {
  return screen.getByRole("button", {
    name: new RegExp(`^(${TEXTOS.guardar}|${TEXTOS.aGuardar})$`),
  });
}

export async function guardar(): Promise<void> {
  await tocar(botaoDeGuardar());
}

export function grupoDoDia(dia: DiaDaSemana): HTMLElement {
  return screen.getByRole("group", { name: legendaDoDia(dia) });
}

export function interruptorDoDia(dia: DiaDaSemana): HTMLInputElement {
  return screen.getByRole("switch", { name: nomeDoDia(dia) });
}

/** O campo Abre (ou Fecha) do período `n` (de `total`) de um dia. */
export function horaDe(
  dia: DiaDaSemana,
  qual: "abre" | "fecha",
  n = 1,
  total = 1,
): HTMLInputElement {
  const nome = qual === "abre" ? nomeDeAbre(dia, n, total) : nomeDeFecha(dia, n, total);
  return within(grupoDoDia(dia)).getByLabelText(nome);
}

export function escreverHora(
  dia: DiaDaSemana,
  qual: "abre" | "fecha",
  valor: string,
  n = 1,
  total = 1,
): void {
  fireEvent.change(horaDe(dia, qual, n, total), { target: { value: valor } });
}

/** O corpo do n-ésimo `PUT` (o primeiro por omissão). */
export function corpoDoPutNumero(n = 0): PedidoDefinicoes {
  const chamada = guardarFalso.mock.calls[n];
  if (chamada === undefined) throw new Error(`não houve um PUT número ${String(n + 1)}`);
  return chamada[0];
}

/** O aviso temporário atual (sucesso é `status`, erro é `alert`), ou `null`. */
export function aviso(): HTMLElement | null {
  const candidatos = Array.from(
    document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return candidatos.find((no) => /^\s*(Feito|Erro)\./.test(no.textContent ?? "")) ?? null;
}

/** Todos os controlos de escrita do ecrã (nada devia existir em estado de erro/carregar). */
export function controlosDeEscrita(): HTMLElement[] {
  return [
    ...screen.queryAllByRole("textbox"),
    ...screen.queryAllByRole("switch"),
    ...Array.from(document.querySelectorAll<HTMLElement>("input, textarea, select")),
  ];
}

export function haBotaoDeGuardar(): boolean {
  return (
    screen.queryByRole("button", { name: TEXTOS.guardar }) !== null ||
    screen.queryByRole("button", { name: TEXTOS.aGuardar }) !== null
  );
}
