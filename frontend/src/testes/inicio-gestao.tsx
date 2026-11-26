/**
 * Apoio dos testes de componente de `InicioGestao` (F4-05b): monta o ecrã com
 * `src/lib/api/gestao-resumo.ts` fingido, a sessão fingida e o relógio preso em `AGORA`.
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** o `vi.mock`:
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-resumo", () => ({ obterResumo: vi.fn() }));
 * ```
 *
 * ## Contrato do componente (`src/pages/gestao/inicio/InicioGestao.tsx`)
 *
 * ```tsx
 * export function InicioGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê a sessão por `useSessaoDaGestao()`. Pede `obterResumo({ sinal })` **de cada vez que monta**
 * (sem cópia entre visitas) e outra vez a cada volta à aba. Desenha (spec `docs/ecras/F4-05b.md`
 * secção 4; o texto é o de `clientes-gestao-textos.ts`):
 *
 *  - **nenhum `<main>`**: é da moldura (F4-01); os testes montam o ecrã dentro de um `<main>`;
 *  - `<h1 tabindex="-1">` «Início»;
 *  - `<p role="status">` com a linha de estado, só se for o caso;
 *  - três `<section aria-labelledby>` (`role="region"`), nesta ordem, cada uma com o seu `<h2>`:
 *    «Fotos à espera» (a frase e, só com fotos, `<a href="/gestao/galeria">` «Ir para a fila de
 *    fotos» com o aspeto do `Botao` principal), «Próximos eventos» (`<ul>` de `<li>` com título e
 *    data, **sem ligações dentro**, e **uma** `<a href="/gestao/eventos">` «Ver os eventos») e
 *    «Novos registos» (a frase e `<a href="/gestao/mais/clientes">` «Ver os clientes»);
 *  - o esqueleto: elementos `aria-busy="true"` **sem texto**, sem botões nem ligações;
 *  - `EstadoVazio tom="erro"` e o botão «Tentar outra vez» (sem as três secções).
 *
 * Só para testes; nada em produção o importa.
 */
import { StrictMode } from "react";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import * as api from "../lib/api/gestao-resumo";
import { InicioGestao } from "../pages/gestao/inicio/InicioGestao";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import { resumoDeTeste, type RespostaResumo } from "./clientes-dados";
import { TEXTOS_INICIO as T } from "./clientes-gestao-textos";
import { assentar, prenderORelogio, sessaoFalsa, type SessaoFalsa } from "./comum-gestao";
import { abrirEm } from "./gestao";

export * from "./comum-gestao";
export { T, within };
export type { RespostaResumo };

export const resumoFalso = vi.mocked(api.obterResumo);

export function prepararApi(resumo: RespostaResumo = resumoDeTeste()): void {
  prenderORelogio();
  resumoFalso.mockReset();
  resumoFalso.mockImplementation(() => Promise.resolve(structuredClone(resumo)));
}

export async function abrirInicio(
  sessao: SessaoFalsa = sessaoFalsa(),
  opcoes: { estrito?: boolean } = {},
): Promise<SessaoFalsa> {
  abrirEm("/gestao");
  // O `<main id="conteudo">` é da moldura da gestão (F4-01), não do ecrã: aqui põe-se à volta.
  const ecra = (
    <ContextoDaSessao.Provider value={sessao}>
      <main id="conteudo">
        <InicioGestao />
      </main>
    </ContextoDaSessao.Provider>
  );
  render(opcoes.estrito === true ? <StrictMode>{ecra}</StrictMode> : ecra);
  await assentar();
  return sessao;
}

export function principal(): HTMLElement {
  return screen.getByRole("main", { hidden: true }) as HTMLElement;
}

/** As três secções (`role="region"`), pela ordem do DOM. */
export function seccoes(): HTMLElement[] {
  return screen.queryAllByRole("region");
}
export function seccao(titulo: string): HTMLElement {
  return screen.getByRole("region", { name: titulo });
}
export function h2s(): HTMLElement[] {
  return screen.queryAllByRole("heading", { level: 2 });
}

/** A ligação «Ir para a fila de fotos» (ou `null`: só existe com fotos à espera). */
export function ligacaoDasFotos(): HTMLElement | null {
  return screen.queryByRole("link", { name: T.irParaAFila });
}
export function ligacaoDosEventos(): HTMLElement {
  return screen.getByRole("link", { name: T.verOsEventos });
}
export function ligacaoDosClientes(): HTMLElement {
  return screen.getByRole("link", { name: T.verOsClientes });
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
