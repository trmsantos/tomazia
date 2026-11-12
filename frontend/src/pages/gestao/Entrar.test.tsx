/**
 * F4-01, secção 3 (e 12) — o ecrã de login, com o cliente da API fingido.
 *
 * Contrato (`src/pages/gestao/Entrar.tsx`):
 *
 * ```tsx
 * export function Entrar(): ReactElement      // sem propriedades
 * ```
 *
 * Fala com `entrar` e `quemSouEu` de `src/lib/api/auth.ts` (fingidos aqui) e
 * navega com `navegar` de `./navegacao` — que **não** se finge: o que se
 * observa é o histórico a sério do jsdom (`replaceState`, `location.pathname`).
 * `entrar` é chamado como `entrar({ utilizador, password }, { sinal })`, com os
 * valores tal como foram escritos; o `sinal` é abortado ao desmontar.
 *
 * Ao montar, o formulário aparece **de imediato** e `quemSouEu()` corre uma vez
 * em segundo plano: 200 leva a `/gestao` (a substituir); 401 ou falha não mudam
 * nada no ecrã (3.8).
 *
 * Cinco desfechos do pedido, todos na mesma `<div id="login-mensagem"
 * tabindex="-1">` que recebe o foco (3.5-3.7). **Só o 400 marca os campos
 * `aria-invalid`.** O 429 acrescenta uma segunda linha com `tempoComposto` e
 * deixa o botão `aria-disabled` com um único `setTimeout` até ao prazo (o maior
 * de `segundos_em_falta` e `Retry-After`); sem número válido, só a primeira
 * linha e o botão utilizável.
 *
 * **Deixa passar:** os 44 px e o foco visível (CSS: e2e), a posição do dourado,
 * e o teclado do telemóvel.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entrar, quemSouEu } from "../../lib/api/auth";
import {
  FRASE_400,
  FRASE_429,
  SESSAO_DE_TESTE,
  TEXTOS_DA_GESTAO as T,
  abrirEm,
  erro400,
  erro401,
  erro429,
  erroDoServidor,
  erroSemResposta,
} from "../../testes/gestao";
import { Entrar } from "./Entrar";

vi.mock("../../lib/api/auth", () => ({ entrar: vi.fn(), quemSouEu: vi.fn(), sair: vi.fn() }));

const entrarFalso = vi.mocked(entrar);
const quemSouEuFalso = vi.mocked(quemSouEu);

type Pendente = {
  resolver: (valor: typeof SESSAO_DE_TESTE) => void;
  rejeitar: (erro: unknown) => void;
  sinal: AbortSignal | undefined;
};

/** Um `entrar` que só responde quando o teste mandar. */
function entrarPendente(): Pendente[] {
  const pedidos: Pendente[] = [];
  entrarFalso.mockImplementation((_dados, opcoes) => {
    return new Promise((cumprir, falhar) => {
      pedidos.push({ resolver: cumprir, rejeitar: falhar, sinal: opcoes?.sinal });
    });
  });
  return pedidos;
}

function campoUtilizador(): HTMLInputElement {
  return screen.getByLabelText(T.etiquetaUtilizador);
}
function campoPassword(): HTMLInputElement {
  return screen.getByLabelText(T.etiquetaPassword);
}
function botao(): HTMLElement {
  return screen.getByRole("button", { name: /^(Entrar|A entrar…)$/ });
}
function formulario(): HTMLFormElement {
  const encontrado = document.querySelector("form");
  if (encontrado === null) throw new Error("o ecrã não tem <form>");
  return encontrado;
}
function mensagem(): HTMLElement | null {
  return document.getElementById("login-mensagem");
}
function preencher(utilizador = "dono", password = "password-de-teste"): void {
  fireEvent.change(campoUtilizador(), { target: { value: utilizador } });
  fireEvent.change(campoPassword(), { target: { value: password } });
}

/** Clica em «Entrar» e deixa a promessa assentar. */
async function submeter(): Promise<void> {
  await act(async () => {
    fireEvent.click(botao());
    await Promise.resolve();
  });
}

/** Preenche, submete e rejeita o pedido com `erro`. */
async function falharCom(erro: unknown): Promise<void> {
  const pedidos = entrarPendente();
  preencher();
  await submeter();
  await act(async () => {
    pedidos[0]?.rejeitar(erro);
    await Promise.resolve();
  });
}

beforeEach(() => {
  abrirEm("/gestao/entrar");
  entrarFalso.mockReset();
  quemSouEuFalso.mockReset();
  quemSouEuFalso.mockRejectedValue(erro401());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("o que se vê ao chegar", () => {
  it("o nome do bar, o <h1> e os dois campos com a etiqueta certa", () => {
    render(<Entrar />);

    expect(screen.getByText(T.nomeDoBar)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: T.tituloDoLogin })).toBeInTheDocument();
    expect(campoUtilizador()).toBeInTheDocument();
    expect(campoPassword()).toBeInTheDocument();
    expect(botao()).toHaveTextContent(T.botaoEntrar);
  });

  it("os campos: type, name, autocomplete, teclado e required", () => {
    render(<Entrar />);

    expect(campoUtilizador()).toHaveAttribute("type", "text");
    expect(campoUtilizador()).toHaveAttribute("name", "utilizador");
    expect(campoUtilizador()).toHaveAttribute("autocomplete", "username");
    expect(campoUtilizador()).toHaveAttribute("autocapitalize", "none");
    expect(campoUtilizador()).toHaveAttribute("autocorrect", "off");
    expect(campoUtilizador()).toHaveAttribute("spellcheck", "false");
    expect(campoUtilizador()).toBeRequired();

    expect(campoPassword()).toHaveAttribute("type", "password");
    expect(campoPassword()).toHaveAttribute("name", "password");
    expect(campoPassword()).toHaveAttribute("autocomplete", "current-password");
    expect(campoPassword()).toBeRequired();
  });

  it("o <form> é method=post, sem action, com noValidate, só dois campos e o botão por último", () => {
    render(<Entrar />);
    const f = formulario();

    expect(f).toHaveAttribute("method", "post");
    expect(f).not.toHaveAttribute("action");
    expect(f).toHaveAttribute("novalidate");
    expect(f.querySelectorAll("input")).toHaveLength(2);
    expect(f.querySelector("input[type=hidden]")).toBeNull();

    const ordem = [...f.querySelectorAll("input, button")].map((elemento) =>
      elemento.tagName === "BUTTON" ? "botao" : elemento.getAttribute("name"),
    );
    expect(ordem).toEqual(["utilizador", "password", "botao"]);
    expect(botao()).toHaveAttribute("type", "submit");
  });

  it("sem autofocus: nenhum campo tem o foco", () => {
    render(<Entrar />);
    expect(document.activeElement).toBe(document.body);
  });

  it("não há «Mostrar password», «Lembrar-me» nem «Esqueci-me»", () => {
    render(<Entrar />);
    expect(screen.queryByText(/mostrar|lembrar|esqueci/i)).toBeNull();
  });
});

describe("já com sessão, ou sem ela", () => {
  it("o formulário aparece de imediato e quemSouEu corre uma vez, em segundo plano", () => {
    quemSouEuFalso.mockReturnValue(new Promise(() => undefined));
    render(<Entrar />);

    expect(botao()).toBeInTheDocument();
    expect(quemSouEuFalso).toHaveBeenCalledTimes(1);
    expect(entrarFalso).not.toHaveBeenCalled();
  });

  it("200 do /auth/eu: segue para /gestao, a substituir", async () => {
    quemSouEuFalso.mockResolvedValue(SESSAO_DE_TESTE);
    const substituir = vi.spyOn(window.history, "replaceState");
    const empurrar = vi.spyOn(window.history, "pushState");

    render(<Entrar />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/gestao");
    });
    expect(substituir).toHaveBeenCalled();
    expect(empurrar).not.toHaveBeenCalled();
  });

  it.each([
    ["401", erro401()],
    ["sem resposta", erroSemResposta()],
    ["500", erroDoServidor(500)],
  ])("%s do /auth/eu: nada muda no ecrã", async (_nome, erro) => {
    quemSouEuFalso.mockRejectedValue(erro);
    render(<Entrar />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.location.pathname).toBe("/gestao/entrar");
    expect(mensagem()).toBeNull();
    expect(botao()).toBeInTheDocument();
  });
});

describe("campos vazios: recusados sem pedido (3.4)", () => {
  it("os dois vazios: zero pedidos, dois erros, foco no Utilizador", async () => {
    render(<Entrar />);
    await submeter();

    expect(entrarFalso).not.toHaveBeenCalled();
    expect(screen.getByText(T.erroUtilizadorVazio)).toBeInTheDocument();
    expect(screen.getByText(T.erroPasswordVazia)).toBeInTheDocument();
    expect(campoUtilizador()).toHaveAttribute("aria-invalid", "true");
    expect(campoPassword()).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(campoUtilizador());
  });

  it("utilizador só com espaços conta como vazio", async () => {
    render(<Entrar />);
    preencher("   ", "password-de-teste");
    await submeter();

    expect(entrarFalso).not.toHaveBeenCalled();
    expect(screen.getByText(T.erroUtilizadorVazio)).toBeInTheDocument();
    expect(screen.queryByText(T.erroPasswordVazia)).toBeNull();
    expect(document.activeElement).toBe(campoUtilizador());
  });

  it("só a password vazia: um erro, foco na Password", async () => {
    render(<Entrar />);
    preencher("dono", "");
    await submeter();

    expect(entrarFalso).not.toHaveBeenCalled();
    expect(screen.queryByText(T.erroUtilizadorVazio)).toBeNull();
    expect(screen.getByText(T.erroPasswordVazia)).toBeInTheDocument();
    expect(campoUtilizador()).not.toHaveAttribute("aria-invalid");
    expect(document.activeElement).toBe(campoPassword());
  });

  it("cada erro limpa-se quando se começa a escrever no campo respetivo, e só nesse", async () => {
    render(<Entrar />);
    await submeter();

    fireEvent.change(campoUtilizador(), { target: { value: "d" } });

    expect(screen.queryByText(T.erroUtilizadorVazio)).toBeNull();
    expect(campoUtilizador()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText(T.erroPasswordVazia)).toBeInTheDocument();
  });

  it("uma password de espaços não é vazia (não se apara)", async () => {
    entrarPendente();
    render(<Entrar />);
    preencher("dono", "   ");
    await submeter();

    expect(entrarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("o pedido", () => {
  it("Enter no campo (submit do <form>) com tudo preenchido faz um pedido, com preventDefault", async () => {
    entrarPendente();
    render(<Entrar />);
    preencher();

    let seguiuOPadrao = true;
    await act(async () => {
      seguiuOPadrao = fireEvent.submit(formulario());
      await Promise.resolve();
    });

    expect(seguiuOPadrao, "o submit tem de levar preventDefault").toBe(false);
    expect(entrarFalso).toHaveBeenCalledTimes(1);
  });

  it("vai o que a pessoa escreveu, sem aparar nada", async () => {
    entrarPendente();
    render(<Entrar />);
    preencher("  dono  ", " segredo de teste ");
    await submeter();

    expect(entrarFalso.mock.calls[0]?.[0]).toEqual({
      utilizador: "  dono  ",
      password: " segredo de teste ",
    });
  });

  it("a carregar: «A entrar…», aria-busy e aria-disabled; os campos não ficam disabled nem readonly", async () => {
    entrarPendente();
    render(<Entrar />);
    preencher();
    await submeter();

    expect(botao()).toHaveTextContent(T.botaoAEntrar);
    expect(botao()).toHaveAttribute("aria-busy", "true");
    expect(botao()).toHaveAttribute("aria-disabled", "true");
    for (const campo of [campoUtilizador(), campoPassword()]) {
      expect(campo).not.toBeDisabled();
      expect(campo).not.toHaveAttribute("readonly");
    }
  });

  it("a carregar, outro clique e outro submit não repetem o pedido", async () => {
    entrarPendente();
    render(<Entrar />);
    preencher();
    await submeter();
    await submeter();
    await act(async () => {
      fireEvent.submit(formulario());
      await Promise.resolve();
    });

    expect(entrarFalso).toHaveBeenCalledTimes(1);
  });

  it("a mensagem anterior sai quando começa o pedido seguinte", async () => {
    await (async () => {
      render(<Entrar />);
      await falharCom(erro400());
    })();
    expect(mensagem()).toHaveTextContent(FRASE_400);

    entrarPendente();
    await submeter();

    expect(mensagem()).toBeNull();
    expect(screen.queryByText(FRASE_400)).toBeNull();
  });

  it("ao desmontar a meio, o pedido é cancelado", async () => {
    const pedidos = entrarPendente();
    const { unmount } = render(<Entrar />);
    preencher();
    await submeter();

    unmount();

    expect(pedidos[0]?.sinal?.aborted).toBe(true);
  });

  it("nem o utilizador nem a password vão parar a localStorage ou sessionStorage", async () => {
    render(<Entrar />);
    await falharCom(erro400());

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("sucesso (3.8)", () => {
  it("navega para /gestao a substituir a entrada — nunca a empurrar", async () => {
    const pedidos = entrarPendente();
    const substituir = vi.spyOn(window.history, "replaceState");
    const empurrar = vi.spyOn(window.history, "pushState");
    render(<Entrar />);
    preencher();
    await submeter();
    substituir.mockClear();

    await act(async () => {
      pedidos[0]?.resolver(SESSAO_DE_TESTE);
      await Promise.resolve();
    });

    expect(substituir).toHaveBeenCalledTimes(1);
    expect(substituir.mock.calls[0]?.[2]).toBe("/gestao");
    expect(empurrar).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/gestao");
  });
});

describe("400 — credenciais inválidas (3.5)", () => {
  it("a mensagem do backend aparece uma vez, no #login-mensagem, com tabindex -1 e o foco", async () => {
    render(<Entrar />);
    await falharCom(erro400());

    expect(screen.getAllByText(FRASE_400)).toHaveLength(1);
    expect(mensagem()).toHaveTextContent(FRASE_400);
    expect(mensagem()).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(mensagem());
    expect(screen.queryByRole("alert"), "sem role=alert: o foco já a faz ler").toBeNull();
  });

  it("os dois campos ficam aria-invalid e apontam para a mensagem; os valores ficam", async () => {
    render(<Entrar />);
    await falharCom(erro400());

    for (const campo of [campoUtilizador(), campoPassword()]) {
      expect(campo).toHaveAttribute("aria-invalid", "true");
      expect(campo.getAttribute("aria-describedby")?.split(/\s+/)).toContain("login-mensagem");
    }
    expect(campoUtilizador()).toHaveValue("dono");
    expect(campoPassword()).toHaveValue("password-de-teste");
  });

  it("a mensagem mantém-se enquanto se edita", async () => {
    render(<Entrar />);
    await falharCom(erro400());

    fireEvent.change(campoPassword(), { target: { value: "outra" } });

    expect(mensagem()).toHaveTextContent(FRASE_400);
  });

  it("o botão volta a ficar utilizável, sem aria-disabled nem aria-busy", async () => {
    render(<Entrar />);
    await falharCom(erro400());

    expect(botao()).toHaveTextContent(T.botaoEntrar);
    expect(botao()).not.toHaveAttribute("aria-disabled");
    expect(botao()).not.toHaveAttribute("aria-busy");
  });

  it("não há aviso de «última tentativa»: a quinta falha é igual às outras", async () => {
    render(<Entrar />);
    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      await falharCom(erro400());
    }
    expect(mensagem()?.textContent?.trim()).toBe(FRASE_400);
  });
});

describe("429 — conta bloqueada (3.6)", () => {
  it.each([
    [30, "menos de um minuto"],
    [60, "1 minuto"],
    [61, "2 minutos"],
    [119, "2 minutos"],
    [120, "2 minutos"],
    [125, "3 minutos"],
    [900, "15 minutos"],
  ])("segundos_em_falta %i: segunda linha «…daqui a %s.»", async (segundos, tempo) => {
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: segundos }));

    expect(mensagem()).toHaveTextContent(FRASE_429);
    expect(mensagem()).toHaveTextContent(`Podes tentar outra vez daqui a ${tempo}.`);
    expect(botao()).toHaveAttribute("aria-disabled", "true");
  });

  it("a frase do backend não é reescrita e o foco vai para a mensagem", async () => {
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: 125 }));

    expect(document.activeElement).toBe(mensagem());
    expect(mensagem()).toHaveAttribute("tabindex", "-1");
    expect(screen.getAllByText(FRASE_429)).toHaveLength(1);
  });

  it("os campos NÃO ficam aria-invalid (não foi o que escreveu)", async () => {
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: 125 }));

    expect(campoUtilizador()).not.toHaveAttribute("aria-invalid");
    expect(campoPassword()).not.toHaveAttribute("aria-invalid");
  });

  it("com Retry-After maior do que o corpo, usa-se o maior", async () => {
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: 65 }, { "retry-after": "600" }));

    expect(mensagem()).toHaveTextContent("Podes tentar outra vez daqui a 10 minutos.");
  });

  it("com o corpo maior do que o Retry-After, também o maior", async () => {
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: 600 }, { "retry-after": "65" }));

    expect(mensagem()).toHaveTextContent("Podes tentar outra vez daqui a 10 minutos.");
  });

  it("só com o Retry-After válido, usa-se esse", async () => {
    render(<Entrar />);
    await falharCom(erro429({}, { "retry-after": "125" }));

    expect(mensagem()).toHaveTextContent("Podes tentar outra vez daqui a 3 minutos.");
    expect(botao()).toHaveAttribute("aria-disabled", "true");
  });

  it.each([
    ["sem número nenhum", {}, {}],
    ["NaN", { segundos_em_falta: Number.NaN }, {}],
    ["Infinity", { segundos_em_falta: Number.POSITIVE_INFINITY }, {}],
    ["negativo", { segundos_em_falta: -5 }, {}],
    ["texto", { segundos_em_falta: "muito" }, {}],
    ["null", { segundos_em_falta: null }, {}],
    ["Retry-After ilegível", {}, { "retry-after": "daqui a pouco" }],
    ["Retry-After negativo", {}, { "retry-after": "-3" }],
  ])(
    "número em falta ou inválido (%s): só a primeira linha e o botão utilizável",
    async (_nome, extra, cabecalhos) => {
      render(<Entrar />);
      await falharCom(erro429(extra, cabecalhos));

      expect(mensagem()?.textContent?.trim(), "nunca «menos de um minuto» por omissão").toBe(
        FRASE_429,
      );
      expect(screen.queryByText(/Podes tentar outra vez/)).toBeNull();
      expect(botao()).not.toHaveAttribute("aria-disabled");
    },
  );

  it.each([
    ["segundos_em_falta enorme", { segundos_em_falta: 1e12 }, {}],
    ["Retry-After enorme", {}, { "retry-after": "99999999999" }],
  ])(
    "%s (um setTimeout acima de ~24,8 dias dispara logo): é inválido, só a primeira linha",
    async (_nome, extra, cabecalhos) => {
      vi.useFakeTimers(SO_OS_TEMPORIZADORES);
      render(<Entrar />);
      await falharCom(erro429(extra, cabecalhos));

      expect(mensagem()?.textContent?.trim()).toBe(FRASE_429);
      expect(botao()).not.toHaveAttribute("aria-disabled");
      expect(vi.getTimerCount(), "nenhum temporizador de bloqueio").toBe(0);
    },
  );

  it("sem número, um novo clique faz um novo pedido", async () => {
    render(<Entrar />);
    await falharCom(erro429({}));
    entrarFalso.mockClear();
    entrarPendente();

    await submeter();

    expect(entrarFalso).toHaveBeenCalledTimes(1);
  });
});

/**
 * Os dois testes que **contam** temporizadores só fingem os que o ecrã arma.
 *
 * Com `vi.useFakeTimers()` inteiro, o `vi.getTimerCount()` conta também o
 * `setImmediate` que o jsdom enfileira a cada `.focus()` (`Document._queueATask`):
 * medido, com a linha do foco comentada os dois testes passavam, e com ela
 * davam «2» e «1» — a frase do 429 **tem** de receber o foco (3.6), por isso o
 * teste original chumbava qualquer implementação certa. O que a especificação
 * proíbe é um intervalo e um segundo `setTimeout`; é isso que se conta.
 */
const SO_OS_TEMPORIZADORES: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
};

describe("429 — o prazo, com relógio falso", () => {
  async function bloqueado(segundos: number): Promise<void> {
    vi.useFakeTimers();
    render(<Entrar />);
    await falharCom(erro429({ segundos_em_falta: segundos }));
  }

  it("com o botão bloqueado, o clique e o Enter não chamam o cliente nem mudam a mensagem", async () => {
    await bloqueado(5);
    entrarFalso.mockClear();
    const antes = mensagem()?.textContent;

    await submeter();
    await act(async () => {
      fireEvent.submit(formulario());
      await Promise.resolve();
    });

    expect(entrarFalso).not.toHaveBeenCalled();
    expect(mensagem()?.textContent).toBe(antes);
  });

  it("passado o prazo, o botão volta sozinho e as duas linhas desaparecem — sem mexer no foco", async () => {
    await bloqueado(5);
    expect(botao()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_900);
    });
    expect(botao(), "ainda não passaram os 5 s").toHaveAttribute("aria-disabled", "true");
    expect(mensagem()).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(botao()).not.toHaveAttribute("aria-disabled");
    expect(mensagem()).toBeNull();
    expect(screen.queryByText(FRASE_429)).toBeNull();
    expect(screen.queryByText(/Podes tentar outra vez/)).toBeNull();
    expect(document.activeElement, "o foco não se move").not.toBe(botao());
  });

  it("um único temporizador, e nunca um setInterval", async () => {
    const intervalo = vi.spyOn(globalThis, "setInterval");
    vi.useFakeTimers(SO_OS_TEMPORIZADORES);
    render(<Entrar />);
    const antes = vi.getTimerCount();

    await falharCom(erro429({ segundos_em_falta: 900 }));

    expect(vi.getTimerCount() - antes, "um setTimeout para o prazo").toBe(1);
    expect(intervalo).not.toHaveBeenCalled();
  });

  it("depois do prazo, um 429 novo substitui o prazo anterior", async () => {
    await bloqueado(5);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });

    const pedidos = entrarPendente();
    await submeter();
    await act(async () => {
      pedidos[0]?.rejeitar(erro429({ segundos_em_falta: 600 }));
      await Promise.resolve();
    });

    expect(mensagem()).toHaveTextContent("Podes tentar outra vez daqui a 10 minutos.");
    expect(botao()).toHaveAttribute("aria-disabled", "true");
  });

  it("ao desmontar, o temporizador sai", async () => {
    vi.useFakeTimers(SO_OS_TEMPORIZADORES);
    const { unmount } = render(<Entrar />);
    const antes = vi.getTimerCount();
    await falharCom(erro429({ segundos_em_falta: 900 }));

    unmount();

    expect(vi.getTimerCount()).toBeLessThanOrEqual(antes);
  });
});

describe("rede e 5xx (3.7): nunca a mensagem genérica do cliente, nunca «credenciais inválidas»", () => {
  it("sem resposta: a frase da ligação", async () => {
    render(<Entrar />);
    await falharCom(erroSemResposta());

    expect(mensagem()?.textContent?.trim()).toBe(T.semResposta);
    expect(screen.queryByText(/mensagem do cliente/)).toBeNull();
    expect(screen.queryByText(FRASE_400)).toBeNull();
  });

  it.each([500, 502, 503, 403, 422])("estado %i: a frase «o problema é nosso»", async (estado) => {
    render(<Entrar />);
    await falharCom(erroDoServidor(estado));

    expect(mensagem()?.textContent?.trim()).toBe(T.servidor);
    expect(screen.queryByText(/mensagem do cliente/)).toBeNull();
  });

  it("foco na mensagem, campos sem aria-invalid, valores mantidos, botão utilizável", async () => {
    render(<Entrar />);
    await falharCom(erroSemResposta());

    expect(document.activeElement).toBe(mensagem());
    expect(mensagem()).toHaveAttribute("tabindex", "-1");
    expect(campoUtilizador()).not.toHaveAttribute("aria-invalid");
    expect(campoPassword()).not.toHaveAttribute("aria-invalid");
    expect(campoUtilizador()).toHaveValue("dono");
    expect(campoPassword()).toHaveValue("password-de-teste");
    expect(botao()).not.toHaveAttribute("aria-disabled");
  });
});
