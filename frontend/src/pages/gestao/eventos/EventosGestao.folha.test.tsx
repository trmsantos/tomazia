/**
 * F4-03, spec 7 e plano 5.1/5.2/5.3/4.2 — a folha de criar e de editar evento.
 *
 *  - **Criar:** dois botões no fim, «Publicar» (principal) e «Guardar rascunho», **sem
 *    interruptor «Publicado»**; valida só ao guardar, todos os erros de uma vez e o foco no
 *    primeiro; `POST` com o `inicio` em UTC (a hora escrita é **a de Lisboa**, qualquer que seja
 *    o fuso do aparelho); sem resposta **nunca reenvia**.
 *  - **Editar:** pré-preenchida com a hora de Lisboa; **só as chaves que mudaram** no `PATCH`;
 *    rascunho com dois botões, publicado só «Guardar alterações» (nunca despublica); sem
 *    alterações fecha sem pedido; cartaz só se lê.
 *  - **Publicar um rascunho sem data:** o interruptor da linha não faz pedido (ver
 *    `EventosGestao.test.tsx`); aqui, «Publicar» na folha sem data não faz pedido e dá o erro na
 *    data; `422 evento_sem_data` leva ao mesmo erro (nunca a `mensagem` do backend).
 *
 * Contrato: ver `src/testes/eventos-gestao.tsx` e `formulario.test.ts`.
 *
 * **Deixa passar:** o foco por omissão e o regresso do foco ao abridor (comportamento nativo do
 * `<dialog>`), o seletor nativo de data/hora e o layout (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatarDataDoEvento } from "../../../lib/formato/data-do-evento";
import { AGORA } from "../../../testes/eventos";
import {
  erro401,
  erro404,
  erro422,
  erro422EventoSemData,
  erroDoServidor,
  erroSemResposta,
  eventoDeTeste,
  eventosDeGestaoDeTeste,
  type EventoGestao,
  type RespostaEventosGestao,
} from "../../../testes/gestao";
import {
  abrirEventos,
  alterarFalso,
  aviso,
  assentar,
  botao,
  comSinal,
  criarFalso,
  escrever,
  folha,
  haBotao,
  haFolha,
  marcarIncompleto,
  obterFalso,
  pendente,
  prepararApi,
  preencher,
  secao,
  tocar,
  PROIBIDOS_DA_F4_03,
} from "../../../testes/eventos-gestao";
import { TEXTOS } from "./textos";

vi.mock("../../../lib/api/gestao-eventos", () => ({
  obterEventosGestao: vi.fn(),
  criarEvento: vi.fn(),
  alterarEvento: vi.fn(),
  eliminarEvento: vi.fn(),
  duplicarEvento: vi.fn(),
}));

beforeEach(() => {
  prepararApi();
});

async function abrirCriar(): Promise<void> {
  await tocar(screen.getByRole("button", { name: TEXTOS.novoEvento }));
}
async function abrirEditar(titulo: string): Promise<void> {
  await tocar(screen.getByRole("button", { name: titulo }));
}
function campo(etiqueta: string): HTMLInputElement {
  return within(folha()).getByLabelText(etiqueta);
}
function erroDe(etiqueta: string): string {
  const el = campo(etiqueta);
  expect(el, `${etiqueta} marcado como inválido`).toHaveAttribute("aria-invalid", "true");
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}
function semErroEm(etiqueta: string): void {
  expect(campo(etiqueta)).not.toHaveAttribute("aria-invalid", "true");
}
/** Cria o evento «Fado novo», 20/11/2026 às 22:00 (uma hora de Lisboa e de UTC em novembro). */
function preencherValido(extra: { descricao?: string } = {}): void {
  preencher({ titulo: "Fado novo", data: "2026-11-20", hora: "22:00", ...extra });
}
function criado(parcial: Partial<EventoGestao> = {}): EventoGestao {
  return eventoDeTeste({ id: 50, titulo: "Fado novo", inicio: "2026-11-20T22:00:00Z", ...parcial });
}
function listaCom(
  mexer: (l: RespostaEventosGestao) => void,
  base: RespostaEventosGestao = eventosDeGestaoDeTeste(),
): RespostaEventosGestao {
  mexer(base);
  return base;
}

describe("criar: a folha", () => {
  it("«Novo evento» abre a folha «Novo evento» com Título, Descrição (opcional), Data e Hora, vazios, sem valor por omissão", async () => {
    await abrirEventos();
    await abrirCriar();

    expect(screen.getByRole("dialog", { name: TEXTOS.tituloCriar })).toBeInTheDocument();
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveValue("");
    expect(campo(TEXTOS.etiquetaDescricao).tagName).toBe("TEXTAREA");
    expect(campo(TEXTOS.etiquetaDescricao)).toHaveValue("");
    expect(campo(TEXTOS.etiquetaData)).toHaveAttribute("type", "date");
    expect(campo(TEXTOS.etiquetaData)).toHaveValue("");
    expect(campo(TEXTOS.etiquetaHora)).toHaveAttribute("type", "time");
    expect(campo(TEXTOS.etiquetaHora)).toHaveValue("");
  });

  it("dois botões — «Publicar» e «Guardar rascunho» —, «Cancelar»; nada de interruptor, de estado nem de «Eliminar evento»", async () => {
    await abrirEventos();
    await abrirCriar();
    const f = within(folha());

    expect(f.getByRole("button", { name: TEXTOS.publicar })).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.guardarRascunho })).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.cancelar })).toBeInTheDocument();
    expect(f.queryByRole("switch")).toBeNull();
    expect(f.queryByRole("button", { name: TEXTOS.guardarAlteracoes })).toBeNull();
    expect(f.queryByRole("button", { name: TEXTOS.eliminarEvento })).toBeNull();
    expect(folha().textContent).not.toContain(TEXTOS.estadoRascunho);
    expect(folha().textContent).not.toMatch(PROIBIDOS_DA_F4_03);
  });

  it("guardar vazio: zero pedidos, todos os erros de uma vez, aria-invalid, foco no primeiro e «Corrige os campos assinalados.»", async () => {
    await abrirEventos();
    await abrirCriar();

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).not.toHaveBeenCalled();
    expect(erroDe(TEXTOS.etiquetaTitulo)).toContain(TEXTOS.erroTituloVazio);
    expect(erroDe(TEXTOS.etiquetaData)).toContain(TEXTOS.erroDataVazia);
    expect(erroDe(TEXTOS.etiquetaHora)).toContain(TEXTOS.erroHoraVazia);
    semErroEm(TEXTOS.etiquetaDescricao);
    expect(document.activeElement).toBe(campo(TEXTOS.etiquetaTitulo));
    expect(within(folha()).getByText(TEXTOS.corrigeOsCampos)).toBeInTheDocument();
  });

  it("os erros limpam-se ao escrever no campo, e só nesse", async () => {
    await abrirEventos();
    await abrirCriar();
    await tocar(botao(TEXTOS.guardarRascunho));

    escrever(TEXTOS.etiquetaTitulo, "F");
    semErroEm(TEXTOS.etiquetaTitulo);
    expect(campo(TEXTOS.etiquetaData)).toHaveAttribute("aria-invalid", "true");
  });

  it("não valida enquanto se escreve: só ao guardar", async () => {
    await abrirEventos();
    await abrirCriar();
    escrever(TEXTOS.etiquetaTitulo, "");
    escrever(TEXTOS.etiquetaData, "2026-11-20");
    semErroEm(TEXTOS.etiquetaTitulo);
    expect(within(folha()).queryByText(TEXTOS.erroTituloVazio)).toBeNull();
  });

  it("a descrição com mais de 1000 caracteres é erro ao guardar (a colagem não se corta em silêncio)", async () => {
    await abrirEventos();
    await abrirCriar();
    preencherValido({ descricao: "a".repeat(1001) });
    expect(campo(TEXTOS.etiquetaDescricao)).toHaveValue("a".repeat(1001));

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).not.toHaveBeenCalled();
    expect(erroDe(TEXTOS.etiquetaDescricao)).toContain(TEXTOS.erroDescricaoLonga);
  });

  it("vazio ≠ incompleto (regra 10): a hora escrita a meio diz «A hora não está completa.», não «Escolhe a hora.»", async () => {
    await abrirEventos();
    await abrirCriar();
    preencher({ titulo: "Fado novo", data: "2026-11-20" });
    marcarIncompleto(TEXTOS.etiquetaHora);

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).not.toHaveBeenCalled();
    const erro = erroDe(TEXTOS.etiquetaHora);
    expect(erro).toContain(TEXTOS.erroHoraIncompleta);
    expect(erro).not.toContain(TEXTOS.erroHoraVazia);
  });

  it("a hora que não existe (a noite em que os relógios avançam) é erro na hora e nenhum pedido", async () => {
    await abrirEventos();
    await abrirCriar();
    preencher({ titulo: "Noite curta", data: "2027-03-28", hora: "01:30" });

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).not.toHaveBeenCalled();
    expect(erroDe(TEXTOS.etiquetaHora)).toContain(TEXTOS.erroHoraInexistente);
    expect(document.activeElement).toBe(campo(TEXTOS.etiquetaHora));
  });

  it("a hora repetida (25/10, 01:30) passa: a primeira ocorrência, 00:30Z", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado());
    preencher({ titulo: "Noite longa", data: "2026-10-25", hora: "01:30" });
    await tocar(botao(TEXTOS.guardarRascunho));
    expect(criarFalso).toHaveBeenCalledWith(
      expect.objectContaining({ inicio: "2026-10-25T00:30:00Z" }),
      comSinal,
    );
  });
});

describe("criar: guardar", () => {
  it("«Publicar»: POST com `publicado: true`, o `inicio` em UTC com Z e sem `descricao` quando vazia", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado());
    preencherValido();

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).toHaveBeenCalledTimes(1);
    expect(criarFalso).toHaveBeenCalledWith(
      { titulo: "Fado novo", inicio: "2026-11-20T22:00:00Z", publicado: true },
      comSinal,
    );
  });

  it("«Guardar rascunho»: `publicado: false`, com a descrição quando a há", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado({ publicado: false }));
    preencherValido({ descricao: "Uma noite.\nDuas linhas." });

    await tocar(botao(TEXTOS.guardarRascunho));

    expect(criarFalso).toHaveBeenCalledWith(
      {
        titulo: "Fado novo",
        inicio: "2026-11-20T22:00:00Z",
        descricao: "Uma noite.\nDuas linhas.",
        publicado: false,
      },
      comSinal,
    );
  });

  it("a hora de verão é a de Lisboa: 22:00 de julho vão como 21:00Z", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado());
    preencher({ titulo: "Verão", data: "2027-07-02", hora: "22:00" });
    await tocar(botao(TEXTOS.publicar));
    expect(criarFalso).toHaveBeenCalledWith(
      expect.objectContaining({ inicio: "2027-07-02T21:00:00Z" }),
      comSinal,
    );
  });

  it("201: a folha fecha, a lista recarrega e o aviso (sucesso, sem «Desfazer») diz que está no site", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado({ inicio: "2026-11-04T22:00:00Z" }));
    obterFalso.mockResolvedValueOnce(
      listaCom((l) => l.proximos.unshift(criado({ inicio: "2026-11-04T22:00:00Z" }))),
    );
    preencher({ titulo: "Fado novo", data: "2026-11-04", hora: "22:00" });

    await tocar(botao(TEXTOS.publicar));

    expect(haFolha(TEXTOS.tituloCriar)).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(
      within(secao(TEXTOS.proximos)).getByRole("button", { name: "Fado novo" }),
    ).toBeInTheDocument();
    expect(aviso()).toHaveTextContent(TEXTOS.eventoPublicadoNoSite);
    expect(
      within(aviso() as HTMLElement).queryByRole("button", { name: TEXTOS.desfazer }),
    ).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Fado novo" }));
  });

  it("publicado depois dos três primeiros: «o site só mostra os três»", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado());
    obterFalso.mockResolvedValueOnce(listaCom((l) => l.proximos.push(criado())));
    preencherValido();
    await tocar(botao(TEXTOS.publicar));
    expect(aviso()).toHaveTextContent(TEXTOS.eventoPublicadoSoTres);
  });

  it("publicado com data que já passou: cai no arquivo e o aviso diz que o site não o mostra; o foco vai ao botão do arquivo (recolhido)", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado({ inicio: "2026-10-30T22:00:00Z" }));
    obterFalso.mockResolvedValueOnce(
      listaCom((l) => l.arquivo.unshift(criado({ inicio: "2026-10-30T22:00:00Z" }))),
    );
    preencher({ titulo: "Fado novo", data: "2026-10-30", hora: "22:00" });

    await tocar(botao(TEXTOS.publicar));

    expect(aviso()).toHaveTextContent(TEXTOS.eventoNoArquivo);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: TEXTOS.verOArquivo(3) }),
    );
  });

  it("rascunho: «Rascunho guardado. Ainda não aparece no site.»", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado({ publicado: false }));
    obterFalso.mockResolvedValueOnce(
      listaCom((l) => l.rascunhos.unshift(criado({ publicado: false }))),
    );
    preencherValido();

    await tocar(botao(TEXTOS.guardarRascunho));

    expect(aviso()).toHaveTextContent(TEXTOS.rascunhoGuardado);
    expect(
      within(secao(TEXTOS.rascunhos)).getByRole("button", { name: "Fado novo" }),
    ).toBeInTheDocument();
  });

  it("a guardar: «A guardar…» no botão carregado, o outro e os campos aria-disabled, a folha não fecha e uma segunda pressão não envia", async () => {
    await abrirEventos();
    await abrirCriar();
    const resposta = pendente<EventoGestao>();
    criarFalso.mockReturnValueOnce(resposta.promessa);
    preencherValido();

    await tocar(botao(TEXTOS.publicar));

    expect(botao(TEXTOS.aGuardar)).toHaveAttribute("aria-busy", "true");
    expect(botao(TEXTOS.aGuardar)).toHaveAttribute("aria-disabled", "true");
    expect(botao(TEXTOS.guardarRascunho)).toHaveAttribute("aria-disabled", "true");
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveAttribute("aria-disabled", "true");
    expect(haFolha(TEXTOS.tituloCriar)).toBe(true);

    fireEvent.click(botao(TEXTOS.aGuardar));
    fireEvent.click(botao(TEXTOS.guardarRascunho));
    await assentar();
    expect(criarFalso).toHaveBeenCalledTimes(1);

    resposta.resolver(criado());
    await assentar();
  });

  it("422 com `campo=titulo`: erro junto do título (aria-invalid, foco), a folha aberta, os valores mantidos, nunca a mensagem do backend", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erro422("titulo"));
    preencherValido({ descricao: "Texto" });

    await tocar(botao(TEXTOS.publicar));

    expect(erroDe(TEXTOS.etiquetaTitulo)).toContain(TEXTOS.erro422Titulo);
    expect(document.activeElement).toBe(campo(TEXTOS.etiquetaTitulo));
    expect(haFolha(TEXTOS.tituloCriar)).toBe(true);
    expect(campo(TEXTOS.etiquetaDescricao)).toHaveValue("Texto");
    expect(within(folha()).getByText(TEXTOS.corrigeOsCampos)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("mensagem do backend");
  });

  it.each([
    ["descricao", TEXTOS.etiquetaDescricao, TEXTOS.erro422Descricao],
    ["inicio", TEXTOS.etiquetaData, TEXTOS.erro422Data],
  ])("422 com `campo=%s`: erro no campo certo", async (campoDoErro, etiqueta, frase) => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erro422(campoDoErro));
    preencherValido();
    await tocar(botao(TEXTOS.publicar));
    expect(erroDe(etiqueta)).toContain(frase);
  });

  it.each([["publicado"], [null]])(
    "422 com `campo=%s` (ou sem campo): a linha da folha, sem campo marcado",
    async (c) => {
      await abrirEventos();
      await abrirCriar();
      criarFalso.mockRejectedValueOnce(erro422(c));
      preencherValido();
      await tocar(botao(TEXTOS.publicar));
      expect(within(folha()).getByText(TEXTOS.erro422SemCampo)).toBeInTheDocument();
      semErroEm(TEXTOS.etiquetaTitulo);
    },
  );

  it("5xx: a frase do servidor na folha, que não fecha, com os valores mantidos", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erroDoServidor(500));
    preencherValido();
    await tocar(botao(TEXTOS.publicar));

    expect(within(folha()).getByText(TEXTOS.servidorGuardar)).toBeInTheDocument();
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveValue("Fado novo");
    expect(haBotao(TEXTOS.publicar)).toBe(true);
  });

  it("sem resposta: UM só POST, recarrega por baixo e, se o evento (mesmo título e instante) já lá está, a folha fecha e diz que ficou guardado", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockResolvedValueOnce(listaCom((l) => l.proximos.push(criado())));
    preencherValido();

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haFolha(TEXTOS.tituloCriar)).toBe(false);
    expect(aviso()).toHaveTextContent(TEXTOS.eventoGuardadoSemResposta);
    expect(aviso()?.textContent).not.toContain(TEXTOS.servidorGuardar);
  });

  it("sem resposta e o evento não aparece: a folha fica com os valores, diz «não encontrei o evento na lista», e não reenvia sozinha", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erroSemResposta());
    preencherValido();

    await tocar(botao(TEXTOS.publicar));

    expect(criarFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(haFolha(TEXTOS.tituloCriar)).toBe(true);
    expect(within(folha()).getByText(TEXTOS.criarNaoEncontrado)).toBeInTheDocument();
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveValue("Fado novo");
    expect(within(folha()).queryByText(TEXTOS.servidorGuardar)).toBeNull();
    await assentar();
    expect(criarFalso, "nunca reenvia sozinho").toHaveBeenCalledTimes(1);
  });

  it("um evento com o mesmo título mas outra hora NÃO conta como «já está» (comparação exata)", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockResolvedValueOnce(
      listaCom((l) => l.proximos.push(criado({ inicio: "2026-11-20T23:00:00Z" }))),
    );
    preencherValido();
    await tocar(botao(TEXTOS.publicar));
    expect(haFolha(TEXTOS.tituloCriar)).toBe(true);
    expect(within(folha()).getByText(TEXTOS.criarNaoEncontrado)).toBeInTheDocument();
  });

  it("401: aoPerderSessao uma vez; o escrito perde-se", async () => {
    const sessao = await abrirEventos();
    await abrirCriar();
    criarFalso.mockRejectedValueOnce(erro401());
    preencherValido();
    await tocar(botao(TEXTOS.publicar));
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(criarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("criar: a data e a hora (sempre Lisboa) e os avisos", () => {
  async function comOAparelhoEm(fuso: string, correr: () => Promise<void>): Promise<void> {
    const anterior = process.env.TZ;
    process.env.TZ = fuso;
    try {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone, `o TZ não pegou: ${fuso}`).toBe(
        fuso,
      );
      await correr();
    } finally {
      process.env.TZ = anterior;
    }
  }

  it.each(["Atlantic/Azores", "America/Sao_Paulo", "Asia/Tokyo"])(
    "com o aparelho em %s: o aviso de fuso aparece e o valor enviado é o de Lisboa (22:00 → 22:00Z)",
    async (fuso) => {
      await comOAparelhoEm(fuso, async () => {
        await abrirEventos();
        await abrirCriar();
        criarFalso.mockResolvedValueOnce(criado());
        expect(within(folha()).getByText(TEXTOS.avisoDeFuso)).toBeInTheDocument();

        preencherValido();
        await tocar(botao(TEXTOS.publicar));

        expect(criarFalso).toHaveBeenCalledWith(
          expect.objectContaining({ inicio: "2026-11-20T22:00:00Z" }),
          comSinal,
        );
      });
    },
  );

  it("com o aparelho em Lisboa o aviso de fuso não aparece (seria ruído)", async () => {
    await comOAparelhoEm("Europe/Lisbon", async () => {
      await abrirEventos();
      await abrirCriar();
      expect(within(folha()).queryByText(TEXTOS.avisoDeFuso)).toBeNull();
    });
  });

  it("data que já passou: aviso ligado ao campo (aria-describedby), não é erro, não bloqueia", async () => {
    await abrirEventos();
    await abrirCriar();
    criarFalso.mockResolvedValueOnce(criado({ inicio: "2026-10-30T22:00:00Z" }));
    preencher({ titulo: "Fado novo", data: "2026-10-30", hora: "22:00" });

    // Em «Novo evento» ainda se pode escolher não publicar: a frase condiciona («Se publicares»).
    const aviso_ = within(folha()).getByText(TEXTOS.dataPassadaRascunho);
    expect(within(folha()).queryByText(TEXTOS.dataPassada)).toBeNull();
    expect(campo(TEXTOS.etiquetaData).getAttribute("aria-describedby") ?? "").toContain(aviso_.id);
    expect(campo(TEXTOS.etiquetaData)).not.toHaveAttribute("aria-invalid", "true");

    await tocar(botao(TEXTOS.publicar));
    expect(criarFalso).toHaveBeenCalledTimes(1);
  });

  it("hoje (depois das 00:00 de Lisboa) não é «já passou»; a data de amanhã também não", async () => {
    await abrirEventos();
    await abrirCriar();
    preencher({ data: "2026-11-02" });
    expect(within(folha()).queryByText(TEXTOS.dataPassadaRascunho)).toBeNull();
    preencher({ data: "2026-11-01" });
    expect(within(folha()).getByText(TEXTOS.dataPassadaRascunho)).toBeInTheDocument();
  });

  it("a frase da data passada depende de o evento já estar publicado: num rascunho condiciona, num publicado afirma", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    preencher({ data: "2026-10-30" });
    expect(within(folha()).getByText(TEXTOS.dataPassada)).toBeInTheDocument();
    expect(within(folha()).queryByText(TEXTOS.dataPassadaRascunho)).toBeNull();
    await tocar(botao(TEXTOS.cancelar));
    await tocar(botao(TEXTOS.saidaSair));

    await abrirEditar("Rascunho com data");
    preencher({ data: "2026-10-30" });
    expect(within(folha()).getByText(TEXTOS.dataPassadaRascunho)).toBeInTheDocument();
    expect(within(folha()).queryByText(TEXTOS.dataPassada)).toBeNull();
  });

  it("daqui a mais de um ano: aviso «Confirma o ano», sem bloquear", async () => {
    await abrirEventos();
    await abrirCriar();
    preencher({ data: "2028-01-05" });
    expect(within(folha()).getByText(TEXTOS.dataLonge)).toBeInTheDocument();
    preencher({ data: "2027-06-01" });
    expect(within(folha()).queryByText(TEXTOS.dataLonge)).toBeNull();
  });

  it.each([
    ["00:00", true],
    ["00:30", true],
    ["05:59", true],
    ["06:00", false],
    ["22:00", false],
  ])("a ajuda da meia-noite com a hora %s: %s", async (hora, aparece) => {
    await abrirEventos();
    await abrirCriar();
    preencher({ hora });
    const ajuda = within(folha()).queryByText(TEXTOS.ajudaMeiaNoite);
    expect(ajuda !== null).toBe(aparece);
  });

  it("sem hora escrita, a ajuda da meia-noite não aparece", async () => {
    await abrirEventos();
    await abrirCriar();
    expect(within(folha()).queryByText(TEXTOS.ajudaMeiaNoite)).toBeNull();
  });

  it("o contador da descrição só aparece perto do limite: 899 não, 900 «Faltam 100», 999 no singular, 1000 o limite", async () => {
    await abrirEventos();
    await abrirCriar();
    escrever(TEXTOS.etiquetaDescricao, "a".repeat(899));
    expect(within(folha()).queryByText(/^Falt/)).toBeNull();
    escrever(TEXTOS.etiquetaDescricao, "a".repeat(900));
    expect(within(folha()).getByText(TEXTOS.contadorFaltam(100))).toBeInTheDocument();
    escrever(TEXTOS.etiquetaDescricao, "a".repeat(999));
    expect(within(folha()).getByText(TEXTOS.contadorUm)).toBeInTheDocument();
    escrever(TEXTOS.etiquetaDescricao, "a".repeat(1000));
    expect(within(folha()).getByText(TEXTOS.contadorLimite)).toBeInTheDocument();
  });

  it("o contador conta pontos de código (um emoji conta um)", async () => {
    await abrirEventos();
    await abrirCriar();
    escrever(TEXTOS.etiquetaDescricao, "🎷".repeat(900));
    expect(within(folha()).getByText(TEXTOS.contadorFaltam(100))).toBeInTheDocument();
  });
});

describe("«Assim aparece no site» (a pré-visualização)", () => {
  it("só com título e data e hora válidos; usa a função da data do site e mostra a descrição inteira, sem cartaz", async () => {
    await abrirEventos();
    await abrirCriar();
    expect(
      within(folha()).queryByRole("heading", { level: 3, name: TEXTOS.assimApareceTitulo }),
    ).toBeNull();

    const longa = `${"Linha comprida. ".repeat(50)}\nÚltima linha.`;
    preencherValido({ descricao: longa });

    const f = within(folha());
    expect(
      f.getByRole("heading", { level: 3, name: TEXTOS.assimApareceTitulo }),
    ).toBeInTheDocument();
    const { grande, pequena } = formatarDataDoEvento("2026-11-20T22:00:00Z", AGORA);
    const cartao = f.getByRole("heading", {
      level: 3,
      name: new RegExp(`${grande}.*${pequena}.*Fado novo`),
    });
    expect(cartao).toBeInTheDocument();
    expect(folha().textContent).toContain("Última linha.");
    expect(folha().querySelector("img")).toBeNull();
    expect(f.getByText(TEXTOS.legendaRascunho)).toBeInTheDocument();
  });

  it("com a data incompleta ou o título vazio, não se desenha (nada de «Invalid Date»)", async () => {
    await abrirEventos();
    await abrirCriar();
    preencher({ titulo: "Fado novo", data: "2026-11-20", hora: "22:00" });
    escrever(TEXTOS.etiquetaTitulo, "");
    expect(within(folha()).queryByText(TEXTOS.assimApareceTitulo)).toBeNull();

    escrever(TEXTOS.etiquetaTitulo, "Fado novo");
    marcarIncompleto(TEXTOS.etiquetaHora);
    expect(within(folha()).queryByText(TEXTOS.assimApareceTitulo)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Invalid Date|NaN/);
  });

  it("atualiza-se enquanto se escreve; é de leitura (sem foco, sem aria-live)", async () => {
    await abrirEventos();
    await abrirCriar();
    preencherValido();
    escrever(TEXTOS.etiquetaTitulo, "Outro nome");
    const bloco = within(folha())
      .getByText(TEXTOS.assimApareceTitulo)
      .closest("section, div") as HTMLElement;
    expect(
      within(folha()).getByRole("heading", { level: 3, name: /Outro nome/ }),
    ).toBeInTheDocument();
    expect(bloco.querySelector("[aria-live]")).toBeNull();
    expect(bloco.querySelector("a, button, input, textarea, [tabindex]")).toBeNull();
  });
});

describe("editar: a folha", () => {
  it("abre com o evento: título, descrição, e a data e a hora de LISBOA", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");

    expect(screen.getByRole("dialog", { name: TEXTOS.tituloEditar })).toBeInTheDocument();
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveValue("Fado ao vivo");
    expect(campo(TEXTOS.etiquetaDescricao)).toHaveValue(
      "Primeira linha da descrição.\nSegunda linha da descrição.",
    );
    expect(campo(TEXTOS.etiquetaData)).toHaveValue("2026-11-05");
    expect(campo(TEXTOS.etiquetaHora)).toHaveValue("22:00");
  });

  it("um evento de 00:30 mostra 00:30; um de hora de verão (21:00Z) mostra 22:00", async () => {
    await abrirEventos();
    await abrirEditar("Karaoke de teste");
    expect(campo(TEXTOS.etiquetaHora)).toHaveValue("00:30");
    expect(campo(TEXTOS.etiquetaData)).toHaveValue("2026-11-06");
    await tocar(botao(TEXTOS.cancelar));

    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(2) }));
    await abrirEditar("Fado de outubro");
    expect(campo(TEXTOS.etiquetaData)).toHaveValue("2026-10-15");
    expect(campo(TEXTOS.etiquetaHora)).toHaveValue("22:00");
  });

  it("rascunho sem data: data e hora vazias; descrição `null` é campo vazio", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho importado");
    expect(campo(TEXTOS.etiquetaData)).toHaveValue("");
    expect(campo(TEXTOS.etiquetaHora)).toHaveValue("");
    expect(campo(TEXTOS.etiquetaDescricao)).toHaveValue("");
  });

  it("rascunho: o estado em texto, «Publicar» e «Guardar rascunho»; nunca «Guardar alterações»", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho com data");
    const f = within(folha());

    expect(f.getByText(TEXTOS.estadoRascunho)).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.publicar })).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.guardarRascunho })).toBeInTheDocument();
    expect(f.queryByRole("button", { name: TEXTOS.guardarAlteracoes })).toBeNull();
    expect(f.queryByRole("switch")).toBeNull();
    expect(f.getByText(TEXTOS.legendaRascunho)).toBeInTheDocument();
  });

  it("publicado: o estado em texto e SÓ «Guardar alterações» — nem «Publicar», nem «Guardar rascunho» (editar nunca despublica)", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    const f = within(folha());

    expect(f.getByText(TEXTOS.estadoPublicado)).toBeInTheDocument();
    expect(f.getByRole("button", { name: TEXTOS.guardarAlteracoes })).toBeInTheDocument();
    expect(f.queryByRole("button", { name: TEXTOS.publicar })).toBeNull();
    expect(f.queryByRole("button", { name: TEXTOS.guardarRascunho })).toBeNull();
    expect(f.queryByRole("switch")).toBeNull();
    expect(f.getByText(TEXTOS.legendaPublicado)).toBeInTheDocument();
  });

  it("«Eliminar evento» existe na folha de editar, afastado, e só aí", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    expect(
      within(folha()).getByRole("button", { name: TEXTOS.eliminarEvento }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: TEXTOS.eliminarEvento })).toHaveLength(1);
  });

  it("cartaz: mostra-se a linha de que existe e não há controlo nenhum para o mudar; sem cartaz, nada", async () => {
    await abrirEventos();
    await tocar(screen.getByRole("button", { name: TEXTOS.verOArquivo(2) }));
    await abrirEditar("Noite de samba");

    expect(within(folha()).getByText(TEXTOS.temCartaz)).toBeInTheDocument();
    expect(folha().querySelector('input[type="file"]')).toBeNull();
    expect(folha().querySelector("img"), "o cartaz não se carrega na gestão").toBeNull();
    expect(folha().textContent).not.toMatch(PROIBIDOS_DA_F4_03);
    await tocar(botao(TEXTOS.cancelar));

    await abrirEditar("Fado de outubro");
    expect(within(folha()).queryByText(TEXTOS.temCartaz)).toBeNull();
  });
});

describe("editar: guardar só o que mudou", () => {
  it("só o título → PATCH só com `titulo`; nunca `publicado`", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11, titulo: "Fado novo" }));
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");

    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(11, { titulo: "Fado novo" }, comSinal);
  });

  it("título e hora → `titulo` e `inicio` (UTC); a descrição apagada vai como `null`", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11 }));
    preencher({ titulo: "Fado novo", hora: "23:00", descricao: "" });

    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(alterarFalso).toHaveBeenCalledWith(
      11,
      { titulo: "Fado novo", inicio: "2026-11-05T23:00:00Z", descricao: null },
      comSinal,
    );
  });

  it("sem alterações: fecha sem pedido e sem aviso", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");

    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(aviso()).toBeNull();
  });

  it("alterar e repor o valor é «sem alterações»: fecha sem pedido", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    escrever(TEXTOS.etiquetaTitulo, "x");
    escrever(TEXTOS.etiquetaTitulo, "Fado ao vivo");
    await tocar(botao(TEXTOS.guardarAlteracoes));
    expect(alterarFalso).not.toHaveBeenCalled();
  });

  it("rascunho sem alterações: «Guardar rascunho» fecha sem pedido; «Publicar» publica ({publicado: true})", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho com data");
    await tocar(botao(TEXTOS.guardarRascunho));
    expect(alterarFalso).not.toHaveBeenCalled();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);

    await abrirEditar("Rascunho com data");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21 }));
    await tocar(botao(TEXTOS.publicar));
    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(21, { publicado: true }, comSinal);
  });

  it("«Guardar rascunho» com alterações nunca manda `publicado`", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho com data");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, publicado: false }));
    escrever(TEXTOS.etiquetaTitulo, "Rascunho novo");
    await tocar(botao(TEXTOS.guardarRascunho));
    expect(alterarFalso).toHaveBeenCalledWith(21, { titulo: "Rascunho novo" }, comSinal);
  });

  it("apagar a data de um evento que a tinha: erro «Escolhe a data.» e nenhum pedido (o servidor recusa `inicio: null`)", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    escrever(TEXTOS.etiquetaData, "");
    escrever(TEXTOS.etiquetaHora, "");
    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(erroDe(TEXTOS.etiquetaData)).toContain(TEXTOS.erroDataVazia);
  });

  it("avisos: publicado → «Evento atualizado…»; rascunho → «Rascunho atualizado.»; a folha fecha e a lista recarrega", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 11 }));
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");
    await tocar(botao(TEXTOS.guardarAlteracoes));
    expect(aviso()).toHaveTextContent(TEXTOS.eventoAtualizado);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(obterFalso).toHaveBeenCalledTimes(2);

    await abrirEditar("Rascunho com data");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21, publicado: false }));
    escrever(TEXTOS.etiquetaTitulo, "Rascunho novo");
    await tocar(botao(TEXTOS.guardarRascunho));
    expect(aviso()).toHaveTextContent(TEXTOS.rascunhoAtualizado);
  });

  it("«Publicar» a partir da folha usa os avisos de publicar (depois dos três primeiros)", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho com data");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 21 }));
    obterFalso.mockResolvedValueOnce(
      listaCom((l) => {
        const i = l.rascunhos.findIndex((e) => e.id === 21);
        l.proximos.push({ ...(l.rascunhos.splice(i, 1)[0] as EventoGestao), publicado: true });
      }),
    );
    await tocar(botao(TEXTOS.publicar));
    expect(aviso()).toHaveTextContent(TEXTOS.eventoPublicadoSoTres);
  });
});

describe("editar: publicar um rascunho sem data", () => {
  it("«Publicar» sem escolher a data: nenhum pedido, o erro «para publicar, escolhe a data e a hora» na data e o foco lá", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho importado");

    await tocar(botao(TEXTOS.publicar));

    expect(alterarFalso).not.toHaveBeenCalled();
    expect(erroDe(TEXTOS.etiquetaData)).toContain(TEXTOS.erroPublicarSemData);
    expect(document.activeElement).toBe(campo(TEXTOS.etiquetaData));
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
  });

  it("«Guardar rascunho» sem data e sem alterações fecha sem pedido; com o título mudado manda só o título", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho importado");
    escrever(TEXTOS.etiquetaTitulo, "Importado e corrigido");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 22, publicado: false, inicio: null }));
    await tocar(botao(TEXTOS.guardarRascunho));
    expect(alterarFalso).toHaveBeenCalledWith(22, { titulo: "Importado e corrigido" }, comSinal);
  });

  it("escolhida a data e a hora: UM só PATCH `{inicio, publicado: true}`", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho importado");
    alterarFalso.mockResolvedValueOnce(eventoDeTeste({ id: 22 }));
    preencher({ data: "2026-11-20", hora: "22:00" });

    await tocar(botao(TEXTOS.publicar));

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(alterarFalso).toHaveBeenCalledWith(
      22,
      { inicio: "2026-11-20T22:00:00Z", publicado: true },
      comSinal,
    );
  });

  it("422 evento_sem_data (outro telemóvel limpou a data): a folha fica, o erro está na data com a frase própria — nunca a mensagem do backend —, e recarrega por baixo", async () => {
    await abrirEventos();
    await abrirEditar("Rascunho com data");
    alterarFalso.mockRejectedValueOnce(erro422EventoSemData());

    await tocar(botao(TEXTOS.publicar));

    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(erroDe(TEXTOS.etiquetaData)).toContain(TEXTOS.erroPublicarSemData);
    expect(document.activeElement).toBe(campo(TEXTOS.etiquetaData));
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("mensagem do backend");
  });
});

describe("editar: quando um pedido não corre bem", () => {
  it("404: a folha fecha, o aviso diz que já não existe e a lista recarrega", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockRejectedValueOnce(erro404("evento_inexistente"));
    obterFalso.mockResolvedValueOnce(listaCom((l) => void l.proximos.splice(0, 1)));
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");

    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(haFolha(TEXTOS.tituloEditar)).toBe(false);
    expect(aviso()).toHaveTextContent(TEXTOS.jaNaoExiste);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Fado ao vivo" })).toBeNull();
  });

  it("422 `titulo` e `inicio`: erro no campo certo, nunca a mensagem do backend", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockRejectedValueOnce(erro422("inicio"));
    escrever(TEXTOS.etiquetaHora, "23:00");
    await tocar(botao(TEXTOS.guardarAlteracoes));
    expect(erroDe(TEXTOS.etiquetaData)).toContain(TEXTOS.erro422Data);
    expect(document.body.textContent).not.toContain("mensagem do backend");
  });

  it("sem resposta: a folha fica com os valores, a frase «volta a tocar no mesmo botão» (repetir é seguro), UM só PATCH e recarrega por baixo", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockRejectedValueOnce(erroSemResposta());
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");

    await tocar(botao(TEXTOS.guardarAlteracoes));

    expect(alterarFalso).toHaveBeenCalledTimes(1);
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
    expect(campo(TEXTOS.etiquetaTitulo)).toHaveValue("Fado novo");
    expect(within(folha()).getByText(TEXTOS.semRespostaGuardar)).toBeInTheDocument();
    expect(within(folha()).queryByText(TEXTOS.servidorGuardar)).toBeNull();
    expect(obterFalso).toHaveBeenCalledTimes(2);
  });

  it("5xx: a frase do servidor na folha, que não fecha", async () => {
    await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockRejectedValueOnce(erroDoServidor(500));
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");
    await tocar(botao(TEXTOS.guardarAlteracoes));
    expect(within(folha()).getByText(TEXTOS.servidorGuardar)).toBeInTheDocument();
    expect(haFolha(TEXTOS.tituloEditar)).toBe(true);
  });

  it("401: aoPerderSessao uma vez", async () => {
    const sessao = await abrirEventos();
    await abrirEditar("Fado ao vivo");
    alterarFalso.mockRejectedValueOnce(erro401());
    escrever(TEXTOS.etiquetaTitulo, "Fado novo");
    await tocar(botao(TEXTOS.guardarAlteracoes));
    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });
});
