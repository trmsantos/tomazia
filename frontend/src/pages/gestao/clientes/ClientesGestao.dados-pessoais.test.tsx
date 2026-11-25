/**
 * F4-05b, `docs/ecras/F4-05b.md` secção 1.5 e critério 13 — **dados de terceiros** (nome, email,
 * telemóvel) só aparecem como TEXTO VISÍVEL na página e na folha. Nunca em `aria-label`, `title`,
 * `alt`, `name`/`id`/`data-` de elemento, `href`/`src`, `document.title`, endereço, `history.state`,
 * nem no nome acessível da folha — e a lista nunca se guarda fora da memória do componente
 * (`localStorage`, `sessionStorage`, cookies) nem vai parar à consola.
 *
 * O teste varre **todos os atributos de todos os elementos** do documento (`fugasDeDadosPessoais`)
 * com dados claramente falsos e **únicos** (uma pista como «Quimera» não aparece em mais lado
 * nenhum), em cada estado em que haja dados no ecrã: a lista, a folha aberta, a folha com erro, o
 * «não sei se foi eliminado», o CSV preparado. E os nomes acessíveis dos botões, ligações, regiões
 * e da folha (`getByRole(..., { name })`, que calcula o nome a sério).
 *
 * Um controlo prova que a varredura **vê**: um elemento posto à mão com o nome num `aria-label` é
 * apanhado — senão «não encontrei nada» passava por «está limpo» (regra 10).
 */
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clienteDeTeste } from "../../../testes/clientes-dados";
import {
  T,
  abrirClientes,
  abrirFolhaDeEliminar,
  botaoExportar,
  confirmarEliminar,
  csvFalso,
  eliminar,
  eliminarFalso,
  erroDe,
  erroSemResposta,
  folhaDeEliminar,
  fugasDeDadosPessoais,
  nomesNaLista,
  obterFalso,
  papeisComNomeComDados,
  prepararApi,
  tocar,
  botoesEliminar,
} from "../../../testes/clientes-gestao";

vi.mock("../../../lib/api/gestao-clientes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-clientes")>()),
  obterClientes: vi.fn(),
  eliminarCliente: vi.fn(),
  descarregarClientesCsv: vi.fn(),
}));

const NOME = "Zélia Quimera";
const EMAIL = "zelia.quimera@exemplo.test";
const TELEMOVEL = "912340099";
/** Nome, email, telemóvel e as partes deles que alguém podia pôr num atributo. */
const PISTAS = [
  "Zélia",
  "Quimera",
  "zelia",
  "quimera@",
  "@exemplo",
  "exemplo.test",
  TELEMOVEL,
  "91234",
];

const ZELIA = clienteDeTeste({ id: 777, nome: NOME, email: EMAIL, telemovel: TELEMOVEL });
const OUTRA = clienteDeTeste({
  id: 778,
  nome: "Ana Exemplo",
  email: "ana@exemplo.test",
  telemovel: "912345678",
});

beforeEach(() => {
  prepararApi([ZELIA, OUTRA]);
});

function semFugas(onde: string): void {
  expect(fugasDeDadosPessoais(PISTAS), `atributos com dados pessoais (${onde})`).toEqual([]);
  expect(papeisComNomeComDados(PISTAS), `nomes acessíveis com dados pessoais (${onde})`).toEqual(
    [],
  );
}

describe("o controlo: a varredura VÊ uma fuga", () => {
  it("um `aria-label`, um `title`, um `data-` e um `alt` com o nome são apanhados; o texto visível não", async () => {
    await abrirClientes();
    expect(screen.getByText(NOME)).toBeInTheDocument();
    expect(fugasDeDadosPessoais(PISTAS), "o texto visível não é uma fuga").toEqual([]);

    const intruso = document.createElement("button");
    intruso.setAttribute("aria-label", `Eliminar ${NOME}`);
    intruso.setAttribute("title", EMAIL);
    intruso.setAttribute("data-x", TELEMOVEL);
    intruso.setAttribute("alt", "Zélia");
    document.body.appendChild(intruso);

    expect(fugasDeDadosPessoais(PISTAS).length).toBeGreaterThanOrEqual(4);
    expect(papeisComNomeComDados(PISTAS).length).toBeGreaterThan(0);
    intruso.remove();
  });
});

describe("a lista", () => {
  it("nenhum atributo nem nome acessível leva nome, email ou telemóvel; o nome só como texto", async () => {
    await abrirClientes();

    expect(nomesNaLista()).toEqual([NOME, "Ana Exemplo"]);
    expect(document.body.textContent).toContain(EMAIL);
    expect(document.body.textContent).toContain(TELEMOVEL);
    semFugas("a lista");
  });

  it("os botões «Eliminar» têm o nome acessível «Eliminar» (descrito pelo nome, não rotulado por ele) e nunca um `aria-label`", async () => {
    await abrirClientes();
    for (const b of botoesEliminar()) {
      expect(b).not.toHaveAttribute("aria-label");
      expect(b).not.toHaveAttribute("aria-labelledby");
      expect(b).not.toHaveAttribute("title");
      expect(b.getAttribute("aria-describedby")).toMatch(/^cliente-nome-\d+$/);
    }
    // O `aria-describedby` aponta SÓ ao nome: nem o email nem o telemóvel são descrição.
    const alvo = document.getElementById(
      botoesEliminar()[0]?.getAttribute("aria-describedby") ?? "",
    );
    expect(alvo?.textContent).toBe(NOME);
    expect(alvo?.textContent).not.toContain("@");
    expect(screen.getAllByRole("button", { name: /^Eliminar$/ })).toHaveLength(2);
  });

  it("o email e o telemóvel nunca são `aria-describedby` de ninguém", async () => {
    await abrirClientes();
    const descritos = Array.from(document.querySelectorAll("[aria-describedby]")).flatMap((no) =>
      (no.getAttribute("aria-describedby") ?? "").split(/\s+/),
    );
    for (const id of descritos) {
      const texto = document.getElementById(id)?.textContent ?? "";
      expect(texto).not.toContain("@");
      expect(texto).not.toContain(TELEMOVEL);
    }
  });

  it("as ligações do ecrã («Voltar a Mais») não levam dados no endereço", async () => {
    await abrirClientes();
    for (const a of Array.from(document.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/zelia|quimera|91234|@/i);
    }
  });

  it("nenhum `<img>` (nem `alt`): o ecrã não tem imagens", async () => {
    await abrirClientes();
    expect(document.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("a folha", () => {
  it("nome e email são texto visível dentro do <dialog>; o nome acessível é «Tem a certeza?» e nada mais leva dados", async () => {
    await abrirClientes();
    const f = await abrirFolhaDeEliminar(NOME);

    expect(f.textContent).toContain(NOME);
    expect(f.textContent).toContain(EMAIL);
    expect(screen.getByRole("dialog", { name: T.tituloDaFolha })).toBe(f);
    expect(f).not.toHaveAttribute("aria-label");
    expect(f.getAttribute("aria-labelledby")).not.toBeNull();
    const titulo = document.getElementById(f.getAttribute("aria-labelledby") ?? "");
    expect(titulo?.textContent).toBe(T.tituloDaFolha);
    semFugas("a folha aberta");
  });

  it("com o erro de 5xx e com a folha a eliminar: continua sem fugas", async () => {
    await abrirClientes();
    eliminarFalso.mockRejectedValueOnce(erroDe(500));
    await eliminar(NOME);
    expect(folhaDeEliminar()).toHaveTextContent(T.erroNaFolha);
    semFugas("a folha com erro");
  });

  it("o botão de confirmar não leva dados no nome (`Eliminar`/`A eliminar…`)", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(NOME);
    expect(confirmarEliminar()).not.toHaveAttribute("aria-label");
    expect(confirmarEliminar().textContent).toBe(T.eliminar);
  });
});

describe("os outros estados", () => {
  it("«não sei se foi eliminado» (a verificar e a verificação falhada): sem fugas", async () => {
    await abrirClientes();
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    eliminarFalso.mockRejectedValueOnce(erroSemResposta());

    await eliminar(NOME);

    expect(document.body.textContent).toContain(T.semConfirmar);
    semFugas("a verificação falhada");
  });

  it("o CSV preparado (link retirado, aviso visível): sem fugas, e o link nunca leva dados no `download`", async () => {
    csvFalso.mockResolvedValue({
      nome: "clientes-2026-11-02.csv",
      href: "data:text/csv;charset=utf-8;base64,77u/",
    });
    await abrirClientes();
    await tocar(botaoExportar());
    semFugas("o CSV preparado");
  });

  it("os erros de carregar (nenhum cliente no ecrã): sem fugas e sem dados", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirClientes();
    expect(document.body.textContent).not.toContain(NOME);
    semFugas("o erro de carregar");
  });
});

describe("nada fora da memória do componente (secção 2)", () => {
  it("nem `localStorage`, nem `sessionStorage`, nem cookies: nem ao carregar, nem ao eliminar, nem ao exportar", async () => {
    const guardar = vi.spyOn(Storage.prototype, "setItem");
    await abrirClientes();
    await eliminar("Ana Exemplo");
    await tocar(botaoExportar());

    expect(guardar).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    guardar.mockRestore();
  });

  it("nada vai para a consola (nem dados pessoais, em lado nenhum)", async () => {
    const espiao = (["log", "info", "warn", "error", "debug"] as const).map((nivel) =>
      vi.spyOn(console, nivel).mockImplementation(() => undefined),
    );
    await abrirClientes();
    await abrirFolhaDeEliminar(NOME);
    await tocar(confirmarEliminar());
    const tudo = espiao
      .flatMap((e) => e.mock.calls)
      .map((chamada) => JSON.stringify(chamada))
      .join("\n");
    for (const pista of PISTAS) expect(tudo.toLowerCase()).not.toContain(pista.toLowerCase());
    for (const e of espiao) e.mockRestore();
  });

  it("o endereço e o histórico não levam dados (a navegação do ecrã é só «Voltar a Mais»)", async () => {
    await abrirClientes();
    await abrirFolhaDeEliminar(NOME);
    expect(window.location.href).not.toMatch(/zelia|quimera|91234/i);
    expect(JSON.stringify(window.history.state ?? null)).not.toMatch(/zelia|quimera|91234/i);
  });
});
