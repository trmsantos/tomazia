/**
 * F4-05a, plano 3.1 e 5.1 — o estado do formulário e o corpo do `PUT`.
 *
 * Contrato (`src/pages/gestao/definicoes/formulario.ts`):
 *
 * ```ts
 * export type FormularioDeDefinicoes = {
 *   wifi_rede: string; wifi_password: string; morada: string; telefone: string;
 *   instagram: string; maps_url: string;
 *   horario: HorarioNoFormulario;                       // ver horario-do-formulario.ts
 * };
 * export function formularioDaApi(definicoes: DefinicoesGestao): FormularioDeDefinicoes;
 *     // os textos tal e qual; horario = daApi(definicoes.horario) (null — também no `invalido` — dá sem_horario)
 * export function corpoDoPut(formulario: FormularioDeDefinicoes): PedidoDefinicoes;
 *     // EXATAMENTE as sete chaves, nunca `horario_estado`; rede e password SEM aparar (byte a byte);
 *     // instagram e maps_url por `normalizarLink`; horario = paraApi(...) (null em sem_horario).
 *     // Só se chama depois de a validação passar.
 * export function haAlteracoes(formulario: FormularioDeDefinicoes, base: DefinicoesGestao): boolean;
 *     // compara o corpo que se enviaria com o corpo que a `base` (o último estado confirmado) daria.
 * ```
 *
 * `base` com `horario_estado: "invalido"` dá `horario: null`; um horário não tocado
 * (`sem_horario`) não conta como alteração (D2). «Configurar o horário»
 * (`comecarHorario()`) e «Remover o horário» (`sem_horario` sobre um configurado) contam.
 */
import { describe, expect, it } from "vitest";

import {
  definicoesComHorarioInvalido,
  definicoesConfiguradas,
  definicoesVazias,
  horarioDeTeste,
  type DefinicoesGestao,
} from "../../../testes/gestao";
import { comDia, diaDe, periodoNoFormulario, type Editar } from "../../../testes/horario";
import { corpoDoPut, formularioDaApi, haAlteracoes } from "./formulario";
import { comecarHorario, daApi } from "./horario-do-formulario";

const SETE_CHAVES = [
  "horario",
  "instagram",
  "maps_url",
  "morada",
  "telefone",
  "wifi_password",
  "wifi_rede",
];

function semEstado(d: DefinicoesGestao): Omit<DefinicoesGestao, "horario_estado"> {
  const { horario_estado: _descartado, ...resto } = d;
  void _descartado;
  return resto;
}

describe("corpoDoPut", () => {
  it("de um formulário NÃO tocado é o corpo do GET, sem horario_estado (mudar só a rede deixa as outras seis iguais)", () => {
    const get = definicoesConfiguradas();
    const corpo = corpoDoPut(formularioDaApi(get));
    expect(corpo).toEqual(semEstado(get));
    expect(Object.keys(corpo).sort()).toEqual(SETE_CHAVES);

    const mudado = corpoDoPut({ ...formularioDaApi(get), wifi_rede: "outra-rede" });
    expect(mudado).toEqual({ ...semEstado(get), wifi_rede: "outra-rede" });
  });

  it("nunca leva horario_estado, em nenhum dos três estados", () => {
    for (const get of [
      definicoesConfiguradas(),
      definicoesVazias(),
      definicoesComHorarioInvalido(),
    ]) {
      expect(corpoDoPut(formularioDaApi(get))).not.toHaveProperty("horario_estado");
    }
  });

  it("a instalação nova: seis textos vazios e horario: null", () => {
    expect(corpoDoPut(formularioDaApi(definicoesVazias()))).toEqual(semEstado(definicoesVazias()));
  });

  it("com o horário `invalido` não tocado: horario: null (D2 — apaga o valor estragado)", () => {
    const corpo = corpoDoPut(formularioDaApi(definicoesComHorarioInvalido()));
    expect(corpo.horario).toBeNull();
    expect(corpo.wifi_rede).toBe(definicoesComHorarioInvalido().wifi_rede);
  });

  it.each([" Tomazia ", "abc ", "  ", "\t", " "])(
    "rede e password vão SEM aparar (byte a byte): %j",
    (valor) => {
      const f = {
        ...formularioDaApi(definicoesConfiguradas()),
        wifi_rede: valor,
        wifi_password: valor,
      };
      const corpo = corpoDoPut(f);
      expect(corpo.wifi_rede).toBe(valor);
      expect(corpo.wifi_password).toBe(valor);
    },
  );

  it("morada e telefone aparam-se antes de enviar (decisão do Tomás); a rede e a password não", () => {
    const f = {
      ...formularioDaApi(definicoesConfiguradas()),
      wifi_rede: " rede ",
      wifi_password: " abc ",
      morada: "  Rua de Exemplo, 12  ",
      telefone: " 912345678\t",
    };
    const corpo = corpoDoPut(f);
    expect(corpo.morada).toBe("Rua de Exemplo, 12");
    expect(corpo.telefone).toBe("912345678");
    expect(corpo.wifi_rede).toBe(" rede ");
    expect(corpo.wifi_password).toBe(" abc ");
  });

  it("a password do servidor, com o espaço no fim, volta igual", () => {
    expect(corpoDoPut(formularioDaApi(definicoesConfiguradas())).wifi_password).toBe(
      "cerveja-fresca-2026 ",
    );
  });

  it("instagram e maps_url levam o D4: aparados e com https://; o resto não se mexe", () => {
    const f = {
      ...formularioDaApi(definicoesConfiguradas()),
      instagram: "  instagram.com/bardatomazia ",
      maps_url: " http://maps.example.test/x ",
    };
    const corpo = corpoDoPut(f);
    expect(corpo.instagram).toBe("https://instagram.com/bardatomazia");
    expect(corpo.maps_url).toBe("https://maps.example.test/x");
    expect(corpo.wifi_rede).toBe("tomazia-exemplo");
  });

  it('um link só de espaços vai como "" (apaga o campo; nunca null)', () => {
    const corpo = corpoDoPut({ ...formularioDaApi(definicoesConfiguradas()), instagram: "   " });
    expect(corpo.instagram).toBe("");
  });

  it("o horário: sete dias de segunda a domingo; fechado vai com periodos: []; períodos por ordem de abertura", () => {
    const base = formularioDaApi(definicoesConfiguradas());
    if (base.horario.modo !== "editar") throw new Error("devia ser editar");
    const sexta = diaDe(base.horario, "sexta");
    const baralhado: Editar = comDia(
      comDia(base.horario, "sexta", { periodos: [...sexta.periodos].reverse() }),
      "terca",
      { estado: "fechado" },
    );
    const corpo = corpoDoPut({ ...base, horario: baralhado });

    expect(corpo.horario?.map((d) => d.dia)).toEqual([
      "segunda",
      "terca",
      "quarta",
      "quinta",
      "sexta",
      "sabado",
      "domingo",
    ]);
    expect(corpo.horario?.find((d) => d.dia === "terca")?.periodos).toEqual([]);
    expect(corpo.horario?.find((d) => d.dia === "sexta")?.periodos).toEqual([
      { abre: "12:00", fecha: "15:00" },
      { abre: "19:00", fecha: "02:00" },
    ]);
  });

  it("sem_horario → horario: null", () => {
    const corpo = corpoDoPut({
      ...formularioDaApi(definicoesConfiguradas()),
      horario: { modo: "sem_horario" },
    });
    expect(corpo.horario).toBeNull();
  });
});

describe("haAlteracoes", () => {
  it("falso logo a seguir ao GET (nos três estados)", () => {
    for (const get of [
      definicoesConfiguradas(),
      definicoesVazias(),
      definicoesComHorarioInvalido(),
    ]) {
      expect(haAlteracoes(formularioDaApi(get), get)).toBe(false);
    }
  });

  it("verdadeiro ao mudar um espaço no WiFi (a password inclusive, sem trim)", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, wifi_password: "cerveja-fresca-2026" }, get)).toBe(true);
    expect(haAlteracoes({ ...f, wifi_password: "cerveja-fresca-2026  " }, get)).toBe(true);
    expect(haAlteracoes({ ...f, wifi_rede: "tomazia-exemplo " }, get)).toBe(true);
  });

  it("um espaço a mais na morada ou no telefone não é alteração (o que se enviaria é igual); na password é", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, morada: `${get.morada} ` }, get)).toBe(false);
    expect(haAlteracoes({ ...f, telefone: ` ${get.telefone}` }, get)).toBe(false);
    expect(haAlteracoes({ ...f, wifi_password: `${get.wifi_password} ` }, get)).toBe(true);
  });

  it("repor o valor de antes desliga", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, wifi_rede: "x" }, get)).toBe(true);
    expect(haAlteracoes({ ...f, wifi_rede: get.wifi_rede }, get)).toBe(false);
  });

  it("cada um dos seis textos conta", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    for (const campo of [
      "wifi_rede",
      "wifi_password",
      "morada",
      "telefone",
      "instagram",
      "maps_url",
    ] as const) {
      expect(haAlteracoes({ ...f, [campo]: `${get[campo]}x` }, get), campo).toBe(true);
    }
  });

  it("o horário não tocado, com `invalido`, não conta como alteração (D2)", () => {
    const get = definicoesComHorarioInvalido();
    expect(haAlteracoes(formularioDaApi(get), get)).toBe(false);
    expect(haAlteracoes({ ...formularioDaApi(get), wifi_rede: "x" }, get)).toBe(true);
  });

  it("«Configurar o horário» liga (nao_configurado e invalido)", () => {
    for (const get of [definicoesVazias(), definicoesComHorarioInvalido()]) {
      expect(haAlteracoes({ ...formularioDaApi(get), horario: comecarHorario() }, get)).toBe(true);
    }
  });

  it("abrir o editor e voltar a sem_horario (cancelar) volta a falso", () => {
    const get = definicoesVazias();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, horario: comecarHorario() }, get)).toBe(true);
    expect(haAlteracoes({ ...f, horario: { modo: "sem_horario" } }, get)).toBe(false);
  });

  it("«Remover o horário» liga; repor os dias desliga", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, horario: { modo: "sem_horario" } }, get)).toBe(true);
    expect(haAlteracoes({ ...f, horario: daApi(get.horario) }, get)).toBe(false);
  });

  it("fechar e reabrir um dia dá o mesmo que não tocar", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    if (f.horario.modo !== "editar") throw new Error("devia ser editar");
    const fechado = comDia(f.horario, "terca", { estado: "fechado" });
    expect(haAlteracoes({ ...f, horario: fechado }, get)).toBe(true);
    const reaberto = comDia(fechado, "terca", { estado: "aberto" });
    expect(haAlteracoes({ ...f, horario: reaberto }, get)).toBe(false);
  });

  it("uma hora diferente, ou um período a mais, conta; a ordem dos períodos não", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    if (f.horario.modo !== "editar") throw new Error("devia ser editar");
    const sexta = diaDe(f.horario, "sexta");

    const outraHora = comDia(f.horario, "sexta", {
      periodos: sexta.periodos.map((p, i) => (i === 0 ? { ...p, abre: "11:00" } : p)),
    });
    expect(haAlteracoes({ ...f, horario: outraHora }, get)).toBe(true);

    const maisUm = comDia(f.horario, "sexta", {
      periodos: [...sexta.periodos, periodoNoFormulario("22:00", "23:00")],
    });
    expect(haAlteracoes({ ...f, horario: maisUm }, get)).toBe(true);

    const trocados = comDia(f.horario, "sexta", { periodos: [...sexta.periodos].reverse() });
    expect(haAlteracoes({ ...f, horario: trocados }, get)).toBe(false);
  });

  it("um dia fechado com períodos escondidos não é alteração (envia [] como antes)", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    if (f.horario.modo !== "editar") throw new Error("devia ser editar");
    const h = comDia(f.horario, "segunda", { periodos: [periodoNoFormulario("17:00", "23:00")] });
    expect(haAlteracoes({ ...f, horario: h }, get)).toBe(false);
  });

  it("espaços nos links não contam se o resultado normalizado for igual", () => {
    const get = definicoesConfiguradas();
    const f = formularioDaApi(get);
    expect(haAlteracoes({ ...f, maps_url: `  ${get.maps_url} ` }, get)).toBe(false);
    expect(horarioDeTeste()).toHaveLength(7);
  });
});
