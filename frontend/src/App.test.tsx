/**
 * A página pública, de cima para baixo (F3-02, secção 2).
 *
 * Era o teste de fumo da F1-01 — "o `App` arranca e mostra o nome do bar" —
 * e passa a ser também o teste da **árvore** da página, que é a única coisa
 * que nenhum dos testes de componente pode afirmar: a hierarquia de títulos
 * `h1` → `h2` → `h3`, sem saltos e com um só `h1`.
 *
 * **O que este ficheiro prova:** que o `<h1>` existe e é único; que a
 * ementa é desenhada dentro de um `<main>`, sem nenhum toque; e que a
 * hierarquia de títulos não salta um nível.
 *
 * **O que deixa passar:** tudo o que é do ecrã da ementa —
 * `src/pages/publico/Ementa.test.tsx` trata disso. E a ordem visual, que em
 * jsdom não existe.
 *
 * Desde a F3-03 o `<h1>` vive dentro do cabeçalho fixo, e é de lá que ele
 * chega a esta árvore. Continua a ser um só e continua a ser o nome do bar.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import { INFO_SEM_REDE } from "./testes/cabecalho";
import { EMENTA_DE_TESTE, ID_DA_SECCAO, NOME_DO_BAR, TEXTOS_DA_EMENTA } from "./testes/ementa";
import { SEM_FOTOS, TEXTOS_DA_GALERIA } from "./testes/galeria";
import { instalarDeslocamento, instalarMatchMedia } from "./testes/jsdom-da-ementa";
import { obterEmenta, obterEventos, obterGaleria, obterInfo } from "./lib/api/publico";

/*
 * Desde a F3-03 o `App` pede duas coisas ao montar: a ementa e o `/info`, que
 * desce por propriedade até ao cabeçalho. O `obterInfo` tem de estar aqui —
 * uma fábrica de mock substitui o módulo inteiro, e uma exportação que falte
 * chega ao código como `undefined` em vez de dar erro no mock.
 *
 * `obterGaleria` chegou com a F3-05 (correção do Tomás, 6 de novembro de
 * 2026): a galeria entrou no `<App />`, a seguir aos eventos, e nunca
 * desaparece (F3-05, secção 2.1) — sem o mock, o `Galeria.tsx` chama um
 * `obterGaleria` que esta fábrica não definia, e `vitest` rebentava com
 * "No obterGaleria export is defined on the mock" assim que o componente
 * montava, muito antes de qualquer asserção deste ficheiro correr.
 */
vi.mock("./lib/api/publico", () => ({
  obterEmenta: vi.fn(),
  obterEventos: vi.fn(),
  obterGaleria: vi.fn(),
  obterInfo: vi.fn(),
}));

async function desenhar() {
  const deslocamento = instalarDeslocamento();
  const media = instalarMatchMedia();
  vi.mocked(obterEmenta).mockResolvedValue(EMENTA_DE_TESTE);
  vi.mocked(obterInfo).mockResolvedValue(INFO_SEM_REDE);
  /*
   * Sem eventos marcados: a secção da F3-04 não existe, e a árvore que este
   * ficheiro mede é a mesma de antes dela. O `mockResolvedValue` é
   * obrigatório e não higiene — um `vi.fn()` sem valor devolve `undefined`,
   * e o `.then` do componente rebenta dentro do efeito.
   */
  vi.mocked(obterEventos).mockResolvedValue({ eventos: [] });
  // Sem fotos aprovadas: o estado de lançamento da galeria (F3-05, 4.3).
  vi.mocked(obterGaleria).mockResolvedValue(SEM_FOTOS);

  const resultado = render(<App />);
  await screen.findByRole("navigation", { name: TEXTOS_DA_EMENTA.nomeDaBarra });
  // Espera a galeria assentar no estado vazio — sem isto, o teste da
  // hierarquia de títulos podia medir a árvore a meio da corrida, antes do
  // `<h3>Ainda não há fotos.</h3>` nascer, e passar sem ter visto a secção
  // inteira.
  await screen.findByRole("heading", { name: TEXTOS_DA_GALERIA.vazioTitulo });

  return {
    ...resultado,
    limpar() {
      deslocamento.restaurar();
      media.restaurar();
    },
  };
}

describe("a página pública", () => {
  it("mostra o nome do bar, uma vez só", async () => {
    const { limpar } = await desenhar();

    expect(screen.getByRole("heading", { name: NOME_DO_BAR, level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    limpar();
  });

  it("a ementa aparece sem nenhum toque, dentro do `main`", async () => {
    const { container, limpar } = await desenhar();

    const principal = container.querySelector("main");
    expect(principal, "a ementa é o conteúdo principal da página").not.toBeNull();
    expect(principal?.querySelector(`#${ID_DA_SECCAO}`)).not.toBeNull();
    expect(screen.getByText("Galão")).toBeInTheDocument();

    limpar();
  });

  it("os títulos vão de 1 a 3 sem saltar um nível", async () => {
    const { container, limpar } = await desenhar();

    const niveis = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((titulo) =>
      Number(titulo.tagName.slice(1)),
    );

    expect(niveis[0], "a página começa no h1").toBe(1);

    const saltos: string[] = [];
    niveis.forEach((nivel, indice) => {
      const anterior = niveis[indice - 1];
      if (anterior !== undefined && nivel > anterior + 1) {
        saltos.push(`h${String(anterior)} seguido de h${String(nivel)}`);
      }
    });

    expect(saltos, "sem saltos: h1 → h2 → h3 (F3-02, secção 2)").toEqual([]);

    limpar();
  });
});
