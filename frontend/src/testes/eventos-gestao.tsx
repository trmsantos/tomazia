/**
 * Apoio dos testes de componente dos eventos na gestão (F4-03): monta `EventosGestao` com
 * `src/lib/api/gestao-eventos.ts` fingido, a sessão fingida e **o relógio preso** em `AGORA`
 * (segunda-feira, 2/11/2026, 10:00 em Lisboa; só o `Date` é falsificado, os temporizadores
 * continuam reais).
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** o `vi.mock` do módulo da API:
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-eventos", () => ({
 *   obterEventosGestao: vi.fn(), criarEvento: vi.fn(), alterarEvento: vi.fn(),
 *   eliminarEvento: vi.fn(), duplicarEvento: vi.fn(),
 * }));
 * ```
 *
 * ## Contrato do componente (`src/pages/gestao/eventos/EventosGestao.tsx`)
 *
 * ```tsx
 * export function EventosGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê a sessão por `useSessaoDaGestao()` (`aoPerderSessao`). As chamadas à API levam sempre
 * `{ sinal }` como último argumento: `obterEventosGestao({sinal})`, `criarEvento(novo,
 * {sinal})`, `alterarEvento(id, corpo, {sinal})`, `eliminarEvento(id, {sinal})`,
 * `duplicarEvento(id, semanas | null, {sinal})`.
 *
 * Desenha (a spec `docs/ecras/F4-03.md` prevalece no desenho; todo o texto vem de `TEXTOS`):
 *
 *  - `<h1 tabindex="-1">` `TEXTOS.titulo` e o botão `TEXTOS.novoEvento` (já no carregamento);
 *  - `<section aria-labelledby>` (`role="region"`) com `<h2>` `TEXTOS.proximos` **sempre**
 *    (com a lista), `TEXTOS.rascunhos` só se há rascunhos, `TEXTOS.arquivo` só se há arquivo;
 *  - cada evento é um `<li>` com o botão do **título** (nome acessível = o título, abre a
 *    folha de editar), a data (`formatarDataNaGestao`), o interruptor `role="switch"` de nome
 *    `TEXTOS.publicadoDe(titulo)` (**não** no arquivo) e o botão `TEXTOS.duplicarDe(titulo)`;
 *  - depois da 3.ª linha dos próximos, um `<li>` com o texto `TEXTOS.divisoria`;
 *  - o arquivo: botão `TEXTOS.verOArquivo(n)` (`aria-expanded`), 20 linhas e
 *    `TEXTOS.mostrarMais(20)` / `TEXTOS.mostrarMais(resto)`; aberto, o botão diz
 *    `TEXTOS.esconderOArquivo`;
 *  - as folhas são `<dialog>` com o nome do seu título: `TEXTOS.tituloCriar`,
 *    `TEXTOS.tituloEditar`, `TEXTOS.tituloDuplicar`, `TEXTOS.tituloEliminar`,
 *    `TEXTOS.saidaTitulo`; os campos têm as etiquetas `TEXTOS.etiquetaTitulo`,
 *    `etiquetaDescricao` (`<textarea>`), `etiquetaData` (`type="date"`) e `etiquetaHora`
 *    (`type="time"`);
 *  - a folha «Duplicar evento» tem **três botões**, cada um com o nome que **contém**
 *    `TEXTOS.daquiASemanas(n)` e a data real dessa opção (pré-visualização);
 *  - o único aviso da página é o `AvisoTemporario` («Feito.» / «Erro.» + a frase).
 *
 * Só para testes; nada em produção o importa.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, vi, type Mock } from "vitest";

import * as api from "../lib/api/gestao-eventos";
import { EventosGestao } from "../pages/gestao/eventos/EventosGestao";
import { TEXTOS } from "../pages/gestao/eventos/textos";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import { AGORA } from "./eventos";
import { abrirEm, eventosDeGestaoDeTeste, type RespostaEventosGestao } from "./gestao";

export const obterFalso = vi.mocked(api.obterEventosGestao);
export const criarFalso = vi.mocked(api.criarEvento);
export const alterarFalso = vi.mocked(api.alterarEvento);
export const eliminarFalso = vi.mocked(api.eliminarEvento);
export const duplicarFalso = vi.mocked(api.duplicarEvento);

export const scrollFalso = vi.fn();

afterEach(() => {
  vi.useRealTimers();
});

/** O que a API de verdade devolveria: uma cópia nova a cada `GET`. O relógio fica preso em `AGORA`. */
export function prepararApi(lista: RespostaEventosGestao = eventosDeGestaoDeTeste()): void {
  vi.useFakeTimers({ toFake: ["Date"], now: AGORA });
  obterFalso.mockReset();
  criarFalso.mockReset();
  alterarFalso.mockReset();
  eliminarFalso.mockReset();
  duplicarFalso.mockReset();
  scrollFalso.mockReset();
  // O jsdom não tem `scrollIntoView`; a spec manda a linha entrar à vista (`block: "nearest"`).
  Element.prototype.scrollIntoView = scrollFalso;
  obterFalso.mockImplementation(() => Promise.resolve(structuredClone(lista)));
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
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export type SessaoFalsa = { aoPerderSessao: Mock<() => void>; aoConfirmarSessao: Mock<() => void> };

export function sessaoFalsa(): SessaoFalsa {
  return { aoPerderSessao: vi.fn<() => void>(), aoConfirmarSessao: vi.fn<() => void>() };
}

/** Abre os eventos (por omissão em `/gestao/eventos`) e espera o primeiro `GET`. */
export async function abrirEventos(
  caminho = "/gestao/eventos",
  sessao: SessaoFalsa = sessaoFalsa(),
): Promise<SessaoFalsa> {
  abrirEm(caminho);
  render(
    <ContextoDaSessao.Provider value={sessao}>
      <EventosGestao />
    </ContextoDaSessao.Provider>,
  );
  await assentar();
  return sessao;
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

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Uma expressão que aceita a frase dentro de um texto maior (espaços = qualquer espaço). */
export function contem(texto: string): RegExp {
  return new RegExp(escapar(texto).replace(/ /g, "\\s"));
}

/** A secção (`<section>`) pelo nome do seu `<h2>`. */
export function secao(nome: string): HTMLElement {
  return screen.getByRole("region", { name: nome });
}

/** A `<li>` do evento: o botão do título (nome exato) está lá dentro. `n` desempata títulos repetidos. */
export function linhaDe(titulo: string, n = 0): HTMLElement {
  const botao = screen.getAllByRole("button", { name: titulo })[n];
  const li = botao?.closest("li") ?? null;
  if (li === null) throw new Error(`«${titulo}» não está dentro de uma <li>`);
  return li;
}

export function haLinhaDe(titulo: string): boolean {
  return screen.queryAllByRole("button", { name: titulo }).length > 0;
}

export function interruptorDe(titulo: string): HTMLElement {
  return screen.getByRole("switch", { name: TEXTOS.publicadoDe(titulo) });
}

export function botaoDuplicar(titulo: string): HTMLElement {
  return screen.getByRole("button", { name: TEXTOS.duplicarDe(titulo) });
}

/** A opção «Daqui a n semanas» da folha de duplicar (o nome **contém** a frase e a data). */
export function opcaoDeSemanas(n: number): HTMLElement {
  return screen.getByRole("button", { name: contem(TEXTOS.daquiASemanas(n)) });
}

export function folha(nome?: string): HTMLElement {
  return nome === undefined
    ? screen.getByRole("dialog")
    : screen.getByRole("dialog", { name: nome });
}

export function haFolha(nome: string): boolean {
  return screen.queryByRole("dialog", { name: nome }) !== null;
}

/** Escreve num campo da folha (as etiquetas são únicas no ecrã com uma folha aberta). */
export function escrever(etiqueta: string, valor: string): void {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
}

/** Simula o `validity.badInput` de um `<input type="date|time">` escrito a meio. */
export function marcarIncompleto(etiqueta: string): void {
  const el = screen.getByLabelText(etiqueta);
  Object.defineProperty(el, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(el, { target: { value: "" } });
}

/** Preenche título, data e hora (e a descrição, se vier) da folha aberta. */
export function preencher(valores: {
  titulo?: string;
  descricao?: string;
  data?: string;
  hora?: string;
}): void {
  if (valores.titulo !== undefined) escrever(TEXTOS.etiquetaTitulo, valores.titulo);
  if (valores.descricao !== undefined) escrever(TEXTOS.etiquetaDescricao, valores.descricao);
  if (valores.data !== undefined) escrever(TEXTOS.etiquetaData, valores.data);
  if (valores.hora !== undefined) escrever(TEXTOS.etiquetaHora, valores.hora);
}

/** O botão de uma folha pelo nome exato (ou «A guardar…» etc., passando uma expressão). */
export function botao(nome: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: nome });
}

export function haBotao(nome: string | RegExp): boolean {
  return screen.queryByRole("button", { name: nome }) !== null;
}

/** O aviso temporário atual (sucesso é `status`, erro é `alert`), ou `null`. */
export function aviso(): HTMLElement | null {
  const candidatos = Array.from(
    document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return candidatos.find((no) => /^\s*(Feito|Erro)\./.test(no.textContent ?? "")) ?? null;
}

export function desfazerDoAviso(): HTMLElement | null {
  const el = aviso();
  return el === null ? null : within(el).queryByRole("button", { name: TEXTOS.desfazer });
}

/** Tudo o que não existe nesta tarefa: cartaz a mudar, interruptor «Publicado» na folha de criar. */
export const PROIBIDOS_DA_F4_03 = /enviar cartaz|mudar o cartaz|trocar o cartaz|retirar o cartaz/i;
