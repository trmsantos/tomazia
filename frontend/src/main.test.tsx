/**
 * F4-01 — o que o `main.tsx` decide, uma vez, ao arrancar (plano, «Rotas e
 * carregamento»).
 *
 *  - `/gestao`, `/gestao/…` -> `import("./pages/gestao/AppGestao")`, dinâmico, com
 *    o ecrã «A abrir a gestão…» enquanto o ficheiro vem e um erro («Não consegui
 *    abrir a gestão.» + «Tentar outra vez») se não vier;
 *  - tudo o resto (`/`, `/gestaoX`, `/qualquer`) -> o `App` público, importado
 *    estaticamente como hoje, **sem tocar** no módulo da gestão.
 *
 * O `main.tsx` não exporta nada: o teste importa-o com `#root` e o endereço
 * postos e olha para o DOM. `App` e `AppGestao` são fingidos por marcas.
 *
 * «Tentar outra vez» tem de refazer o `import()` e não reutilizar a promessa
 * rejeitada (é o que o `React.lazy` faria): o teste falha o primeiro carregamento
 * e deixa passar o segundo.
 *
 * **Deixa passar:** o chunk a sério — é `orcamento-q02.test.ts` e o e2e.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TEXTOS_DA_GESTAO as T, abrirEm } from "./testes/gestao";

const estado = vi.hoisted(() => ({
  carregamentos: 0,
  falhar: false,
  portao: null as Promise<void> | null,
}));

vi.mock("./App", () => ({ default: () => <p>MARCA DO APP PUBLICO</p> }));

/**
 * O módulo da gestão fingido, registado com `vi.doMock` **a cada arranque** e
 * não com um `vi.mock` no topo.
 *
 * O `vi.resetModules()` não limpa o registo dos fingimentos: com um `vi.mock`
 * a fábrica corria uma só vez e o resultado ficava em cache entre testes, por
 * isso o contador de carregamentos só contava no primeiro caso e uma fábrica
 * que lança deixava de lançar nos seguintes (medido: «0 para 1» e o erro nunca
 * aparecia). Cada arranque regista a fábrica de novo, e é o que faz de cada
 * teste um carregamento a sério.
 */
function fingirAGestao(): void {
  vi.doMock("./pages/gestao/AppGestao", async () => {
    estado.carregamentos += 1;
    if (estado.portao !== null) await estado.portao;
    if (estado.falhar) throw new Error("o chunk não chegou");
    return { default: () => <p>MARCA DO APP DA GESTAO</p> };
  });
}

async function arrancar(caminho: string): Promise<void> {
  abrirEm(caminho);
  document.body.innerHTML = '<div id="root"></div>';
  vi.resetModules();
  fingirAGestao();
  await import("./main");
}

beforeEach(() => {
  estado.carregamentos = 0;
  estado.falhar = false;
  estado.portao = null;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("o público abre o App público e nunca carrega a gestão", () => {
  it.each(["/", "/gestaoX", "/gestao-antiga", "/qualquer", "/ementa"])("%s", async (caminho) => {
    await arrancar(caminho);

    expect(await screen.findByText("MARCA DO APP PUBLICO")).toBeInTheDocument();
    expect(screen.queryByText("MARCA DO APP DA GESTAO")).toBeNull();
    expect(estado.carregamentos, "o módulo da gestão não pode ser pedido").toBe(0);
  });
});

describe("a gestão abre o AppGestao, carregado à parte", () => {
  it.each(["/gestao", "/gestao/", "/gestao/entrar", "/gestao/ementa"])("%s", async (caminho) => {
    await arrancar(caminho);

    expect(await screen.findByText("MARCA DO APP DA GESTAO")).toBeInTheDocument();
    expect(screen.queryByText("MARCA DO APP PUBLICO")).toBeNull();
    expect(estado.carregamentos).toBe(1);
  });

  it("enquanto o ficheiro vem: «A abrir a gestão…» em role=status, sem botões", async () => {
    let abrirPortao: () => void = () => undefined;
    estado.portao = new Promise<void>((cumprir) => {
      abrirPortao = cumprir;
    });

    await arrancar("/gestao/ementa");

    const aAbrir = await screen.findByRole("status");
    expect(aAbrir).toHaveTextContent(T.nomeDoBar);
    expect(aAbrir).toHaveTextContent(T.aAbrir);
    expect(screen.queryByRole("button")).toBeNull();

    abrirPortao();
    expect(await screen.findByText("MARCA DO APP DA GESTAO")).toBeInTheDocument();
    expect(screen.queryByText(T.aAbrir)).toBeNull();
  });

  it("se o ficheiro não chega: o erro de rede da guarda, nunca o login nem o App público", async () => {
    estado.falhar = true;
    await arrancar("/gestao");

    expect(await screen.findByText(T.erroDaGuardaTitulo)).toBeInTheDocument();
    expect(screen.getByText(T.erroDaGuardaSemResposta)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: T.tentarOutraVez })).toBeInTheDocument();
    expect(screen.queryByText("MARCA DO APP PUBLICO")).toBeNull();
    expect(screen.queryByRole("link", { name: /entrar/i })).toBeNull();
    expect(window.location.pathname).toBe("/gestao");
  });

  it("«Tentar outra vez» refaz o import() e, com a rede de volta, abre a gestão", async () => {
    estado.falhar = true;
    await arrancar("/gestao");
    await screen.findByText(T.erroDaGuardaTitulo);
    const antes = estado.carregamentos;
    estado.falhar = false;

    fireEvent.click(screen.getByRole("button", { name: T.tentarOutraVez }));

    expect(await screen.findByText("MARCA DO APP DA GESTAO")).toBeInTheDocument();
    expect(estado.carregamentos, "um segundo import(), não a promessa rejeitada").toBeGreaterThan(
      antes,
    );
    await waitFor(() => {
      expect(screen.queryByText(T.erroDaGuardaTitulo)).toBeNull();
    });
  });
});
