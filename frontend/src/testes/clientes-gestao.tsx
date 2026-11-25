/**
 * Apoio dos testes de componente de `ClientesGestao` (F4-05b): monta o ecrã com
 * `src/lib/api/gestao-clientes.ts` fingido, a sessão fingida e **o relógio preso** em `AGORA`
 * (segunda-feira, 2/11/2026, 10:00 em Lisboa).
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** o `vi.mock`:
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-clientes", async (importOriginal) => ({
 *   ...(await importOriginal<typeof import("../../../lib/api/gestao-clientes")>()),
 *   obterClientes: vi.fn(), eliminarCliente: vi.fn(), descarregarClientesCsv: vi.fn(),
 * }));
 * ```
 *
 * ## Contrato do componente (`src/pages/gestao/clientes/ClientesGestao.tsx`)
 *
 * ```tsx
 * export function ClientesGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê a sessão por `useSessaoDaGestao()` (`aoPerderSessao`). Chama a API sempre com `{ sinal }` no
 * último argumento: `obterClientes({sinal})`, `eliminarCliente(id, {sinal})`,
 * `descarregarClientesCsv({sinal})`. Desenha (a spec `docs/ecras/F4-05b.md` prevalece; o texto é
 * o de `clientes-gestao-textos.ts`):
 *
 *  - **nenhum `<main>`**: é da moldura (F4-01); os testes montam o ecrã dentro de um `<main>`;
 *  - `<h1 tabindex="-1">` «Clientes» e, por baixo, `<a href="/gestao/mais">` «Voltar a Mais»;
 *  - `<section aria-labelledby>` (`role="region"`) com o `<h2 tabindex="-1">` «Clientes registados
 *    ({n})» (o total; sem número a carregar e vazio) — **a seguir ao `<h1>` e ao «Voltar»**;
 *  - `<ul>` com um `<li>` por cliente: o nome num `<p id="cliente-nome-<índice>">`, o email, o
 *    telemóvel **só se existir**, «Consentimento dado a {data com ano}.» e um `<button>` «Eliminar»
 *    com `aria-describedby` = o `id` do `<p>` do nome **desse** item (e só dele);
 *  - o botão «Exportar CSV» (só com a lista pronta), com `aria-describedby` para os dois `<p>`
 *    (a ajuda e o aviso de dados pessoais);
 *  - a linha de estado: `<p role="status">` (uma só além do aviso e de «A mostrar x de n.»);
 *  - «A mostrar x de n.» num `<p aria-live="polite">` e o botão «Mostrar mais clientes»;
 *  - o esqueleto: elementos `aria-busy="true"` **sem texto**, sem botões nem ligações;
 *  - `EstadoVazio` (`<h3>` + `<p>`) para vazio e erro; o erro leva o botão «Tentar outra vez»;
 *  - a folha «Tem a certeza?» (`<dialog>` com o nome «Tem a certeza?») com nome, email, a
 *    consequência e a linha do CSV, e os botões «Eliminar» e «Cancelar»; o erro dentro dela é
 *    `<p role="status">`;
 *  - o aviso: `AvisoTemporario` («Feito. Cliente eliminado.», 3 s; «Feito. Ficheiro CSV
 *    preparado…», 5 s).
 *
 * Só para testes; nada em produção o importa.
 */
import { StrictMode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import * as api from "../lib/api/gestao-clientes";
import { ClientesGestao } from "../pages/gestao/clientes/ClientesGestao";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import { clientesDeTeste, type ClienteGestao } from "./clientes-dados";
import { TEXTOS_CLIENTES as T } from "./clientes-gestao-textos";
import { assentar, prenderORelogio, sessaoFalsa, tocar, type SessaoFalsa } from "./comum-gestao";
import { abrirEm } from "./gestao";

export * from "./comum-gestao";
export { T, within };
export type { ClienteGestao };

export const obterFalso = vi.mocked(api.obterClientes);
export const eliminarFalso = vi.mocked(api.eliminarCliente);
export const csvFalso = vi.mocked(api.descarregarClientesCsv);

/** Os cliques de `<a download>` que o ecrã fez (o jsdom não navega; regista-se o que se ia descarregar). */
export type CliqueDeDescarga = {
  href: string;
  download: string;
  /** O `<a>` estava no documento no instante do clique? */
  ligado: boolean;
};
export const descargas: CliqueDeDescarga[] = [];
let cliqueFalso: { mockRestore: () => void } | undefined;
afterEach(() => {
  cliqueFalso?.mockRestore();
  cliqueFalso = undefined;
});

/** O que o servidor devolveria agora: a lista que se passa a `prepararApi`, ou outra. */
export function prepararApi(clientes: readonly ClienteGestao[] = clientesDeTeste()): void {
  prenderORelogio();
  for (const falso of [obterFalso, eliminarFalso, csvFalso]) falso.mockReset();
  descargas.length = 0;
  cliqueFalso?.mockRestore();
  cliqueFalso = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    descargas.push({
      href: this.getAttribute("href") ?? "",
      download: this.getAttribute("download") ?? "",
      ligado: this.isConnected,
    });
  });
  obterFalso.mockImplementation(() =>
    Promise.resolve({ clientes: structuredClone([...clientes]) }),
  );
  eliminarFalso.mockResolvedValue(undefined);
  csvFalso.mockResolvedValue({
    nome: "clientes-2026-11-02.csv",
    href: "data:text/csv;charset=utf-8;base64,77u/YTtiDQo=",
  });
}

/** Abre os clientes (por omissão em `/gestao/mais/clientes`) e espera o primeiro `GET`. */
export async function abrirClientes(
  sessao: SessaoFalsa = sessaoFalsa(),
  opcoes: { estrito?: boolean; caminho?: string } = {},
): Promise<SessaoFalsa> {
  abrirEm(opcoes.caminho ?? "/gestao/mais/clientes");
  // O `<main id="conteudo">` é da moldura da gestão (F4-01), não do ecrã: aqui põe-se à volta.
  const ecra = (
    <ContextoDaSessao.Provider value={sessao}>
      <main id="conteudo">
        <ClientesGestao />
      </main>
    </ContextoDaSessao.Provider>
  );
  render(opcoes.estrito === true ? <StrictMode>{ecra}</StrictMode> : ecra);
  await assentar();
  return sessao;
}

export async function desmontarOEcra(): Promise<void> {
  const { cleanup } = await import("@testing-library/react");
  await act(async () => {
    cleanup();
    await Promise.resolve();
  });
}

export function principal(): HTMLElement {
  return screen.getByRole("main");
}

/** O `<h2>` da lista (não o de uma folha). */
export function h2(): HTMLElement {
  const todos = screen
    .getAllByRole("heading", { level: 2 })
    .filter((titulo) => titulo.closest("dialog") === null);
  if (todos.length !== 1) {
    throw new Error(`esperava um só <h2> fora das folhas e há ${String(todos.length)}`);
  }
  return todos[0] as HTMLElement;
}
export function haH2(): boolean {
  return screen.queryAllByRole("heading", { level: 2 }).some((t) => t.closest("dialog") === null);
}

export function ligacaoVoltar(): HTMLElement {
  return screen.getByRole("link", { name: T.voltar });
}

/** Os botões «Eliminar» dos itens (fora da folha), pela ordem do DOM. */
export function botoesEliminar(): HTMLElement[] {
  return screen
    .queryAllByRole("button", { name: T.eliminar })
    .filter((b) => b.closest("dialog") === null);
}

/** O `<li>` de cada item: o que contém um botão «Eliminar». */
export function itens(): HTMLElement[] {
  return botoesEliminar().map((b) => b.closest("li") as HTMLElement);
}

/** O nome de cada cliente, lido do elemento a que o «Eliminar» aponta (`aria-describedby`). */
export function nomesNaLista(): string[] {
  return botoesEliminar().map((b) => {
    const id = b.getAttribute("aria-describedby");
    const alvo = id === null ? null : document.getElementById(id);
    if (alvo === null) throw new Error("um «Eliminar» sem `aria-describedby` válido");
    return alvo.textContent ?? "";
  });
}

/** O «Eliminar» do item cujo nome é `nome` (falha alto se não há). */
export function eliminarDe(nome: string): HTMLElement {
  const i = nomesNaLista().indexOf(nome);
  const botao = botoesEliminar()[i];
  if (i < 0 || botao === undefined) throw new Error(`não há «Eliminar» para «${nome}»`);
  return botao;
}
export function haItemDe(nome: string): boolean {
  return nomesNaLista().includes(nome);
}
/** O `<li>` do cliente `nome`. */
export function itemDe(nome: string): HTMLElement {
  return eliminarDe(nome).closest("li") as HTMLElement;
}

/** O texto da lista inteira (a secção), fora das folhas. */
export function textoDaPagina(): string {
  return principal().textContent ?? "";
}

export function botaoExportar(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^(${T.exportar}|${T.aPreparar})$`) });
}
export function haBotaoExportar(): boolean {
  return (
    screen.queryAllByRole("button", { name: new RegExp(`^(${T.exportar}|${T.aPreparar})$`) })
      .length > 0
  );
}
export function botaoMostrarMais(): HTMLElement {
  return screen.getByRole("button", { name: T.mostrarMais });
}
export function haMostrarMais(): boolean {
  return screen.queryByRole("button", { name: T.mostrarMais }) !== null;
}
/** «A mostrar x de n.» (o `<p aria-live="polite">`), ou `null`. */
export function notaDeMostrar(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[aria-live="polite"]')).find((no) =>
      /^A mostrar \d+ de \d+\.$/.test((no.textContent ?? "").trim()),
    ) ?? null
  );
}

// A folha de eliminar --------------------------------------------------------

export function folhaDeEliminar(): HTMLElement {
  return screen.getByRole("dialog", { name: T.tituloDaFolha });
}
export function haFolhaDeEliminar(): boolean {
  return screen.queryByRole("dialog", { name: T.tituloDaFolha }) !== null;
}
export function confirmarEliminar(): HTMLElement {
  return within(folhaDeEliminar()).getByRole("button", {
    name: new RegExp(`^(${T.eliminar}|${T.aEliminar})$`),
  });
}
export function cancelarEliminar(): HTMLElement {
  return within(folhaDeEliminar()).getByRole("button", { name: T.cancelar });
}
export function fecharDaFolha(): HTMLElement {
  return within(folhaDeEliminar()).getByRole("button", { name: "Fechar" });
}
/** Abre a folha do cliente `nome`. */
export async function abrirFolhaDeEliminar(nome: string): Promise<HTMLElement> {
  await tocar(eliminarDe(nome));
  return folhaDeEliminar();
}
/** Abre a folha e confirma. */
export async function eliminar(nome: string): Promise<void> {
  await abrirFolhaDeEliminar(nome);
  await tocar(confirmarEliminar());
}

export function botaoTentarOutraVez(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^(${T.tentarOutraVez}|${T.aTentar})$`) });
}
export function haBotaoTentarOutraVez(): boolean {
  return (
    screen.queryAllByRole("button", { name: new RegExp(`^(${T.tentarOutraVez}|${T.aTentar})$`) })
      .length > 0
  );
}
