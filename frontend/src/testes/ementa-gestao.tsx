/**
 * Apoio dos testes de componente da ementa na gestão (F4-02): monta o destino
 * `EmentaGestao` com `src/lib/api/gestao-ementa.ts` fingido e a sessão fingida.
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** o `vi.mock` do módulo da
 * API (o `vi.mock` só se iça dentro do ficheiro que o escreve):
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-ementa", () => ({
 *   obterEmentaGestao: vi.fn(), criarProduto: vi.fn(),
 *   alterarProduto: vi.fn(), reordenarProdutos: vi.fn(),
 * }));
 * ```
 *
 * Contrato do componente (`src/pages/gestao/ementa/EmentaGestao.tsx`):
 *
 * ```tsx
 * export function EmentaGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê o endereço (`/gestao/ementa?categoria=<slug>`), a sessão por
 * `useSessaoDaGestao()` (`aoPerderSessao`), e desenha o `<h1>` «Ementa»
 * (`tabindex="-1"`), a pesquisa, os chips, uma categoria de cada vez e o único
 * `AvisoTemporario` da página. As chamadas à API levam sempre `{ sinal }` como
 * último argumento.
 *
 * Só para testes; nada em produção o importa.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";

import * as api from "../lib/api/gestao-ementa";
import { EmentaGestao } from "../pages/gestao/ementa/EmentaGestao";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import { abrirEm, ementaDeGestaoDeTeste, type RespostaEmentaGestao } from "./gestao";

export const obterFalso = vi.mocked(api.obterEmentaGestao);
export const criarFalso = vi.mocked(api.criarProduto);
export const alterarFalso = vi.mocked(api.alterarProduto);
export const reordenarFalso = vi.mocked(api.reordenarProdutos);

/** O que a API de verdade devolveria: uma cópia nova a cada `GET`. */
export function prepararApi(ementa: RespostaEmentaGestao = ementaDeGestaoDeTeste()): void {
  obterFalso.mockReset();
  criarFalso.mockReset();
  alterarFalso.mockReset();
  reordenarFalso.mockReset();
  obterFalso.mockImplementation(() => Promise.resolve(structuredClone(ementa)));
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

/** Abre o destino em `caminho` (com `?categoria=` se quiser) e espera o primeiro `GET`. */
export async function abrirEmenta(caminho = "/gestao/ementa"): Promise<SessaoFalsa> {
  abrirEm(caminho);
  const sessao: SessaoFalsa = {
    aoPerderSessao: vi.fn<() => void>(),
    aoConfirmarSessao: vi.fn<() => void>(),
  };
  render(
    <ContextoDaSessao.Provider value={sessao}>
      <EmentaGestao />
    </ContextoDaSessao.Provider>,
  );
  await assentar();
  return sessao;
}

/** Em pedidos ao servidor: o último argumento é sempre `{ sinal }`. */
export const comSinal = expect.objectContaining({ sinal: expect.any(AbortSignal) as unknown });

export function secao(nomeDaCategoria: string): HTMLElement {
  return screen.getByRole("region", { name: nomeDaCategoria });
}

/** A `<li>` do produto: o botão do nome (exato) está lá dentro. */
export function linhaDe(nome: string): HTMLElement {
  const li = screen.getByRole("button", { name: nome }).closest("li");
  if (li === null) throw new Error(`«${nome}» não está dentro de uma <li>`);
  return li;
}

/** O nome acessível do botão do preço (o espaço antes do «€» pode ser U+00A0). */
export function nomeDoBotaoDoPreco(nome: string, preco: string): RegExp {
  const escapado = `Alterar o preço de ${nome}, agora ${preco}`
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s");
  return new RegExp(`^${escapado}$`);
}

export function botaoDoPreco(nome: string, preco: string): HTMLElement {
  return screen.getByRole("button", { name: nomeDoBotaoDoPreco(nome, preco) });
}

export function campoDoPreco(): HTMLInputElement {
  return screen.getByLabelText("Preço, em euros");
}

/** Abre a edição do preço, escreve `texto` e toca em «Guardar». Não espera. */
export function escreverPreco(texto: string): void {
  fireEvent.change(campoDoPreco(), { target: { value: texto } });
}

export async function guardarPreco(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^(Guardar|A guardar…)$/ }));
    await Promise.resolve();
  });
  await assentar();
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
  return el === null ? null : within(el).queryByRole("button", { name: "Desfazer" });
}

export async function tocar(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(elemento);
    await Promise.resolve();
  });
  await assentar();
}

/** Tudo o que há de controlos de categorias ou de eliminar — não existe na F4-02. */
export const PROIBIDOS_DA_F4_02 =
  /nova categoria|criar categoria|renomear|esconder|mostrar categoria|editar categoria|eliminar|apagar|remover produto|tem a certeza/i;
