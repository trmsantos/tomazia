/**
 * Apoio dos testes de componente da moderação de fotos na gestão (F4-04): monta `GaleriaGestao`
 * com `src/lib/api/gestao-fotos.ts`, `obterGaleria`/`enviarFoto` de `src/lib/api/publico.ts` e
 * `reduzir()` fingidos, a sessão fingida e **o relógio preso** em `AGORA` (segunda-feira,
 * 2/11/2026, 10:00 em Lisboa). Falsifica `Date`, `setTimeout` e `clearTimeout`: o intervalo de
 * 700 ms contra o duplo toque, o aviso de 3 s e o prazo de 10 s / 30 s correm só com `avancar(ms)`.
 *
 * **Cada ficheiro de teste tem de fazer, ele próprio,** os três `vi.mock`:
 *
 * ```ts
 * vi.mock("../../../lib/api/gestao-fotos", async (importOriginal) => ({
 *   ...(await importOriginal<typeof import("../../../lib/api/gestao-fotos")>()),   // `enderecoDaImagem` é o a sério
 *   obterFilaDeModeracao: vi.fn(), aprovarFoto: vi.fn(), rejeitarFoto: vi.fn(),
 * }));
 * vi.mock("../../../lib/api/publico", async (importOriginal) => ({
 *   ...(await importOriginal<typeof import("../../../lib/api/publico")>()),
 *   obterGaleria: vi.fn(), enviarFoto: vi.fn(),
 * }));
 * vi.mock("../../../lib/imagens/reduzir", () => ({ reduzir: vi.fn() }));
 * ```
 *
 * ## Contrato do componente (`src/pages/gestao/galeria/GaleriaGestao.tsx`)
 *
 * ```tsx
 * export function GaleriaGestao(): ReactElement      // sem propriedades
 * ```
 *
 * Lê a sessão por `useSessaoDaGestao()` (`aoPerderSessao`). Chama a API sempre com `{ sinal }` no
 * último argumento: `obterFilaDeModeracao({sinal})`, `aprovarFoto(id, {sinal})`,
 * `rejeitarFoto(id, {sinal})`, `obterGaleria({sinal})` (a verificação), `enviarFoto(corpo, {sinal})`.
 * Desenha (a spec `docs/ecras/F4-04.md` prevalece; todo o texto vem de `TEXTOS`):
 *
 *  - `<h1 tabindex="-1">` `TEXTOS.titulo` e o botão `TEXTOS.enviarFoto` **em todos os estados**;
 *  - `<section aria-labelledby>` (`role="region"`) com o `<h2 tabindex="-1">`
 *    `TEXTOS.fotosAEsperaN(n)` (com a fila) ou `TEXTOS.fotosAEspera` (a carregar e vazio);
 *  - a foto atual: um `<img>` visível, `src` = `enderecoDaImagem(id)`, `alt` = `altDaFoto(...)`; a
 *    **seguinte**: um `<img hidden alt="" loading="eager">` com a sua `key`; a terceira não existe;
 *  - os botões «Rejeitar» e «Aprovar» (nomes **exatos**, só o verbo; `aria-disabled`, nunca
 *    `disabled`; `aria-describedby` para a linha «Enviada {quando}, por {nome}»);
 *  - a legenda (`TEXTOS.legendaNoSite` + o texto) só se há `descricao`; a linha de estado é um
 *    `<p role="status">` por baixo dos botões;
 *  - as folhas são `<dialog>` com o nome do seu título: `TEXTOS.tituloRejeitar`,
 *    `TEXTOS.tituloEnviar`, `TEXTOS.saidaTitulo`;
 *  - o único aviso da página é o `AvisoTemporario` («Feito.» / «Erro.» + a frase).
 *
 * Só para testes; nada em produção o importa.
 */
import { StrictMode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, vi, type Mock } from "vitest";

import * as api from "../lib/api/gestao-fotos";
import * as publico from "../lib/api/publico";
import * as imagens from "../lib/imagens/reduzir";
import { GaleriaGestao } from "../pages/gestao/galeria/GaleriaGestao";
import { INTERVALO_CONTRA_DUPLO_TOQUE_MS } from "../pages/gestao/galeria/estado-da-fila";
import { TEXTOS } from "../pages/gestao/galeria/textos";
import { ContextoDaSessao } from "../pages/gestao/SessaoDaGestao";
import { AGORA } from "./eventos";
import { abrirEm, erroSemResposta, filaDeTeste, type FotoPendente } from "./gestao";

export { AGORA, INTERVALO_CONTRA_DUPLO_TOQUE_MS, TEXTOS };

export const obterFalso = vi.mocked(api.obterFilaDeModeracao);
export const aprovarFalso = vi.mocked(api.aprovarFoto);
export const rejeitarFalso = vi.mocked(api.rejeitarFoto);
export const galeriaFalsa = vi.mocked(publico.obterGaleria);
export const enviarFalso = vi.mocked(publico.enviarFoto);
export const reduzirFalso = vi.mocked(imagens.reduzir);

export const scrollFalso = vi.fn();

afterEach(() => {
  vi.useRealTimers();
});

/** O JPEG «reduzido» que o `reduzir` fingido devolve por omissão. */
export const REDUZIDA = {
  estado: "reduzida",
  ficheiro: new Blob(["reduzida"], { type: "image/jpeg" }),
} as const;

/**
 * O que a API de verdade devolveria: uma cópia nova a cada `GET /gestao/fotos`. A galeria pública
 * fingida está vazia (ninguém foi aprovado). O relógio fica preso em `AGORA`.
 */
export function prepararApi(fila: readonly FotoPendente[] = filaDeTeste(3)): void {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: AGORA });
  for (const falso of [
    obterFalso,
    aprovarFalso,
    rejeitarFalso,
    galeriaFalsa,
    enviarFalso,
    reduzirFalso,
  ]) {
    falso.mockReset();
  }
  scrollFalso.mockReset();
  // O jsdom não tem `scrollIntoView`.
  Element.prototype.scrollIntoView = scrollFalso;
  obterFalso.mockImplementation(() => Promise.resolve({ fotos: structuredClone([...fila]) }));
  aprovarFalso.mockImplementation((id) => Promise.resolve({ id, estado: "aprovada" }));
  rejeitarFalso.mockImplementation((id) => Promise.resolve({ id, estado: "rejeitada" }));
  galeriaFalsa.mockResolvedValue({ fotos: [] });
  reduzirFalso.mockResolvedValue({ ...REDUZIDA });
  enviarFalso.mockResolvedValue({ estado: "pendente" });
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

/** Abre a galeria (por omissão em `/gestao/galeria`) e espera o primeiro `GET`. */
export async function abrirGaleria(
  sessao: SessaoFalsa = sessaoFalsa(),
  opcoes: { estrito?: boolean; caminho?: string } = {},
): Promise<SessaoFalsa> {
  abrirEm(opcoes.caminho ?? "/gestao/galeria");
  const ecra = (
    <ContextoDaSessao.Provider value={sessao}>
      <GaleriaGestao />
    </ContextoDaSessao.Provider>
  );
  render(opcoes.estrito === true ? <StrictMode>{ecra}</StrictMode> : ecra);
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

/**
 * Dois toques seguidos, como um duplo toque a sério: o React desenha entre o primeiro e o segundo
 * (cada toque é o seu próprio `act` síncrono), mas **nenhum pedido responde pelo meio** (não há
 * `await` de promessas entre eles). Um guarda que só vive no estado do React passa; um que não
 * existe, não.
 */
export async function tocarDuasVezes(elemento: HTMLElement): Promise<void> {
  act(() => {
    fireEvent.click(elemento);
  });
  act(() => {
    fireEvent.click(elemento);
  });
  await assentar();
}

/**
 * Espera, com tarefas do ciclo de eventos **a sério**, que `condicao` passe. O `waitFor` da
 * Testing Library **não serve aqui**: usa `setTimeout`, que o relógio simulado destes testes
 * apanha, e pendurava-se. Falha alto se a condição nunca passar.
 */
export async function esperarPor(condicao: () => boolean, oQue = "a condição"): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (condicao()) return;
    await umaTarefa();
  }
  if (!condicao()) throw new Error(`esperei por ${oQue} e nunca aconteceu`);
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Uma expressão que aceita a frase dentro de um texto maior (espaços = qualquer espaço). */
export function contem(texto: string): RegExp {
  return new RegExp(escapar(texto).replace(/ /g, "\\s"));
}

export function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}
/** O `<h2>` da fila (não o título de uma folha, que também é um `<h2>`). */
export function h2(): HTMLElement {
  const todos = screen
    .getAllByRole("heading", { level: 2 })
    .filter((titulo) => titulo.closest("dialog") === null);
  if (todos.length !== 1) {
    throw new Error(`esperava um só <h2> fora das folhas e há ${String(todos.length)}`);
  }
  return todos[0] as HTMLElement;
}

/** O botão «Enviar foto» **da página** (com a folha aberta há outro, dentro dela). */
export function botaoEnviarDaPagina(): HTMLElement {
  const todos = screen.getAllByRole("button", { name: TEXTOS.enviarFoto });
  const daPagina = todos.find((b) => b.closest("dialog") === null);
  if (daPagina === undefined) throw new Error("não há «Enviar foto» fora de uma folha");
  return daPagina;
}

export function botaoAprovar(): HTMLElement {
  return screen.getByRole("button", { name: TEXTOS.aprovar });
}
export function botaoRejeitar(): HTMLElement {
  return screen.getByRole("button", { name: TEXTOS.rejeitar });
}
export function haBotoesDeModerar(): boolean {
  return (
    screen.queryByRole("button", { name: TEXTOS.aprovar }) !== null ||
    screen.queryByRole("button", { name: TEXTOS.rejeitar }) !== null
  );
}

/** `aria-disabled="true"`: o botão está inerte (nunca `disabled`: o foco não cai). */
export function inerte(elemento: HTMLElement): boolean {
  return elemento.getAttribute("aria-disabled") === "true";
}

export function botao(nome: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: nome });
}
export function haBotao(nome: string | RegExp): boolean {
  return screen.queryByRole("button", { name: nome }) !== null;
}

export function folha(nome?: string): HTMLElement {
  return nome === undefined
    ? screen.getByRole("dialog")
    : screen.getByRole("dialog", { name: nome });
}
export function haFolha(nome: string): boolean {
  return screen.queryByRole("dialog", { name: nome }) !== null;
}

// ---------------------------------------------------------------------------
// As imagens
// ---------------------------------------------------------------------------

/** Todos os `<img>` fora das folhas, pela ordem do DOM. */
export function imagensDaPagina(): HTMLImageElement[] {
  return Array.from(document.querySelectorAll("img")).filter((i) => i.closest("dialog") === null);
}

/** O `<img>` da foto atual: o visível (não `hidden`). */
export function imgAtual(): HTMLImageElement {
  const visiveis = imagensDaPagina().filter((i) => !i.hidden);
  if (visiveis.length !== 1) {
    throw new Error(`esperava uma só imagem visível e há ${String(visiveis.length)}`);
  }
  return visiveis[0] as HTMLImageElement;
}
export function haImgAtual(): boolean {
  return imagensDaPagina().some((i) => !i.hidden);
}

/** Os `<img hidden>` (a pré-carregada). */
export function imgsOcultas(): HTMLImageElement[] {
  return imagensDaPagina().filter((i) => i.hidden);
}

/** O `id` da foto, lido do endereço da imagem (`/api/gestao/fotos/{id}/imagem`). */
export function idDaImagem(img: HTMLImageElement): number | null {
  const m = /\/gestao\/fotos\/(\d+)\/imagem$/.exec(img.getAttribute("src") ?? "");
  return m?.[1] === undefined ? null : Number(m[1]);
}

/** Os ids de todas as imagens da página, pela ordem do DOM. */
export function idsDasImagens(): Array<number | null> {
  return imagensDaPagina().map(idDaImagem);
}

export async function carregarImagem(img: HTMLImageElement): Promise<void> {
  await act(async () => {
    fireEvent.load(img);
    await Promise.resolve();
  });
  await assentar();
}

export async function falharImagem(img: HTMLImageElement): Promise<void> {
  await act(async () => {
    fireEvent.error(img);
    await Promise.resolve();
  });
  await assentar();
}

/**
 * Deixa a foto atual pronta a moderar: a imagem carrega e passa o intervalo contra o duplo toque.
 * É o que um dono que olhou para a foto faz antes de tocar.
 */
export async function prontaParaModerar(): Promise<void> {
  await carregarImagem(imgAtual());
  await avancar(INTERVALO_CONTRA_DUPLO_TOQUE_MS);
}

// ---------------------------------------------------------------------------
// O aviso, a linha de estado
// ---------------------------------------------------------------------------

/** O aviso temporário atual (sucesso é `status`, erro é `alert`), ou `null`. */
export function aviso(): HTMLElement | null {
  const candidatos = Array.from(
    document.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  return candidatos.find((no) => /^\s*(Feito|Erro)\./.test(no.textContent ?? "")) ?? null;
}

/** A linha de estado (`<p role="status">`) que diz `texto`, ou `null`. Nunca o aviso. */
export function linhaDeEstado(texto: string): HTMLElement | null {
  const el = screen.queryByText(texto);
  if (el === null) return null;
  return el.closest('[role="status"], [role="alert"]');
}

/** O que a fila fingida devolveria sem a foto `id` (outro aparelho moderou-a). */
export function filaSem(...ids: number[]): FotoPendente[] {
  return filaDeTeste(5).filter((f) => !ids.includes(f.id));
}

/**
 * Um pedido que nunca responde **mas obedece ao prazo**: quando o `sinal` aborta (o `armarPrazo`
 * de 10 s, ou os 30 s do envio), rejeita como o cliente a sério o faria — `ErroDaApi` com
 * `estado: null`. Serve para provar que o prazo está ligado: `avancar(10_000)` e a frase de
 * «sem resposta» aparece.
 */
export function ficarPendenteAteAbortar(...args: unknown[]): Promise<never> {
  // O `{ sinal }` é sempre o último argumento (`obterFilaDeModeracao({sinal})`, `aprovarFoto(id, {sinal})`, …).
  const opcoes = args.at(-1) as { sinal?: AbortSignal } | undefined;
  return new Promise((_cumprir, falhar) => {
    opcoes?.sinal?.addEventListener("abort", () => {
      falhar(erroSemResposta());
    });
  });
}

// ---------------------------------------------------------------------------
// A folha de enviar uma foto do dono
// ---------------------------------------------------------------------------

/** Um `File` falso — o conteúdo não importa, `reduzir()` está sempre fingido. */
export function ficheiroFalso(nome = "foto-do-bar.jpg"): File {
  return new File([Uint8Array.from([1, 2, 3])], nome, { type: "image/jpeg" });
}

/** Deixa correr uma tarefa do ciclo de eventos de verdade (o `FileReader` do jsdom precisa). */
async function umaTarefa(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolver) => {
      setImmediate(resolver);
    });
  });
}

/** Abre a folha «Enviar foto» pelo botão da página. */
export async function abrirFolhaDeEnviar(): Promise<HTMLElement> {
  await tocar(botaoEnviarDaPagina());
  return folha(TEXTOS.tituloEnviar);
}

export function campoDaFoto(): HTMLInputElement {
  return within(folha(TEXTOS.tituloEnviar)).getByLabelText(/^Foto/) as HTMLInputElement;
}
export function campoDaLegenda(): HTMLInputElement | HTMLTextAreaElement {
  return within(folha(TEXTOS.tituloEnviar)).getByLabelText(TEXTOS.etiquetaLegenda);
}
/** O botão «Enviar foto» **da folha** (não o da página). */
export function botaoEnviarDaFolha(): HTMLElement {
  return within(folha(TEXTOS.tituloEnviar)).getByRole("button", { name: TEXTOS.enviar });
}
export function botaoCancelarDaFolha(): HTMLElement {
  return within(folha(TEXTOS.tituloEnviar)).getByRole("button", { name: TEXTOS.cancelar });
}

/** A pré-visualização: o `<img>` dentro da folha de enviar, ou `null`. */
export function previa(): HTMLImageElement | null {
  return folha(TEXTOS.tituloEnviar).querySelector("img");
}

/** Escolhe um ficheiro no campo «Foto» e espera que a redução e a pré-visualização assentem. */
export async function escolherFoto(ficheiro: File = ficheiroFalso()): Promise<void> {
  await act(async () => {
    fireEvent.change(campoDaFoto(), { target: { files: [ficheiro] } });
    await Promise.resolve();
  });
  await assentar();
  for (let i = 0; i < 10 && previa() === null; i += 1) await umaTarefa();
  await assentar();
}

/** Escolhe um ficheiro mas **não** espera pela pré-visualização (a redução fica pendente). */
export async function escolherFotoSemEsperar(ficheiro: File = ficheiroFalso()): Promise<void> {
  await act(async () => {
    fireEvent.change(campoDaFoto(), { target: { files: [ficheiro] } });
    await Promise.resolve();
  });
  await assentar();
}

export function escreverLegenda(texto: string): void {
  fireEvent.change(campoDaLegenda(), { target: { value: texto } });
}

/** O último `FormData` entregue ao `enviarFoto` fingido. */
export function corpoEnviado(n = -1): FormData {
  const chamada = enviarFalso.mock.calls.at(n);
  const corpo = chamada?.[0];
  if (!(corpo instanceof FormData)) throw new Error("o `enviarFoto` não recebeu um FormData");
  return corpo;
}

/** Tudo o que não existe nesta tarefa. */
export const PROIBIDOS_DA_F4_04 = /desfazer|aprovadas|eliminar foto|retirar|em lote/i;

export { within };
