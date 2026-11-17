/**
 * F4-05a, secções 6.2 a 6.6 e 15 de `docs/ecras/F4-05a.md` e plano 3.6 — o editor
 * dos sete dias, isolado do ecrã.
 *
 * Contrato (`src/pages/gestao/definicoes/EditorDoHorario.tsx`):
 *
 * ```tsx
 * export function EditorDoHorario(props: {
 *   dias: DiaNoFormulario[];                        // os sete, de segunda a domingo (ver horario-do-formulario.ts)
 *   erros: ErrosDoHorario;                          // o que `validarHorario` devolveu (vazio = {porDia:{},porPeriodo:{}})
 *   parado?: boolean;                               // a guardar: tudo aria-disabled, nada muda
 *   aoMudar: (dias: DiaNoFormulario[]) => void;     // o editor é controlado
 * }): ReactElement
 * ```
 *
 * Cada dia é um `<fieldset>` com `<legend>` (`legendaDoDia`); o `Interruptor` tem o
 * nome do dia (`nomeDoDia`) e liga = aberto; as horas são `<input type="time">`
 * sem `step`, com os nomes de `nomeDeAbre`/`nomeDeFecha`. O período 1 não tem
 * «Remover»; do 2 em diante há «Remover período n de {dia}». «Copiar para outros
 * dias» abre uma `Folha`; a linha «Copiado para n dias.» com «Desfazer» vive dentro
 * do editor (por baixo do botão do dia de origem). Marcar «Fechado» **guarda** os
 * períodos em memória; ligar um dia sem períodos cria **um** período com horas
 * **vazias** (não se inventa uma hora). O editor nunca reordena enquanto se escreve.
 *
 * **Deixa passar:** o foco que volta ao botão ao fechar a folha (do `<dialog>` nativo)
 * e o layout (e2e).
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DIAS_PELA_ORDEM,
  horarioDeTeste,
  semanaDeTeste,
  type DiaDaSemana,
} from "../../../testes/gestao";
import { periodoNoFormulario } from "../../../testes/horario";
import { EditorDoHorario } from "./EditorDoHorario";
import {
  comecarHorario,
  daApi,
  type DiaNoFormulario,
  type ErrosDoHorario,
} from "./horario-do-formulario";
import {
  TEXTOS,
  copiadoPara,
  faltaOHorarioDe,
  fechaNoDiaSeguinte,
  legendaDoDia,
  nomeDeAbre,
  nomeDeFecha,
  nomeDeRemoverPeriodo,
  nomeDoDia,
  rotuloDoPeriodo,
  tituloDeCopiar,
} from "./textos";

const SEM_ERROS: ErrosDoHorario = { porDia: {}, porPeriodo: {} };

function diasDe(horario = horarioDeTeste()): DiaNoFormulario[] {
  const h = daApi(horario);
  if (h.modo !== "editar") throw new Error("devia ser editar");
  return h.dias;
}

function diasPorPreencher(): DiaNoFormulario[] {
  const h = comecarHorario();
  if (h.modo !== "editar") throw new Error("devia ser editar");
  return h.dias;
}

type Montagem = { aoMudar: ReturnType<typeof vi.fn>; ultimo: () => DiaNoFormulario[] };

/** O editor controlado por um estado, como o ecrã o usa. */
function montar(
  inicial: DiaNoFormulario[],
  extra: { erros?: ErrosDoHorario; parado?: boolean } = {},
): Montagem {
  let atual = inicial;
  const aoMudar = vi.fn((dias: DiaNoFormulario[]) => {
    atual = dias;
  });
  function Casa(): ReactElement {
    const [dias, setDias] = useState(inicial);
    return (
      <EditorDoHorario
        dias={dias}
        erros={extra.erros ?? SEM_ERROS}
        parado={extra.parado}
        aoMudar={(novos) => {
          aoMudar(novos);
          setDias(novos);
        }}
      />
    );
  }
  render(<Casa />);
  return { aoMudar, ultimo: () => atual };
}

function grupo(dia: DiaDaSemana): HTMLElement {
  return screen.getByRole("group", { name: legendaDoDia(dia) });
}
function interruptor(dia: DiaDaSemana): HTMLInputElement {
  return screen.getByRole("switch", { name: nomeDoDia(dia) });
}
function hora(dia: DiaDaSemana, qual: "abre" | "fecha", n = 1, total = 1): HTMLInputElement {
  return within(grupo(dia)).getByLabelText(
    qual === "abre" ? nomeDeAbre(dia, n, total) : nomeDeFecha(dia, n, total),
  );
}
async function tocar(elemento: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(elemento);
    await Promise.resolve();
  });
}
function botaoDoDia(dia: DiaDaSemana, nome: string): HTMLElement {
  return within(grupo(dia)).getByRole("button", { name: nome });
}
function periodosDe(dias: DiaNoFormulario[], dia: DiaDaSemana): Array<[string, string]> {
  return (dias.find((d) => d.dia === dia)?.periodos ?? []).map((p) => [p.abre, p.fecha]);
}

describe("os sete dias", () => {
  it("sete <fieldset> (grupos) de segunda a domingo, cada um com o seu interruptor com o nome do dia", () => {
    montar(diasDe());
    const grupos = screen.getAllByRole("group");
    expect(grupos.map((g) => g.tagName)).toEqual(Array(7).fill("FIELDSET"));
    DIAS_PELA_ORDEM.forEach((dia, i) => {
      expect(grupos[i]).toBe(grupo(dia));
      expect(within(grupo(dia)).getByRole("switch", { name: nomeDoDia(dia) })).toBeInTheDocument();
    });
  });

  it("ligado = aberto: a segunda (fechada) desligada com «Fechado.»; a terça ligada sem «Fechado.»", () => {
    montar(diasDe());
    expect(interruptor("segunda")).not.toBeChecked();
    expect(within(grupo("segunda")).getByText(TEXTOS.fechado)).toBeInTheDocument();
    expect(interruptor("terca")).toBeChecked();
    expect(within(grupo("terca")).queryByText(TEXTOS.fechado)).toBeNull();
  });

  it("as horas são <input type=time> sem step, com as etiquetas «Abre» e «Fecha» visíveis e o nome acessível do dia", () => {
    montar(diasDe());
    const abre = hora("terca", "abre");
    expect(abre).toHaveAttribute("type", "time");
    expect(abre).not.toHaveAttribute("step");
    expect(abre).toHaveValue("17:00");
    expect(hora("terca", "fecha")).toHaveValue("02:00");
    expect(within(grupo("terca")).getByText(TEXTOS.abre)).toBeVisible();
    expect(within(grupo("terca")).getByText(TEXTOS.fecha)).toBeVisible();
  });

  it("com dois períodos os nomes levam o número: «Abre, período 2 de sexta-feira»", () => {
    montar(diasDe());
    expect(hora("sexta", "abre", 1, 2)).toHaveValue("12:00");
    expect(hora("sexta", "fecha", 2, 2)).toHaveValue("02:00");
    expect(nomeDeAbre("sexta", 2, 2)).toMatch(/período 2/);
  });

  it("dia por preencher: interruptor desligado, a frase de «por decidir» e NÃO «Fechado.»", () => {
    montar(diasPorPreencher());
    for (const dia of DIAS_PELA_ORDEM) {
      expect(interruptor(dia)).not.toBeChecked();
      expect(within(grupo(dia)).getByText(TEXTOS.diaPorDecidir)).toBeInTheDocument();
      expect(within(grupo(dia)).queryByText(TEXTOS.fechado)).toBeNull();
    }
  });
});

describe("«Marcar como fechado» num dia por preencher", () => {
  it("só existe nos dias por preencher, com alvo de 44 px, e fecha o dia", async () => {
    const m = montar(diasPorPreencher());
    const botao = within(grupo("quarta")).getByRole("button", { name: TEXTOS.marcarComoFechado });
    expect(botao.className).toMatch(/min-h-toque/);

    await tocar(botao);
    expect(m.ultimo().find((d) => d.dia === "quarta")?.estado).toBe("fechado");
    expect(m.ultimo().find((d) => d.dia === "quinta")?.estado).toBe("por_preencher");
    expect(within(grupo("quarta")).getByText(TEXTOS.fechado)).toBeInTheDocument();
    expect(
      within(grupo("quarta")).queryByRole("button", { name: TEXTOS.marcarComoFechado }),
    ).toBeNull();
  });

  it("o foco fica no dia que se fechou, nunca no body (o botão desaparece)", async () => {
    montar(diasPorPreencher());
    const botao = within(grupo("quarta")).getByRole("button", { name: TEXTOS.marcarComoFechado });

    await tocar(botao);

    expect(document.activeElement).not.toBe(document.body);
    expect(grupo("quarta")).toHaveFocus();
  });

  it("nos dias abertos e fechados não há o botão", () => {
    montar(diasDe());
    expect(screen.queryByRole("button", { name: TEXTOS.marcarComoFechado })).toBeNull();
  });

  it("parado: não fecha nada", async () => {
    const m = montar(diasPorPreencher(), { parado: true });
    await tocar(within(grupo("quarta")).getByRole("button", { name: TEXTOS.marcarComoFechado }));
    expect(m.aoMudar).not.toHaveBeenCalled();
  });
});

describe("o interruptor de um dia", () => {
  it("desligar não perde o que estava escrito: ligar outra vez repõe os períodos; envia-se fechado", async () => {
    const m = montar(diasDe());

    await tocar(interruptor("sexta"));
    expect(within(grupo("sexta")).queryByLabelText(/^Abre/)).toBeNull();
    expect(within(grupo("sexta")).getByText(TEXTOS.fechado)).toBeInTheDocument();
    expect(m.ultimo().find((d) => d.dia === "sexta")?.estado).toBe("fechado");

    await tocar(interruptor("sexta"));
    expect(hora("sexta", "abre", 1, 2)).toHaveValue("12:00");
    expect(hora("sexta", "fecha", 2, 2)).toHaveValue("02:00");
    expect(periodosDe(m.ultimo(), "sexta")).toEqual([
      ["12:00", "15:00"],
      ["19:00", "02:00"],
    ]);
  });

  it("ligar um dia sem períodos cria UM período com as horas VAZIAS (não inventa a hora de abertura)", async () => {
    const m = montar(diasDe());
    await tocar(interruptor("segunda"));

    expect(interruptor("segunda")).toBeChecked();
    expect(hora("segunda", "abre")).toHaveValue("");
    expect(hora("segunda", "fecha")).toHaveValue("");
    expect(m.ultimo().find((d) => d.dia === "segunda")?.estado).toBe("aberto");
    expect(periodosDe(m.ultimo(), "segunda")).toEqual([["", ""]]);
  });

  it("um dia por preencher, ligado, passa a aberto com um período vazio; desligado, a fechado", async () => {
    const m = montar(diasPorPreencher());
    await tocar(interruptor("quarta"));
    expect(m.ultimo().find((d) => d.dia === "quarta")?.estado).toBe("aberto");
    expect(periodosDe(m.ultimo(), "quarta")).toEqual([["", ""]]);

    await tocar(interruptor("quarta"));
    expect(m.ultimo().find((d) => d.dia === "quarta")?.estado).toBe("fechado");
    expect(within(grupo("quarta")).getByText(TEXTOS.fechado)).toBeInTheDocument();
  });
});

describe("os períodos", () => {
  it("o período 1 não tem «Remover»; os seguintes têm, com o nome do dia e o número", () => {
    montar(diasDe());
    expect(within(grupo("terca")).queryByRole("button", { name: /^Remover/ })).toBeNull();
    expect(
      within(grupo("sexta")).queryByRole("button", { name: nomeDeRemoverPeriodo("sexta", 1) }),
    ).toBeNull();
    expect(botaoDoDia("sexta", nomeDeRemoverPeriodo("sexta", 2))).toBeInTheDocument();
    expect(within(grupo("sexta")).getByText(rotuloDoPeriodo(2))).toBeInTheDocument();
  });

  it("«Adicionar período» cria um período VAZIO no fim e leva o foco ao seu «Abre»", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("terca", TEXTOS.adicionarPeriodo));

    expect(periodosDe(m.ultimo(), "terca")).toEqual([
      ["17:00", "02:00"],
      ["", ""],
    ]);
    const novoAbre = hora("terca", "abre", 2, 2);
    expect(novoAbre).toHaveValue("");
    expect(novoAbre).toHaveFocus();
  });

  it("«Adicionar período» só existe em dias abertos", () => {
    montar(diasDe());
    expect(
      within(grupo("segunda")).queryByRole("button", { name: TEXTOS.adicionarPeriodo }),
    ).toBeNull();
  });

  it("ao sexto período, o botão desaparece e diz «No máximo seis períodos por dia.»; ao remover, volta", async () => {
    montar(diasDe());
    for (let i = 0; i < 5; i += 1) {
      await tocar(botaoDoDia("terca", TEXTOS.adicionarPeriodo));
    }
    expect(within(grupo("terca")).getAllByLabelText(/^Abre/)).toHaveLength(6);
    expect(
      within(grupo("terca")).queryByRole("button", { name: TEXTOS.adicionarPeriodo }),
    ).toBeNull();
    expect(within(grupo("terca")).getByText(TEXTOS.limiteDePeriodos)).toBeInTheDocument();

    await tocar(botaoDoDia("terca", nomeDeRemoverPeriodo("terca", 6)));
    expect(within(grupo("terca")).getAllByLabelText(/^Abre/)).toHaveLength(5);
    expect(botaoDoDia("terca", TEXTOS.adicionarPeriodo)).toBeInTheDocument();
    expect(within(grupo("terca")).queryByText(TEXTOS.limiteDePeriodos)).toBeNull();
  });

  it("remover um período tira esse e mais nenhum, e o foco nunca fica no <body>", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", nomeDeRemoverPeriodo("sexta", 2)));

    expect(periodosDe(m.ultimo(), "sexta")).toEqual([["12:00", "15:00"]]);
    expect(document.activeElement).not.toBe(document.body);
    expect(grupo("sexta")).toContainElement(document.activeElement as HTMLElement);
  });

  it("escrever uma hora chama aoMudar só com essa mudança; o editor não reordena enquanto se escreve", () => {
    const m = montar(diasDe());
    fireEvent.change(hora("sexta", "abre", 1, 2), { target: { value: "20:00" } });
    // 20:00 depois do segundo (19:00): se reordenasse, o primeiro campo passava a ter 19:00.
    expect(periodosDe(m.ultimo(), "sexta")).toEqual([
      ["20:00", "15:00"],
      ["19:00", "02:00"],
    ]);
    expect(hora("sexta", "abre", 1, 2)).toHaveValue("20:00");
  });

  it("uma hora incompleta (validity.badInput, value vazio) fica marcada como incompleta, distinta de vazia", () => {
    const m = montar(diasDe());
    const abre = hora("terca", "abre");
    Object.defineProperty(abre, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.change(abre, { target: { value: "" } });

    const periodo = m.ultimo().find((d) => d.dia === "terca")?.periodos[0];
    expect(periodo?.abre).toBe("");
    expect(periodo?.abreIncompleto).toBe(true);
    expect(periodo?.fechaIncompleto).toBe(false);

    // Escrever uma hora completa tira a marca.
    Object.defineProperty(abre, "validity", { configurable: true, value: { badInput: false } });
    fireEvent.change(abre, { target: { value: "18:00" } });
    expect(m.ultimo().find((d) => d.dia === "terca")?.periodos[0]?.abreIncompleto).toBe(false);
  });
});

describe("«Fecha às … do dia seguinte» (6.3)", () => {
  it("17:00–02:00 numa terça mostra a frase com o dia seguinte; 18:00–20:00 não mostra nenhuma", () => {
    montar(diasDe());
    expect(
      within(grupo("terca")).getByText(fechaNoDiaSeguinte("terca", "02:00")),
    ).toBeInTheDocument();
    expect(within(grupo("domingo")).queryByText(/dia seguinte|^Fecha (à|às)/)).toBeNull();
  });

  it("cada período tem a sua: sexta 12–15 (nenhuma) e 19–02 (a frase)", () => {
    montar(diasDe());
    const frase = fechaNoDiaSeguinte("sexta", "02:00");
    expect(within(grupo("sexta")).getAllByText(frase)).toHaveLength(1);
  });

  it("a frase usa a preposição certa e o dia seguinte (01:00 → «à», domingo → segunda-feira)", () => {
    montar(diasDe(semanaDeTeste({ sexta: [["22:00", "01:00"]], domingo: [["22:00", "03:00"]] })));
    expect(within(grupo("sexta")).getByText("Fecha à 01:00 de sábado.")).toBeInTheDocument();
    expect(
      within(grupo("domingo")).getByText("Fecha às 03:00 de segunda-feira."),
    ).toBeInTheDocument();
  });

  it("acompanha o que se escreve: aparece e desaparece conforme fecha < abre", () => {
    montar(diasDe());
    fireEvent.change(hora("terca", "fecha"), { target: { value: "20:00" } });
    expect(within(grupo("terca")).queryByText(fechaNoDiaSeguinte("terca", "02:00"))).toBeNull();
    fireEvent.change(hora("terca", "fecha"), { target: { value: "01:00" } });
    expect(
      within(grupo("terca")).getByText(fechaNoDiaSeguinte("terca", "01:00")),
    ).toBeInTheDocument();
  });

  it("sem uma das horas (vazia), nenhuma frase", () => {
    montar(diasPorPreencher());
    fireEvent.click(interruptor("terca"));
    expect(within(grupo("terca")).queryByText(/^Fecha (à|às)/)).toBeNull();
  });
});

describe("os erros, junto de quem os causou", () => {
  it("erro numa hora: o texto junto do campo, aria-invalid e aria-describedby; os outros campos limpos", () => {
    const dias = diasDe();
    const chave = dias.find((d) => d.dia === "terca")?.periodos[0]?.chave ?? "";
    montar(dias, { erros: { porDia: {}, porPeriodo: { [chave]: { abre: TEXTOS.erroHoraAbre } } } });

    const abre = hora("terca", "abre");
    expect(abre).toHaveAttribute("aria-invalid", "true");
    const ids = (abre.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      TEXTOS.erroHoraAbre,
    );
    expect(hora("terca", "fecha")).not.toHaveAttribute("aria-invalid", "true");
    expect(hora("quarta", "abre")).not.toHaveAttribute("aria-invalid", "true");
  });

  it("erro no Fecha: só o Fecha fica inválido", () => {
    const dias = diasDe();
    const chave = dias.find((d) => d.dia === "quarta")?.periodos[0]?.chave ?? "";
    montar(dias, {
      erros: { porDia: {}, porPeriodo: { [chave]: { fecha: TEXTOS.erroHoraIgual } } },
    });
    expect(hora("quarta", "fecha")).toHaveAttribute("aria-invalid", "true");
    expect(hora("quarta", "abre")).not.toHaveAttribute("aria-invalid", "true");
    expect(within(grupo("quarta")).getByText(TEXTOS.erroHoraIgual)).toBeInTheDocument();
  });

  it("erro no dia (sobreposição, por preencher): a linha por baixo dos períodos e o fieldset com aria-describedby e tabindex -1", () => {
    montar(diasDe(), { erros: { porDia: { sexta: TEXTOS.erroSobreposicao }, porPeriodo: {} } });
    const g = grupo("sexta");
    expect(within(g).getByText(TEXTOS.erroSobreposicao)).toBeInTheDocument();
    const ids = (g.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toContain(
      TEXTOS.erroSobreposicao,
    );
    expect(g).toHaveAttribute("tabindex", "-1");
    expect(within(grupo("quinta")).queryByText(TEXTOS.erroSobreposicao)).toBeNull();
  });

  it("um dia por preencher com erro mostra a frase do dia certo", () => {
    montar(diasPorPreencher(), {
      erros: { porDia: { quarta: faltaOHorarioDe("quarta") }, porPeriodo: {} },
    });
    expect(within(grupo("quarta")).getByText(faltaOHorarioDe("quarta"))).toBeInTheDocument();
    expect(within(grupo("quinta")).queryByText(faltaOHorarioDe("quarta"))).toBeNull();
  });

  it("sem erros, nada é inválido", () => {
    montar(diasDe());
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe("parado (a guardar)", () => {
  it("interruptores e botões ficam aria-disabled (não disabled) e nada muda", async () => {
    const m = montar(diasDe(), { parado: true });
    expect(interruptor("terca")).toHaveAttribute("aria-disabled", "true");
    expect(interruptor("terca")).not.toBeDisabled();
    expect(botaoDoDia("terca", TEXTOS.adicionarPeriodo)).toHaveAttribute("aria-disabled", "true");
    expect(botaoDoDia("sexta", nomeDeRemoverPeriodo("sexta", 2))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(hora("terca", "abre")).toHaveAttribute("aria-disabled", "true");

    await tocar(interruptor("terca"));
    await tocar(botaoDoDia("terca", TEXTOS.adicionarPeriodo));
    await tocar(botaoDoDia("sexta", nomeDeRemoverPeriodo("sexta", 2)));
    fireEvent.change(hora("terca", "abre"), { target: { value: "10:00" } });

    expect(m.aoMudar).not.toHaveBeenCalled();
    expect(hora("terca", "abre")).toHaveValue("17:00");
  });
});

describe("copiar para outros dias (6.4)", () => {
  function folha(): HTMLElement {
    return screen.getByRole("dialog");
  }
  function interruptoresDaFolha(): HTMLInputElement[] {
    return within(folha()).getAllByRole("switch");
  }

  it("só os dias abertos têm o botão", () => {
    montar(diasDe());
    expect(
      within(grupo("segunda")).queryByRole("button", { name: TEXTOS.copiarParaOutrosDias }),
    ).toBeNull();
    expect(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias)).toBeInTheDocument();
  });

  it("a folha abre com o título do dia, a explicação e os SEIS outros dias ligados à partida (o de origem não está lá)", async () => {
    montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));

    expect(screen.getByRole("dialog", { name: tituloDeCopiar("sexta") })).toBeInTheDocument();
    const nomes = interruptoresDaFolha().map((s) => s.closest("label")?.textContent?.trim());
    expect(nomes).toEqual(DIAS_PELA_ORDEM.filter((d) => d !== "sexta").map((d) => nomeDoDia(d)));
    for (const s of interruptoresDaFolha()) expect(s).toBeChecked();
    expect(within(folha()).getByRole("button", { name: TEXTOS.copiar })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(folha()).getByRole("button", { name: TEXTOS.cancelar })).toBeInTheDocument();
  });

  it("«Copiar» substitui TAMBÉM os dias fechados (abrem) e os abertos (mudam); o resto da semana fica como está", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));

    const sexta = [
      ["12:00", "15:00"],
      ["19:00", "02:00"],
    ];
    for (const dia of DIAS_PELA_ORDEM) {
      expect(periodosDe(m.ultimo(), dia), dia).toEqual(sexta);
      expect(m.ultimo().find((d) => d.dia === dia)?.estado, dia).toBe("aberto");
    }
    expect(interruptor("segunda")).toBeChecked();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("copia para um subconjunto: «Nenhum» desliga todos (e passa a «Todos»), liga-se só quarta e quinta", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));

    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiarNenhum }));
    for (const s of interruptoresDaFolha()) expect(s).not.toBeChecked();
    expect(within(folha()).queryByRole("button", { name: TEXTOS.copiarNenhum })).toBeNull();
    expect(within(folha()).getByRole("button", { name: TEXTOS.copiarTodos })).toBeInTheDocument();
    expect(within(folha()).getByRole("button", { name: TEXTOS.copiar })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await tocar(within(folha()).getByRole("switch", { name: nomeDoDia("quarta") }));
    await tocar(within(folha()).getByRole("switch", { name: nomeDoDia("quinta") }));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));

    expect(periodosDe(m.ultimo(), "quarta")).toEqual(periodosDe(m.ultimo(), "sexta"));
    expect(periodosDe(m.ultimo(), "quinta")).toEqual(periodosDe(m.ultimo(), "sexta"));
    expect(periodosDe(m.ultimo(), "terca")).toEqual([["17:00", "02:00"]]);
    expect(m.ultimo().find((d) => d.dia === "segunda")?.estado).toBe("fechado");
    expect(screen.getByText(copiadoPara(2))).toBeInTheDocument();
  });

  it("«Todos» volta a ligar os seis; sem nenhum ligado, «Copiar» está aria-disabled e não copia", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiarNenhum }));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect(m.aoMudar).not.toHaveBeenCalled();

    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiarTodos }));
    for (const s of interruptoresDaFolha()) expect(s).toBeChecked();
  });

  it("«Cancelar» e `Esc` fecham sem copiar", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.cancelar }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await act(async () => {
      fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.aoMudar).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Copiado para/)).toBeNull();
  });

  it("depois de copiar: a linha «Copiado para 6 dias.» (role status) com «Desfazer» por baixo do botão do dia de origem; NENHUM aviso temporário", async () => {
    montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));

    const linha = within(grupo("sexta"))
      .getByText(copiadoPara(6))
      .closest('[role="status"]') as HTMLElement;
    expect(linha).not.toBeNull();
    expect(within(linha).getByRole("button", { name: TEXTOS.desfazer })).toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).filter((n) =>
        /^\s*(Feito|Erro)\./.test(n.textContent ?? ""),
      ),
    ).toEqual([]);
  });

  it("«Desfazer» repõe TODOS os dias como estavam e a linha desaparece", async () => {
    const m = montar(diasDe());
    const antes = DIAS_PELA_ORDEM.map((d) => [
      d,
      m.ultimo().find((x) => x.dia === d)?.estado,
      periodosDe(m.ultimo(), d),
    ]);
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));

    await tocar(screen.getByRole("button", { name: TEXTOS.desfazer }));

    const depois = DIAS_PELA_ORDEM.map((d) => [
      d,
      m.ultimo().find((x) => x.dia === d)?.estado,
      periodosDe(m.ultimo(), d),
    ]);
    expect(depois).toEqual(antes);
    expect(screen.queryByText(copiadoPara(6))).toBeNull();
    expect(screen.queryByRole("button", { name: TEXTOS.desfazer })).toBeNull();
    expect(interruptor("segunda")).not.toBeChecked();
  });

  it("a linha desaparece na próxima alteração (o que já não se desfaz com segurança)", async () => {
    montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    expect(screen.getByText(copiadoPara(6))).toBeInTheDocument();

    fireEvent.change(hora("terca", "abre", 1, 2), { target: { value: "10:00" } });

    expect(screen.queryByText(copiadoPara(6))).toBeNull();
    expect(screen.queryByRole("button", { name: TEXTOS.desfazer })).toBeNull();
  });

  it("só há uma linha de cada vez: copiar a partir de outro dia move-a", async () => {
    montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    await tocar(botaoDoDia("terca", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));

    expect(screen.getAllByText(copiadoPara(6))).toHaveLength(1);
    expect(within(grupo("terca")).getByText(copiadoPara(6))).toBeInTheDocument();
    expect(within(grupo("sexta")).queryByText(copiadoPara(6))).toBeNull();
  });

  it("o singular: «Copiado para 1 dia.»", async () => {
    montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiarNenhum }));
    await tocar(within(folha()).getByRole("switch", { name: nomeDoDia("quinta") }));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    expect(screen.getByText(copiadoPara(1))).toBeInTheDocument();
  });

  it("copia os períodos como estão, mesmo vazios (o erro aparece nos dias de destino ao guardar)", async () => {
    const dias = diasDe();
    const origem = dias.map((d) =>
      d.dia === "quarta" ? { ...d, periodos: [periodoNoFormulario("", "")] } : d,
    );
    const m = montar(origem);
    await tocar(botaoDoDia("quarta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    expect(periodosDe(m.ultimo(), "sexta")).toEqual([["", ""]]);
  });

  it("copiar não deixa dois períodos com a mesma chave (cada dia tem as suas)", async () => {
    const m = montar(diasDe());
    await tocar(botaoDoDia("sexta", TEXTOS.copiarParaOutrosDias));
    await tocar(within(folha()).getByRole("button", { name: TEXTOS.copiar }));
    const chaves = m.ultimo().flatMap((d) => d.periodos.map((p) => p.chave));
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
