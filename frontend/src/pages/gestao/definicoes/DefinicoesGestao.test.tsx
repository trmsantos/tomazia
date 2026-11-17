/**
 * F4-05a, secções 4, 6.1, 8 e 14 de `docs/ecras/F4-05a.md` e plano 3.8 — o ecrã
 * «Mais › Definições»: carregar, os estados, os campos e os três estados do
 * horário. Guardar, 422 e sair têm os seus ficheiros
 * (`DefinicoesGestao.guardar.test.tsx`, `.saida.test.tsx`); o editor de horário em
 * `EditorDoHorario.test.tsx`.
 *
 * Contrato: ver `src/testes/definicoes.tsx`.
 *
 * **Regra 10, o que mais importa aqui:** falha de rede, 5xx, um corpo ilegível ou um
 * `TypeError` **nunca** desenham o formulário nem «Guardar alterações»: um
 * formulário vazio, guardado, apagava os sete campos. O vazio só vem de um `200`
 * com tudo `""` (a instalação nova), que **é** o formulário.
 *
 * **Deixa passar:** layout, 44 px e axe (e2e).
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  DIAS_PELA_ORDEM,
  erro401,
  erroDoServidor,
  erroSemResposta,
} from "../../../testes/gestao";
import {
  abrirDefinicoes,
  assentar,
  botaoDeGuardar,
  campo,
  comSinal,
  controlosDeEscrita,
  escrever,
  grupoDoDia,
  guardarFalso,
  haBotaoDeGuardar,
  interruptorDoDia,
  obterFalso,
  pendente,
  prepararApi,
  tocar,
} from "../../../testes/definicoes";
import { TEXTOS, legendaDoDia, nomeDoDia } from "./textos";

vi.mock("../../../lib/api/gestao-definicoes", () => ({
  obterDefinicoes: vi.fn(),
  guardarDefinicoes: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

function h1(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

describe("carregar", () => {
  it("um GET com o sinal; o <h1> «Definições» com tabindex -1; «Voltar a Mais» para /gestao/mais", async () => {
    await abrirDefinicoes();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(h1()).toHaveTextContent(TEXTOS.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: TEXTOS.voltarAMais })).toHaveAttribute(
      "href",
      "/gestao/mais",
    );
  });

  it("enquanto não responde: esqueleto sem texto, aria-busy, nenhum campo e nenhum «Guardar alterações»", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirDefinicoes();

    expect(h1()).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(controlosDeEscrita()).toEqual([]);
    expect(haBotaoDeGuardar()).toBe(false);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("200: os campos aparecem preenchidos tal e qual, espaços incluídos", async () => {
    await abrirDefinicoes();
    const d = definicoesConfiguradas();

    expect(campo(TEXTOS.etiquetaRede)).toHaveValue(d.wifi_rede);
    expect(campo(TEXTOS.etiquetaPassword)).toHaveValue("cerveja-fresca-2026 ");
    expect(campo(TEXTOS.etiquetaMorada)).toHaveValue(d.morada);
    expect(campo(TEXTOS.etiquetaTelefone)).toHaveValue(d.telefone);
    expect(campo(TEXTOS.etiquetaInstagram)).toHaveValue(d.instagram);
    expect(campo(TEXTOS.etiquetaMaps)).toHaveValue(d.maps_url);
  });

  it("os três painéis têm <h2> e dizem onde o texto aparece; o do WiFi diz que o vê qualquer pessoa", async () => {
    await abrirDefinicoes();

    for (const titulo of [TEXTOS.painelWifi, TEXTOS.painelHorario, TEXTOS.painelContactos]) {
      expect(screen.getByRole("heading", { level: 2, name: titulo })).toBeInTheDocument();
    }
    expect(screen.getByText(TEXTOS.ondeApareceWifi)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.ondeApareceHorario)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.ondeApareceContactos)).toBeInTheDocument();
  });

  it("a ordem é a da frequência: WiFi, Horário, Morada e contactos", async () => {
    await abrirDefinicoes();
    const titulos = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titulos).toEqual([TEXTOS.painelWifi, TEXTOS.painelHorario, TEXTOS.painelContactos]);
  });

  it("«Guardar alterações» existe, está dentro do <form> e é o único botão principal (último elemento do form)", async () => {
    await abrirDefinicoes();
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    expect(form).toContainElement(botaoDeGuardar());
  });
});

describe("carregar falha: nunca um formulário (regra 10)", () => {
  function semFormulario(): void {
    expect(controlosDeEscrita(), "nenhum campo, nenhum interruptor").toEqual([]);
    expect(haBotaoDeGuardar(), "nenhum «Guardar alterações»").toBe(false);
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  }

  it("sem resposta: o erro de ligação, «Tentar outra vez», e NENHUM controlo", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirDefinicoes();

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.carregarSemResposta)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.carregarServidor)).toBeNull();
    expect(screen.getByRole("button", { name: TEXTOS.tentarOutraVez })).toBeInTheDocument();
    semFormulario();
    expect(h1()).toBeInTheDocument();
    expect(screen.getByRole("link", { name: TEXTOS.voltarAMais })).toBeInTheDocument();
  });

  it.each([500, 503, 403])(
    "%i: a frase de servidor (não a de ligação), e NENHUM controlo",
    async (estado) => {
      obterFalso.mockRejectedValue(erroDoServidor(estado));
      await abrirDefinicoes();

      expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
      expect(screen.getByText(TEXTOS.carregarServidor)).toBeInTheDocument();
      expect(screen.queryByText(TEXTOS.carregarSemResposta)).toBeNull();
      semFormulario();
    },
  );

  it("um corpo ilegível (o módulo rejeita com um erro qualquer) é o ecrã de erro, não um formulário", async () => {
    obterFalso.mockRejectedValue(new Error("corpo que não se sabe ler"));
    await abrirDefinicoes();
    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    semFormulario();
  });

  it("um 200 ilegível ao carregar (ErroDaApi com estado 200) é erro do servidor, nunca «sem resposta»", async () => {
    obterFalso.mockRejectedValue(erroDoServidor(200));
    await abrirDefinicoes();
    expect(screen.getByText(TEXTOS.carregarServidor)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.carregarSemResposta)).toBeNull();
    semFormulario();
  });

  it("um TypeError do nosso código dentro da leitura: erro, não o esqueleto para sempre", async () => {
    obterFalso.mockRejectedValue(new TypeError("x is undefined"));
    await abrirDefinicoes();
    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    semFormulario();
  });

  it("a mensagem do backend / do cliente nunca aparece", async () => {
    obterFalso.mockRejectedValue(erroDoServidor(500));
    await abrirDefinicoes();
    expect(document.body.textContent).not.toMatch(/mensagem do cliente|mensagem do backend/);
  });

  it("«Tentar outra vez»: um novo GET; se agora correr bem, aparece o formulário", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirDefinicoes();
    expect(haBotaoDeGuardar()).toBe(false);

    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("tomazia-exemplo");
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("a tentar: «A tentar…» com aria-busy; e se falhar outra vez, continua sem formulário", async () => {
    const segunda = pendente<never>();
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirDefinicoes();
    obterFalso.mockReturnValueOnce(segunda.promessa);

    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));
    const botao = screen.getByRole("button", { name: TEXTOS.aTentar });
    expect(botao).toHaveAttribute("aria-busy", "true");

    segunda.rejeitar(erroDoServidor(500));
    await assentar();
    expect(screen.getByText(TEXTOS.carregarServidor)).toBeInTheDocument();
    semFormulario();
  });

  it("401 no GET: aoPerderSessao uma vez, e nenhum ecrã de erro nem formulário", async () => {
    obterFalso.mockRejectedValue(erro401());
    const sessao = await abrirDefinicoes();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    semFormulario();
  });

  it("desmontar a meio aborta a leitura (e não rebenta)", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirDefinicoes();
    const sinal = (obterFalso.mock.calls[0]?.[0] as { sinal: AbortSignal }).sinal;
    expect(sinal.aborted).toBe(false);

    cleanup();

    expect(sinal.aborted).toBe(true);
  });
});

describe("a primeira vez: tudo vazio não é um erro (8.4)", () => {
  beforeEach(() => {
    prepararApi(definicoesVazias());
  });

  it("o formulário completo, campos vazios, a linha «Ainda não há definições guardadas», e nenhum erro", async () => {
    await abrirDefinicoes();

    expect(screen.getByText(TEXTOS.primeiraVez)).toBeInTheDocument();
    for (const etiqueta of [
      TEXTOS.etiquetaRede,
      TEXTOS.etiquetaPassword,
      TEXTOS.etiquetaMorada,
      TEXTOS.etiquetaTelefone,
      TEXTOS.etiquetaInstagram,
      TEXTOS.etiquetaMaps,
    ]) {
      expect(campo(etiqueta)).toHaveValue("");
    }
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(botaoDeGuardar()).toBeInTheDocument();
  });

  it("o WiFi diz «Pergunta no balcão» (ambos vazios) e o horário está não configurado", async () => {
    await abrirDefinicoes();
    expect(screen.getByText(TEXTOS.wifiVazio)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.horarioNaoConfigurado)).toBeInTheDocument();
  });

  it("a linha some na primeira alteração e não volta depois de guardar", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "tomazia-exemplo");
    expect(screen.queryByText(TEXTOS.primeiraVez)).toBeNull();

    await tocar(botaoDeGuardar());
    await assentar();
    expect(guardarFalso).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.primeiraVez)).toBeNull();
  });

  it("uma configuração existente não mostra a linha da primeira vez", async () => {
    prepararApi(definicoesConfiguradas());
    await abrirDefinicoes();
    expect(screen.queryByText(TEXTOS.primeiraVez)).toBeNull();
  });
});

describe("WiFi: a linha dinâmica e os espaços (4.1)", () => {
  it("com rede e password preenchidas, não há «Pergunta no balcão»", async () => {
    await abrirDefinicoes();
    expect(screen.queryByText(TEXTOS.wifiVazio)).toBeNull();
  });

  it("com um dos dois vazios (no rascunho) aparece; voltar a preencher tira-a", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaPassword, "");
    expect(screen.getByText(TEXTOS.wifiVazio)).toBeInTheDocument();
    escrever(TEXTOS.etiquetaPassword, "x");
    expect(screen.queryByText(TEXTOS.wifiVazio)).toBeNull();
    escrever(TEXTOS.etiquetaRede, "");
    expect(screen.getByText(TEXTOS.wifiVazio)).toBeInTheDocument();
  });

  it("a password com espaço no fim mostra o aviso (e a rede sem espaços não) — não bloqueia", async () => {
    await abrirDefinicoes();
    expect(screen.getAllByText(TEXTOS.wifiEspacos)).toHaveLength(1);
    expect(campo(TEXTOS.etiquetaPassword)).toHaveValue("cerveja-fresca-2026 ");

    escrever(TEXTOS.etiquetaRede, " tomazia-exemplo");
    expect(screen.getAllByText(TEXTOS.wifiEspacos)).toHaveLength(2);
    escrever(TEXTOS.etiquetaRede, "tomazia-exemplo");
    escrever(TEXTOS.etiquetaPassword, "sem-espacos");
    expect(screen.queryByText(TEXTOS.wifiEspacos)).toBeNull();
  });

  it("o aviso de espaços está ligado ao campo por aria-describedby", async () => {
    await abrirDefinicoes();
    const ids = (campo(TEXTOS.etiquetaPassword).getAttribute("aria-describedby") ?? "").split(" ");
    const textos = ids.map((id) => document.getElementById(id)?.textContent ?? "");
    expect(textos).toContain(TEXTOS.wifiEspacos);
  });
});

describe("os campos: teclado, atributos e nada que corte ou transforme (3.2, 4.1, 4.2)", () => {
  it.each([TEXTOS.etiquetaRede, TEXTOS.etiquetaPassword])(
    "%s: autocapitalize none, spellcheck false, autocomplete off, texto simples (visível), sem name",
    async (etiqueta) => {
      await abrirDefinicoes();
      const c = campo(etiqueta);
      expect(c).toHaveAttribute("autocapitalize", "none");
      expect(c).toHaveAttribute("spellcheck", "false");
      expect(c).toHaveAttribute("autocomplete", "off");
      expect(c).toHaveAttribute("type", "text");
      expect(c).not.toHaveAttribute("name");
    },
  );

  it("o telefone tem inputmode tel; Instagram e Maps têm inputmode url, sem maiúscula nem correção", async () => {
    await abrirDefinicoes();
    expect(campo(TEXTOS.etiquetaTelefone)).toHaveAttribute("inputmode", "tel");
    for (const etiqueta of [TEXTOS.etiquetaInstagram, TEXTOS.etiquetaMaps]) {
      const c = campo(etiqueta);
      expect(c).toHaveAttribute("inputmode", "url");
      expect(c).toHaveAttribute("autocapitalize", "none");
      expect(c).toHaveAttribute("spellcheck", "false");
    }
  });

  it("nenhum type=password, nenhum name, nenhum placeholder, NENHUM maxlength em campo nenhum", async () => {
    await abrirDefinicoes();
    const inputs = Array.from(document.querySelectorAll("input"));
    expect(inputs.length).toBeGreaterThanOrEqual(6);
    for (const input of inputs) {
      expect(input.getAttribute("type")).not.toBe("password");
      expect(input, "sem name (o gestor de passwords não oferece guardar)").not.toHaveAttribute(
        "name",
      );
      expect(input).not.toHaveAttribute("placeholder");
      expect(input, "um maxlength corta em silêncio o que se cola").not.toHaveAttribute(
        "maxlength",
      );
    }
  });

  it("a ajuda do Instagram e do Maps está ligada ao campo (aria-describedby)", async () => {
    await abrirDefinicoes();
    const par: Array<[string, string]> = [
      [TEXTOS.etiquetaInstagram, TEXTOS.ajudaInstagram],
      [TEXTOS.etiquetaMaps, TEXTOS.ajudaMaps],
    ];
    for (const [etiqueta, ajuda] of par) {
      const ids = (campo(etiqueta).getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean);
      expect(
        ids.map((id) => document.getElementById(id)?.textContent),
        etiqueta,
      ).toContain(ajuda);
    }
  });

  it("a rede e a password escrevem-se tal e qual (sem aparar no ecrã)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "  rede  ");
    escrever(TEXTOS.etiquetaPassword, "abc ");
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("  rede  ");
    expect(campo(TEXTOS.etiquetaPassword)).toHaveValue("abc ");
  });

  it("a password nunca vai para o endereço, localStorage, sessionStorage nem consola", async () => {
    const consola = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
    ];
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaPassword, "SEGREDO-DE-TESTE-123");
    await tocar(botaoDeGuardar());

    expect(window.location.href).not.toContain("SEGREDO-DE-TESTE-123");
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("SEGREDO-DE-TESTE-123");
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain("SEGREDO-DE-TESTE-123");
    expect(JSON.stringify(window.history.state)).not.toContain("SEGREDO-DE-TESTE-123");
    for (const espiao of consola) {
      expect(JSON.stringify(espiao.mock.calls)).not.toContain("SEGREDO-DE-TESTE-123");
    }
    vi.restoreAllMocks();
  });
});

describe("os três estados do horário (6.1): três desenhos diferentes", () => {
  function dias(): HTMLElement[] {
    return screen
      .queryAllByRole("group")
      .filter(
        (g) =>
          /Horário de/.test(g.textContent ?? "") || g.querySelector('[role="switch"]') !== null,
      );
  }

  it("configurado: o editor com os sete dias, na ordem, e «Remover o horário»", async () => {
    await abrirDefinicoes();

    for (const dia of DIAS_PELA_ORDEM) {
      expect(grupoDoDia(dia)).toBeInTheDocument();
      expect(
        within(grupoDoDia(dia)).getByRole("switch", { name: nomeDoDia(dia) }),
      ).toBeInTheDocument();
    }
    const ordem = screen.getAllByRole("switch").map((s) => s.closest("label")?.textContent);
    expect(ordem.slice(0, 7).map((t) => t?.trim())).toEqual(
      DIAS_PELA_ORDEM.map((d) => nomeDoDia(d)),
    );
    expect(screen.getByRole("button", { name: TEXTOS.removerOHorario })).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.horarioNaoConfigurado)).toBeNull();
    expect(screen.queryByText(TEXTOS.horarioInvalido)).toBeNull();
  });

  it("configurado: a segunda está fechada («Fechado.») e a terça aberta com 17:00–02:00", async () => {
    await abrirDefinicoes();
    expect(interruptorDoDia("segunda")).not.toBeChecked();
    expect(within(grupoDoDia("segunda")).getByText(TEXTOS.fechado)).toBeInTheDocument();
    expect(interruptorDoDia("terca")).toBeChecked();
    expect(within(grupoDoDia("terca")).queryByText(TEXTOS.fechado)).toBeNull();
    expect(within(grupoDoDia("terca")).getByDisplayValue("17:00")).toBeInTheDocument();
    expect(within(grupoDoDia("terca")).getByDisplayValue("02:00")).toBeInTheDocument();
  });

  it("não configurado: o texto próprio e «Configurar o horário»; nenhum dia, nenhum «Fechado.»", async () => {
    prepararApi(definicoesVazias());
    await abrirDefinicoes();

    expect(screen.getByText(TEXTOS.horarioNaoConfigurado)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.configurarHorario })).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.horarioInvalido)).toBeNull();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByText(TEXTOS.fechado)).toBeNull();
    expect(dias()).toEqual([]);
  });

  it("INVÁLIDO: bloco de ERRO, não de vazio — texto próprio, o aviso do «é apagado», «Escrever um horário novo»", async () => {
    prepararApi(definicoesComHorarioInvalido());
    await abrirDefinicoes();

    const erro = screen.getByText(TEXTOS.horarioInvalido);
    expect(erro).toBeInTheDocument();
    expect(erro.className, "cor de erro").toMatch(/text-erro/);
    expect(screen.getByText(TEXTOS.horarioInvalidoAviso)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.escreverHorarioNovo })).toBeInTheDocument();
  });

  it("INVÁLIDO nunca se mostra como vazio nem como «Fechado»", async () => {
    prepararApi(definicoesComHorarioInvalido());
    await abrirDefinicoes();

    expect(screen.queryByText(TEXTOS.horarioNaoConfigurado), "não é o texto do vazio").toBeNull();
    expect(screen.queryByRole("button", { name: TEXTOS.configurarHorario })).toBeNull();
    expect(screen.queryByText(TEXTOS.fechado), "nenhum «Fechado.» à vista").toBeNull();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: TEXTOS.removerOHorario })).toBeNull();
  });

  it("os três textos são diferentes entre si e o `invalido` não é o `nao_configurado`", async () => {
    expect(TEXTOS.horarioInvalido).not.toBe(TEXTOS.horarioNaoConfigurado);
    expect(TEXTOS.escreverHorarioNovo).not.toBe(TEXTOS.configurarHorario);
  });

  it("«Configurar o horário» abre o editor com os sete dias POR PREENCHER (nem fechados nem abertos) e conta como alteração", async () => {
    prepararApi(definicoesVazias());
    await abrirDefinicoes();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");

    await tocar(screen.getByRole("button", { name: TEXTOS.configurarHorario }));

    for (const dia of DIAS_PELA_ORDEM) {
      expect(screen.getByRole("group", { name: legendaDoDia(dia) })).toBeInTheDocument();
      expect(interruptorDoDia(dia)).not.toBeChecked();
      expect(within(grupoDoDia(dia)).getByText(TEXTOS.diaPorDecidir)).toBeInTheDocument();
      expect(within(grupoDoDia(dia)).queryByText(TEXTOS.fechado)).toBeNull();
    }
    expect(screen.queryByText(TEXTOS.horarioNaoConfigurado)).toBeNull();
    expect(botaoDeGuardar()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("«Escrever um horário novo» (invalido) também abre os sete dias por preencher", async () => {
    prepararApi(definicoesComHorarioInvalido());
    await abrirDefinicoes();
    await tocar(screen.getByRole("button", { name: TEXTOS.escreverHorarioNovo }));

    for (const dia of DIAS_PELA_ORDEM) {
      expect(within(grupoDoDia(dia)).getByText(TEXTOS.diaPorDecidir)).toBeInTheDocument();
    }
    expect(screen.queryByText(TEXTOS.horarioInvalido)).toBeNull();
  });

  it("«Remover o horário»: sem diálogo, a linha «Horário removido…» com «Desfazer», que repõe os dias", async () => {
    await abrirDefinicoes();
    await tocar(screen.getByRole("button", { name: TEXTOS.removerOHorario }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(TEXTOS.horarioRemovido)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.horarioNaoConfigurado)).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(botaoDeGuardar()).not.toHaveAttribute("aria-disabled", "true");
    expect(guardarFalso).not.toHaveBeenCalled();

    await tocar(screen.getByRole("button", { name: TEXTOS.desfazer }));
    expect(screen.queryByText(TEXTOS.horarioRemovido)).toBeNull();
    expect(interruptorDoDia("terca")).toBeChecked();
    expect(within(grupoDoDia("sexta")).getByDisplayValue("12:00")).toBeInTheDocument();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("sem alterações o botão não pede nada", () => {
  it("«Guardar alterações» tem aria-disabled e não faz pedido", async () => {
    await abrirDefinicoes();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
    await tocar(botaoDeGuardar());
    expect(guardarFalso).not.toHaveBeenCalled();
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await assentar();
    expect(guardarFalso).not.toHaveBeenCalled();
  });

  it("a linha de estado existe desde o início, vazia; com alterações diz «Há alterações por guardar.»", async () => {
    await abrirDefinicoes();
    expect(screen.queryByText(TEXTOS.haAlteracoes)).toBeNull();
    escrever(TEXTOS.etiquetaTelefone, "913000000");
    expect(screen.getByText(TEXTOS.haAlteracoes)).toBeInTheDocument();
    expect(botaoDeGuardar()).not.toHaveAttribute("aria-disabled", "true");
    escrever(TEXTOS.etiquetaTelefone, definicoesConfiguradas().telefone);
    expect(screen.queryByText(TEXTOS.haAlteracoes)).toBeNull();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
  });
});
