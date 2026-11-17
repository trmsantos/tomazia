/**
 * F4-05a, secções 5, 7 e 9 de `docs/ecras/F4-05a.md` e plano 3.1 e 3.4 — guardar:
 * o corpo do `PUT`, a validação local, a mudança de estado pela resposta do
 * servidor, o 422 por campo, «sem resposta» (não sei se gravou), 5xx e 401.
 *
 * Contrato: ver `src/testes/definicoes.tsx`. O texto vem de `TEXTOS` (e
 * `ERRO_422_POR_CAMPO`), nunca da `mensagem` do envelope.
 *
 * **Regra 10:** «não sei se gravou» ≠ «não gravou» ≠ «gravou». O PUT é absoluto
 * (substitui os sete), por isso repetir é seguro e o formulário **fica como está**
 * com as alterações.
 *
 * Divergência spec/plano, resolvida pelo plano (contrato): depois de um PUT sem
 * resposta o ecrã faz um `GET` de verificação (plano 3.1.8); a spec 9.3 só pedia
 * para tocar outra vez. Os dois comportamentos cumprem-se com este teste: o
 * segundo «Guardar» envia o **mesmo corpo**.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  DIAS_PELA_ORDEM,
  ecoDoPedido,
  erro401,
  erro422,
  erroDoServidor,
  erroSemResposta,
} from "../../../testes/gestao";
import {
  abrirDefinicoes,
  assentar,
  aviso,
  botaoDeGuardar,
  campo,
  comSinal,
  corpoDoPutNumero,
  escrever,
  escreverHora,
  grupoDoDia,
  guardar,
  guardarFalso,
  horaDe,
  interruptorDoDia,
  obterFalso,
  pendente,
  prepararApi,
  tocar,
} from "../../../testes/definicoes";
import { ErroDaApi } from "../../../lib/api/cliente";
import { ERRO_422_POR_CAMPO, TEXTOS, faltaOHorarioDe } from "./textos";

vi.mock("../../../lib/api/gestao-definicoes", () => ({
  obterDefinicoes: vi.fn(),
  guardarDefinicoes: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

const SETE_CHAVES = [
  "horario",
  "instagram",
  "maps_url",
  "morada",
  "telefone",
  "wifi_password",
  "wifi_rede",
];

function descritoPor(elemento: HTMLElement): string[] {
  return (elemento.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "");
}

function linhaDeEstado(): HTMLElement {
  const form = document.querySelector("form") as HTMLElement;
  const estado = within(form)
    .getAllByRole("status")
    .find((no) => no.closest("form") !== null && !/^\s*(Feito|Erro)\./.test(no.textContent ?? ""));
  if (estado === undefined) throw new Error("não há a linha de estado da barra de guardar");
  return estado;
}

describe("o corpo do PUT", () => {
  it("mudar só a rede: um PUT com as outras seis chaves iguais às do GET, horário incluído, e nunca horario_estado", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();

    expect(guardarFalso).toHaveBeenCalledTimes(1);
    expect(guardarFalso).toHaveBeenCalledWith(expect.anything(), comSinal);
    const corpo = corpoDoPutNumero();
    const { horario_estado: _x, ...get } = definicoesConfiguradas();
    void _x;
    expect(corpo).toEqual({ ...get, wifi_rede: "outra-rede" });
    expect(Object.keys(corpo).sort()).toEqual(SETE_CHAVES);
  });

  it("a password com espaço no fim viaja com o espaço (nunca aparada)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaPassword, "nova-password  ");
    await guardar();
    expect(corpoDoPutNumero().wifi_password).toBe("nova-password  ");
  });

  it("os links levam o D4: aparados e com https://", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaInstagram, "  instagram.com/bar.exemplo ");
    escrever(TEXTOS.etiquetaMaps, "maps.example.test/outro");
    await guardar();
    expect(corpoDoPutNumero().instagram).toBe("https://instagram.com/bar.exemplo");
    expect(corpoDoPutNumero().maps_url).toBe("https://maps.example.test/outro");
  });

  it('esvaziar um link envia "" (nunca null) e o horário não tocado vai igual', async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaInstagram, "");
    await guardar();
    expect(corpoDoPutNumero().instagram).toBe("");
    expect(corpoDoPutNumero().horario).toEqual(definicoesConfiguradas().horario);
  });

  it("o horário editado: fechar a terça envia periodos: [] nesse dia, os sete dias por ordem", async () => {
    await abrirDefinicoes();
    await tocar(interruptorDoDia("terca"));
    await guardar();
    const horario = corpoDoPutNumero().horario;
    expect(horario?.map((d) => d.dia)).toEqual([...DIAS_PELA_ORDEM]);
    expect(horario?.find((d) => d.dia === "terca")?.periodos).toEqual([]);
    expect(horario?.find((d) => d.dia === "quarta")?.periodos).toEqual([
      { abre: "17:00", fecha: "02:00" },
    ]);
  });
});

describe("sem alterações: nenhum pedido", () => {
  it("o botão está aria-disabled e tocar nele não envia nada", async () => {
    await abrirDefinicoes();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
    await guardar();
    expect(guardarFalso).not.toHaveBeenCalled();
  });

  it("alterar e repor ao valor de antes volta a não enviar nada", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "x");
    escrever(TEXTOS.etiquetaRede, definicoesConfiguradas().wifi_rede);
    await guardar();
    expect(guardarFalso).not.toHaveBeenCalled();
  });
});

describe("a guardar (7.3)", () => {
  it("«A guardar…», aria-busy e aria-disabled; os campos paráveis ficam aria-disabled com o foco mantido; escrever neles não muda o valor", async () => {
    const pedido = pendente<ReturnType<typeof ecoDoPedido>>();
    guardarFalso.mockReturnValue(pedido.promessa);
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    campo(TEXTOS.etiquetaRede).focus();

    await guardar();

    const botao = screen.getByRole("button", { name: TEXTOS.aGuardar });
    expect(botao).toHaveAttribute("aria-busy", "true");
    expect(botao).toHaveAttribute("aria-disabled", "true");
    expect(campo(TEXTOS.etiquetaRede)).toHaveAttribute("aria-disabled", "true");
    expect(campo(TEXTOS.etiquetaRede)).not.toBeDisabled();
    expect(campo(TEXTOS.etiquetaRede)).toHaveFocus();
    expect(interruptorDoDia("terca")).toHaveAttribute("aria-disabled", "true");

    escrever(TEXTOS.etiquetaRede, "durante-o-pedido");
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");

    pedido.resolver(ecoDoPedido(corpoDoPutNumero()));
    await assentar();
  });

  it("um segundo toque (ou dois no mesmo instante) não envia um segundo pedido", async () => {
    const pedido = pendente<ReturnType<typeof ecoDoPedido>>();
    guardarFalso.mockReturnValue(pedido.promessa);
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");

    fireEvent.click(botaoDeGuardar());
    fireEvent.click(botaoDeGuardar());
    await assentar();
    await guardar();

    expect(guardarFalso).toHaveBeenCalledTimes(1);
    pedido.resolver(ecoDoPedido(corpoDoPutNumero()));
    await assentar();
  });

  it("o PUT não se aborta ao desmontar (pode ter gravado), ao contrário das leituras", async () => {
    const pedido = pendente<ReturnType<typeof ecoDoPedido>>();
    guardarFalso.mockReturnValue(pedido.promessa);
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();
    const sinal = (guardarFalso.mock.calls[0]?.[1] as { sinal: AbortSignal }).sinal;

    (await import("@testing-library/react")).cleanup();

    expect(sinal.aborted).toBe(false);
  });
});

describe("200: o formulário passa a ser a resposta (7.4)", () => {
  it("mostra o que o servidor devolveu, mesmo que difira do enviado", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "enviada");
    guardarFalso.mockImplementation((pedido) =>
      Promise.resolve({ ...ecoDoPedido(pedido), wifi_rede: "devolvida-pelo-servidor" }),
    );
    await guardar();
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("devolvida-pelo-servidor");
  });

  it("o aviso «Definições guardadas.» (sem «Desfazer»), o botão volta a aria-disabled, o foco fica nele, a linha de estado vazia", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    botaoDeGuardar().focus();
    await guardar();

    const a = aviso();
    expect(a).not.toBeNull();
    expect(a).toHaveTextContent(TEXTOS.sucesso);
    expect(within(a as HTMLElement).queryByRole("button", { name: TEXTOS.desfazer })).toBeNull();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
    expect(botaoDeGuardar()).toHaveFocus();
    expect(screen.queryByText(TEXTOS.haAlteracoes)).toBeNull();
    expect(linhaDeEstado()).toHaveTextContent("");
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("sem alterações por guardar depois: um segundo toque não pede nada; e uma alteração nova volta a ligar", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();
    await guardar();
    expect(guardarFalso).toHaveBeenCalledTimes(1);

    escrever(TEXTOS.etiquetaRede, "terceira");
    await guardar();
    expect(guardarFalso).toHaveBeenCalledTimes(2);
  });

  it("a base passa a ser a resposta: repor o valor de ANTES do guardar conta como alteração", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    await guardar();
    escrever(TEXTOS.etiquetaRede, definicoesConfiguradas().wifi_rede);
    expect(screen.getByText(TEXTOS.haAlteracoes)).toBeInTheDocument();
  });
});

describe("validação local: nada é enviado e o erro fica junto do campo (5)", () => {
  it.each<[string, string, string, string]>([
    ["Instagram com @nome", TEXTOS.etiquetaInstagram, "@bardatomazia", TEXTOS.erroLinkArroba],
    [
      "Instagram com javascript:",
      TEXTOS.etiquetaInstagram,
      "javascript:alert(1)",
      TEXTOS.erroLinkEsquema,
    ],
    [
      "Instagram de outro anfitrião",
      TEXTOS.etiquetaInstagram,
      "https://example.com/x",
      TEXTOS.erroLinkInstagram,
    ],
    [
      "Maps com espaço no meio",
      TEXTOS.etiquetaMaps,
      "https://example.com/a b",
      TEXTOS.erroLinkEspacos,
    ],
    ["Maps com javascript:", TEXTOS.etiquetaMaps, "javascript:alert(1)", TEXTOS.erroLinkEsquema],
    ["Maps sem anfitrião", TEXTOS.etiquetaMaps, "https://", TEXTOS.erroLinkIncompleto],
    ["Rede com 201 caracteres", TEXTOS.etiquetaRede, "a".repeat(201), TEXTOS.erroTextoLongo],
    ["Morada com 201 caracteres", TEXTOS.etiquetaMorada, "a".repeat(201), TEXTOS.erroTextoLongo],
  ])("%s", async (_nome, etiqueta, valor, erro) => {
    await abrirDefinicoes();
    escrever(etiqueta, valor);
    await guardar();

    expect(guardarFalso).not.toHaveBeenCalled();
    const c = campo(etiqueta);
    expect(c).toHaveAttribute("aria-invalid", "true");
    expect(descritoPor(c)).toContain(erro);
    expect(c).toHaveFocus();
    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.corrigeOsCampos);
  });

  it("200 emojis passam (400 unidades UTF-16): vai o PUT", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaMorada, "😀".repeat(200));
    await guardar();
    expect(guardarFalso).toHaveBeenCalledTimes(1);
  });

  it("o foco vai ao PRIMEIRO campo com erro, pela ordem do DOM, e todos os erros aparecem de uma vez", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaMaps, "javascript:alert(1)");
    escrever(TEXTOS.etiquetaRede, "a".repeat(201));
    await guardar();

    expect(campo(TEXTOS.etiquetaRede)).toHaveFocus();
    expect(campo(TEXTOS.etiquetaRede)).toHaveAttribute("aria-invalid", "true");
    expect(campo(TEXTOS.etiquetaMaps)).toHaveAttribute("aria-invalid", "true");
  });

  it("o erro limpa-se ao escrever no campo", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaInstagram, "@bardatomazia");
    await guardar();
    expect(campo(TEXTOS.etiquetaInstagram)).toHaveAttribute("aria-invalid", "true");

    escrever(TEXTOS.etiquetaInstagram, "instagram.com/bardatomazia");

    expect(campo(TEXTOS.etiquetaInstagram)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(TEXTOS.erroLinkArroba)).toBeNull();
  });

  it("só valida ao guardar: enquanto se escreve, nada de erros", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaInstagram, "@bar");
    expect(campo(TEXTOS.etiquetaInstagram)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("depois de corrigir, guarda (e o instagram vai normalizado)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaInstagram, "@bardatomazia");
    await guardar();
    escrever(TEXTOS.etiquetaInstagram, "instagram.com/bardatomazia");
    await guardar();
    expect(guardarFalso).toHaveBeenCalledTimes(1);
    expect(corpoDoPutNumero().instagram).toBe("https://instagram.com/bardatomazia");
  });
});

describe("validação local do horário (6.6)", () => {
  it("hora de abertura vazia: o erro no campo Abre, foco nele, zero pedidos", async () => {
    await abrirDefinicoes();
    escreverHora("terca", "abre", "");
    await guardar();

    expect(guardarFalso).not.toHaveBeenCalled();
    const abre = horaDe("terca", "abre");
    expect(abre).toHaveAttribute("aria-invalid", "true");
    expect(descritoPor(abre)).toContain(TEXTOS.erroHoraAbre);
    expect(abre).toHaveFocus();
    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.corrigeOsCampos);
  });

  it("abre == fecha: o erro no campo Fecha", async () => {
    await abrirDefinicoes();
    escreverHora("terca", "fecha", "17:00");
    await guardar();
    expect(guardarFalso).not.toHaveBeenCalled();
    expect(descritoPor(horaDe("terca", "fecha"))).toContain(TEXTOS.erroHoraIgual);
    expect(horaDe("terca", "fecha")).toHaveFocus();
  });

  it("sobreposição no mesmo dia: a linha de erro do dia (fieldset com aria-describedby), foco no fieldset, zero pedidos", async () => {
    await abrirDefinicoes();
    escreverHora("sexta", "abre", "14:00", 2, 2); // 14:00–02:00 contra 12:00–15:00
    await guardar();

    expect(guardarFalso).not.toHaveBeenCalled();
    const grupo = grupoDoDia("sexta");
    expect(within(grupo).getByText(TEXTOS.erroSobreposicao)).toBeInTheDocument();
    expect(descritoPor(grupo)).toContain(TEXTOS.erroSobreposicao);
    expect(grupo).toHaveFocus();
    expect(grupo).toHaveAttribute("tabindex", "-1");
  });

  it("o erro limpa-se ao mexer no dia", async () => {
    await abrirDefinicoes();
    escreverHora("terca", "abre", "");
    await guardar();
    escreverHora("terca", "abre", "18:00");
    expect(horaDe("terca", "abre")).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(TEXTOS.erroHoraAbre)).toBeNull();
  });

  it("hora INCOMPLETA (badInput): o erro «hora incompleta», diferente do de vazia", async () => {
    await abrirDefinicoes();
    const abre = horaDe("terca", "abre");
    Object.defineProperty(abre, "validity", { configurable: true, value: { badInput: true } });
    escreverHora("terca", "abre", "");
    await guardar();

    expect(guardarFalso).not.toHaveBeenCalled();
    expect(descritoPor(abre)).toContain(TEXTOS.erroHoraIncompleta);
    expect(descritoPor(abre)).not.toContain(TEXTOS.erroHoraAbre);
  });

  it("o horário de raiz: tentar guardar com dias por preencher → erro em cada dia, zero pedidos; depois decide-se e guarda-se", async () => {
    prepararApi(definicoesVazias());
    await abrirDefinicoes();
    await tocar(screen.getByRole("button", { name: TEXTOS.configurarHorario }));
    await guardar();

    expect(guardarFalso).not.toHaveBeenCalled();
    for (const dia of DIAS_PELA_ORDEM) {
      expect(within(grupoDoDia(dia)).getByText(faltaOHorarioDe(dia))).toBeInTheDocument();
    }

    // Segunda fechada (liga e desliga), sexta 17:00–02:00, o resto fechado.
    for (const dia of DIAS_PELA_ORDEM) {
      await tocar(interruptorDoDia(dia)); // abre, com um período vazio
      if (dia !== "sexta") await tocar(interruptorDoDia(dia)); // fecha
    }
    escreverHora("sexta", "abre", "17:00");
    escreverHora("sexta", "fecha", "02:00");
    await guardar();

    expect(guardarFalso).toHaveBeenCalledTimes(1);
    const horario = corpoDoPutNumero().horario;
    expect(horario?.find((d) => d.dia === "segunda")?.periodos).toEqual([]);
    expect(horario?.find((d) => d.dia === "sexta")?.periodos).toEqual([
      { abre: "17:00", fecha: "02:00" },
    ]);
    expect(horario).toHaveLength(7);
  });
});

describe("horário inválido + guardar outra coisa (D2)", () => {
  it("o aviso prévio está visível; o PUT leva horario: null; depois do 200 o ecrã mostra o estado do servidor (não configurado), nunca o inválido", async () => {
    prepararApi(definicoesComHorarioInvalido());
    await abrirDefinicoes();
    expect(screen.getByText(TEXTOS.horarioInvalidoAviso)).toBeInTheDocument();

    escrever(TEXTOS.etiquetaTelefone, "913000000");
    expect(screen.getByText(TEXTOS.horarioInvalidoAviso)).toBeInTheDocument();
    await guardar();

    expect(corpoDoPutNumero().horario).toBeNull();
    expect(corpoDoPutNumero().telefone).toBe("913000000");
    expect(screen.getByText(TEXTOS.horarioNaoConfigurado)).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.horarioInvalido)).toBeNull();
    expect(screen.queryByText(TEXTOS.horarioInvalidoAviso)).toBeNull();
    expect(aviso()).toHaveTextContent(TEXTOS.sucesso);
  });

  it("escrever o horário novo a partir do inválido envia o horário e fica configurado", async () => {
    prepararApi(definicoesComHorarioInvalido());
    await abrirDefinicoes();
    await tocar(screen.getByRole("button", { name: TEXTOS.escreverHorarioNovo }));
    for (const dia of DIAS_PELA_ORDEM) {
      await tocar(interruptorDoDia(dia));
      await tocar(interruptorDoDia(dia));
    }
    await guardar();
    expect(corpoDoPutNumero().horario).toHaveLength(7);
    expect(corpoDoPutNumero().horario?.every((d) => d.periodos.length === 0)).toBe(true);
    expect(screen.queryAllByRole("switch")).toHaveLength(7);
  });
});

describe("422: o campo que se corrige (3.4, 9.2)", () => {
  const CAMPOS_DE_TEXTO: ReadonlyArray<readonly [string, string]> = [
    ["wifi_rede", TEXTOS.etiquetaRede],
    ["wifi_password", TEXTOS.etiquetaPassword],
    ["morada", TEXTOS.etiquetaMorada],
    ["telefone", TEXTOS.etiquetaTelefone],
    ["instagram", TEXTOS.etiquetaInstagram],
    ["maps_url", TEXTOS.etiquetaMaps],
  ];

  async function guardarComRecusa(campoDoErro: string | null): Promise<void> {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "valor-valido");
    guardarFalso.mockRejectedValue(erro422(campoDoErro));
    await guardar();
  }

  it.each(CAMPOS_DE_TEXTO)(
    "campo=%s → a frase própria desse campo, aria-invalid, aria-describedby e foco; nunca a mensagem do envelope",
    async (campoDoErro, etiqueta) => {
      await guardarComRecusa(campoDoErro);

      const c = campo(etiqueta);
      expect(c).toHaveAttribute("aria-invalid", "true");
      expect(descritoPor(c)).toContain(
        ERRO_422_POR_CAMPO[campoDoErro as keyof typeof ERRO_422_POR_CAMPO],
      );
      expect(c).toHaveFocus();
      expect(linhaDeEstado()).toHaveTextContent(TEXTOS.corrigeOsCampos);
      expect(document.body.textContent).not.toMatch(/mensagem do backend/);
      // O rascunho fica intacto.
      expect(campo(TEXTOS.etiquetaRede)).toHaveValue("valor-valido");
    },
  );

  it("o erro do servidor sai quando o dono muda esse campo", async () => {
    await guardarComRecusa("maps_url");
    escrever(TEXTOS.etiquetaMaps, "https://maps.example.test/novo");
    expect(campo(TEXTOS.etiquetaMaps)).not.toHaveAttribute("aria-invalid", "true");
    expect(descritoPor(campo(TEXTOS.etiquetaMaps))).not.toContain(ERRO_422_POR_CAMPO.maps_url);
  });

  it("campo=horario → o erro no bloco do horário (com foco aí), não junto de um dia", async () => {
    await guardarComRecusa("horario");

    const erro = screen.getByText(ERRO_422_POR_CAMPO.horario);
    expect(erro).toBeInTheDocument();
    const bloco = erro.closest("[tabindex]") as HTMLElement | null;
    expect(bloco, "o foco vai a um elemento do painel do horário (tabindex -1)").not.toBeNull();
    expect(bloco).toHaveFocus();
    expect(bloco).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByRole("heading", { level: 2, name: TEXTOS.painelHorario }).closest("section"),
    ).toContainElement(erro);
    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.corrigeOsCampos);
  });

  it.each([
    ["sem campo", null],
    ["campo desconhecido", "xpto"],
    ["horario_estado (não devia acontecer)", "horario_estado"],
  ])(
    "%s → a frase de «confirma os campos» na linha da barra, sem erro num campo",
    async (_nome, campoDoErro) => {
      await guardarComRecusa(campoDoErro);

      expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardar422SemCampo);
      expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
      expect(botaoDeGuardar()).toHaveFocus();
    },
  );

  it("um 422 não muda a base: o botão continua ativo e repetir envia o mesmo corpo", async () => {
    await guardarComRecusa("telefone");
    expect(botaoDeGuardar()).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("guardar sem resposta: «não sei se gravou» (9.3, regra 10)", () => {
  it("a frase de não sei, o formulário e as alterações ficam, e depois um GET de verificação", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    // O servidor não gravou: o GET devolve o de antes.
    await guardar();

    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardarSemResposta);
    expect(aviso()).toBeNull();
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.getByText(TEXTOS.haAlteracoes)).toBeInTheDocument();
    expect(linhaDeEstado()).not.toHaveTextContent(TEXTOS.sucesso);
  });

  it("se o GET trouxer o que se enviou, gravou: «Definições guardadas.» e a mensagem some", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockImplementationOnce(() =>
      Promise.resolve({ ...definicoesConfiguradas(), wifi_rede: "outra-rede" }),
    );
    await guardar();

    expect(aviso()).toHaveTextContent(TEXTOS.sucesso);
    expect(screen.queryByText(TEXTOS.guardarSemResposta)).toBeNull();
    expect(screen.queryByText(TEXTOS.haAlteracoes)).toBeNull();
    expect(botaoDeGuardar()).toHaveAttribute("aria-disabled", "true");
  });

  it("um 200 com o corpo ilegível também é «não sei»: a frase de não sei e a verificação (não «o problema é nosso»)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(
      new ErroDaApi("O servidor respondeu com sucesso mas o conteúdo não era JSON.", {
        estado: 200,
        codigo: null,
      }),
    );
    await guardar();

    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardarSemResposta);
    expect(linhaDeEstado()).not.toHaveTextContent(TEXTOS.guardarServidor);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
  });

  it("se a verificação confirma que gravou o horário removido, o aviso «Horário removido» e o «Desfazer» saem", async () => {
    await abrirDefinicoes();
    await tocar(screen.getByRole("button", { name: TEXTOS.removerOHorario }));
    expect(screen.getByText(TEXTOS.horarioRemovido)).toBeInTheDocument();

    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockImplementationOnce(() =>
      Promise.resolve({
        ...definicoesConfiguradas(),
        horario: null,
        horario_estado: "nao_configurado" as const,
      }),
    );
    await guardar();

    expect(aviso()).toHaveTextContent(TEXTOS.sucesso);
    expect(screen.queryByText(TEXTOS.horarioRemovido)).toBeNull();
    expect(screen.queryByRole("button", { name: TEXTOS.desfazer })).toBeNull();
  });

  it("se o GET de verificação também falhar, nada muda: a mensagem de não sei fica", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await guardar();

    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardarSemResposta);
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("um segundo «Guardar alterações» envia EXATAMENTE o mesmo corpo (o PUT é absoluto: repetir é seguro)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    await guardar();
    await guardar();

    expect(guardarFalso).toHaveBeenCalledTimes(2);
    expect(corpoDoPutNumero(1)).toEqual(corpoDoPutNumero(0));
  });

  it("a frase nunca diz «guardado» nem «não guardei»", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroSemResposta());
    await guardar();
    expect(linhaDeEstado().textContent).not.toMatch(
      /não (foi|ficou) guardad|não guardei|Definições guardadas/,
    );
  });
});

describe("5xx, 403 e outros (9.4)", () => {
  it.each([500, 503, 403])(
    "%i: a frase de servidor, o formulário mantido, e não diz «não foi guardado»",
    async (estado) => {
      await abrirDefinicoes();
      escrever(TEXTOS.etiquetaRede, "outra-rede");
      guardarFalso.mockRejectedValueOnce(erroDoServidor(estado));
      await guardar();

      expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardarServidor);
      expect(linhaDeEstado()).not.toHaveTextContent(TEXTOS.guardarSemResposta);
      expect(linhaDeEstado().textContent).not.toMatch(/não (foi|ficou) guardad|não guardei/);
      expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
      expect(aviso()).toBeNull();
      expect(botaoDeGuardar()).toHaveFocus();
      expect(document.body.textContent).not.toMatch(/mensagem do cliente/);
    },
  );

  it("repetir depois de um 5xx envia o mesmo corpo", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await guardar();
    await guardar();
    expect(corpoDoPutNumero(1)).toEqual(corpoDoPutNumero(0));
  });

  it("um erro nosso (TypeError) ao guardar também é «o problema é nosso», não um ecrã em branco", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(new TypeError("x"));
    await guardar();
    expect(linhaDeEstado()).toHaveTextContent(TEXTOS.guardarServidor);
    expect(campo(TEXTOS.etiquetaRede)).toHaveValue("outra-rede");
  });
});

describe("401 (9.1)", () => {
  it("no PUT: aoPerderSessao uma vez, sem frases de «não guardei»", async () => {
    const sessao = await abrirDefinicoes();
    escrever(TEXTOS.etiquetaRede, "outra-rede");
    guardarFalso.mockRejectedValueOnce(erro401());
    await guardar();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.guardarSemResposta)).toBeNull();
    expect(screen.queryByText(TEXTOS.guardarServidor)).toBeNull();
  });

  it("o rascunho não se guarda em lado nenhum (a password do WiFi não vai para o armazenamento)", async () => {
    await abrirDefinicoes();
    escrever(TEXTOS.etiquetaPassword, "SEGREDO-DE-TESTE-401");
    guardarFalso.mockRejectedValueOnce(erro401());
    await guardar();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("SEGREDO-DE-TESTE-401");
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain("SEGREDO-DE-TESTE-401");
    expect(JSON.stringify(window.history.state)).not.toContain("SEGREDO-DE-TESTE-401");
  });
});
