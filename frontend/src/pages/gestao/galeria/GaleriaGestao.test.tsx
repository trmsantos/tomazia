/**
 * F4-04, plano 7.2 e spec 4, 8 e 13 — o ecrã «Galeria» da gestão: carregar, os estados (regra 10),
 * a foto à vista, o que se mostra e o que nunca se mostra, a pré-carregada. Aprovar, rejeitar, os
 * pedidos sem resposta, a imagem que falha, enviar e sair têm os seus ficheiros
 * (`GaleriaGestao.aprovar.test.tsx`, `.rejeitar`, `.verificar`, `.enviar`, `.saida`).
 *
 * Contrato: ver `src/testes/fotos-gestao.tsx`. Onde o plano e a spec divergem, os textos e o
 * desenho são os da spec (aviso de 3 s, intervalo de 700 ms, «Verificar outra vez», folha de sair).
 *
 * **Regra 10, o que mais importa aqui:** rede, 5xx, um corpo ilegível ou um `TypeError` **nunca**
 * desenham uma foto, um botão de moderar nem «Não há fotos à espera.»; o vazio só vem de um `200`
 * com a lista vazia; nunca fica «a carregar» para sempre.
 *
 * **Deixa passar:** layout, 56 px, caixa quadrada, foco visível, contraste e axe (e2e).
 */
import { cleanup, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { enderecoDaImagem } from "../../../lib/api/gestao-fotos";
import {
  erro401,
  erroDoServidor,
  erroSemResposta,
  filaDeTeste,
  fotoPendenteDeTeste,
  LEGENDA_DE_255,
  type FotoPendente,
} from "../../../testes/gestao";
import {
  abrirGaleria,
  assentar,
  aviso,
  avancar,
  botaoAprovar,
  botaoEnviarDaPagina,
  botaoRejeitar,
  comSinal,
  h1,
  h2,
  haBotoesDeModerar,
  haBotao,
  idDaImagem,
  idsDasImagens,
  imagensDaPagina,
  imgAtual,
  imgsOcultas,
  obterFalso,
  pendente,
  prepararApi,
  PROIBIDOS_DA_F4_04,
  seccaoDasAprovadas,
  ficarPendenteAteAbortar,
  sessaoFalsa,
  tocar,
  TEXTOS,
} from "../../../testes/fotos-gestao";
import { ErroDaApi } from "../../../lib/api/cliente";
import { altDaFoto } from "./textos";

vi.mock("../../../lib/api/gestao-fotos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/gestao-fotos")>()),
  obterFilaDeModeracao: vi.fn(),
  aprovarFoto: vi.fn(),
  rejeitarFoto: vi.fn(),
  obterAprovadas: vi.fn(),
  eliminarFoto: vi.fn(),
}));
vi.mock("../../../lib/api/publico", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/publico")>()),
  obterGaleria: vi.fn(),
  enviarFoto: vi.fn(),
}));
vi.mock("../../../lib/imagens/reduzir", () => ({ reduzir: vi.fn() }));

beforeEach(() => {
  prepararApi();
});

function semFotoNemVazio(): void {
  expect(haBotoesDeModerar(), "nenhum botão de moderar").toBe(false);
  expect(imagensDaPagina(), "nenhuma foto").toEqual([]);
  expect(screen.queryByText(TEXTOS.vazioTitulo), "nunca «Não há fotos à espera.»").toBeNull();
  expect(screen.queryByText(TEXTOS.vazioLinha)).toBeNull();
  expect(screen.queryByRole("heading", { level: 2, name: /\(\d+\)/ })).toBeNull();
}

describe("carregar", () => {
  it("um GET com o sinal; o <h1> «Galeria» com tabindex -1; «Enviar foto» já à vista", async () => {
    await abrirGaleria();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(obterFalso).toHaveBeenCalledWith(comSinal);
    expect(h1()).toHaveTextContent(TEXTOS.titulo);
    expect(h1()).toHaveAttribute("tabindex", "-1");
    expect(botaoEnviarDaPagina()).toBeInTheDocument();
  });

  it("enquanto não responde: o <h2> sem número, um esqueleto sem texto (aria-busy), nenhum botão de moderar; o <h1> e «Enviar foto» já lá estão", async () => {
    obterFalso.mockReturnValue(new Promise(() => undefined));
    await abrirGaleria();

    expect(h1()).toBeInTheDocument();
    expect(botaoEnviarDaPagina()).toBeInTheDocument();
    expect(h2()).toHaveTextContent(new RegExp(`^${TEXTOS.fotosAEspera}$`));
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    const regiao = screen.getByRole("region", { name: TEXTOS.fotosAEspera });
    expect(
      (regiao.textContent ?? "").trim(),
      "o esqueleto não tem texto: a região só tem o título",
    ).toBe(TEXTOS.fotosAEspera);
    semFotoNemVazio();
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("desmontar aborta o pedido (a leitura aborta; um cancelamento não é um erro)", async () => {
    obterFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirGaleria();
    const sinal = (obterFalso.mock.calls[0]?.[0] as { sinal: AbortSignal }).sinal;
    expect(sinal.aborted).toBe(false);

    cleanup();

    expect(sinal.aborted).toBe(true);
  });

  it("no StrictMode o primeiro pedido é cancelado e isso não é um erro: no fim, a fila", async () => {
    let chamadas = 0;
    obterFalso.mockImplementation((opcoes) => {
      chamadas += 1;
      if (chamadas === 1) {
        return new Promise((_ok, falhar) => {
          opcoes?.sinal?.addEventListener("abort", () => {
            falhar(new DOMException("cancelado", "AbortError"));
          });
        });
      }
      return Promise.resolve({ fotos: filaDeTeste(3) });
    });

    await abrirGaleria(undefined, { estrito: true });

    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
  });

  it("o prazo de 10 s: sem resposta passados 10 s é «sem resposta» (e nunca o vazio)", async () => {
    obterFalso.mockImplementation(ficarPendenteAteAbortar);
    await abrirGaleria();
    await avancar(9_999);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();

    await avancar(1);

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.carregarSemResposta)).toBeInTheDocument();
    semFotoNemVazio();
  });
});

describe("200 com a lista vazia: o estado vazio (o «Feito quando»)", () => {
  it("«Não há fotos à espera.» e a linha, debaixo do <h2> sem número; sem botões de moderar", async () => {
    prepararApi([]);
    await abrirGaleria();

    expect(obterFalso).toHaveBeenCalledTimes(1);
    expect(h2()).toHaveTextContent(new RegExp(`^${TEXTOS.fotosAEspera}$`));
    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS.vazioLinha)).toBeInTheDocument();
    expect(haBotoesDeModerar()).toBe(false);
    expect(imagensDaPagina()).toEqual([]);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("o <h1> e «Enviar foto» ficam (o vazio é da secção, não da página); sem botão no vazio", async () => {
    prepararApi([]);
    await abrirGaleria();

    expect(h1()).toHaveTextContent(TEXTOS.titulo);
    expect(botaoEnviarDaPagina()).toBeInTheDocument();
    const vazio = screen.getByText(TEXTOS.vazioTitulo);
    const regiao = screen.getByRole("region", { name: TEXTOS.fotosAEspera });
    expect(regiao).toContainElement(vazio);
    expect(within(regiao).queryAllByRole("button")).toEqual([]);
  });
});

describe("erro ao carregar (regra 10): nunca foto, nunca botão de moderar, nunca «não há fotos»", () => {
  const ILEGIVEL = new ErroDaApi("O corpo não se sabe ler.", { estado: 200, codigo: null });

  it.each([
    ["sem resposta (rede)", () => Promise.reject(erroSemResposta()), true],
    ["500", () => Promise.reject(erroDoServidor(500)), false],
    ["403", () => Promise.reject(erroDoServidor(403)), false],
    ["corpo ilegível (ErroDaApi de estado 200)", () => Promise.reject(ILEGIVEL), false],
    ["um TypeError (o nosso código a rebentar)", () => Promise.reject(new TypeError("x")), false],
    [
      "um `criada_em` que não se sabe ler (o ecrã não pode rebentar nem ficar a carregar)",
      () =>
        Promise.resolve({ fotos: [fotoPendenteDeTeste({ id: 1, criada_em: "não é uma data" })] }),
      false,
    ],
    [
      "uma lista que não é lista",
      () => Promise.resolve({ fotos: {} } as unknown as { fotos: never[] }),
      false,
    ],
  ])("%s", async (_nome, falhar, semResposta) => {
    obterFalso.mockImplementation(falhar);

    await abrirGaleria();

    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    expect(
      screen.getByText(semResposta ? TEXTOS.carregarSemResposta : TEXTOS.carregarServidor),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEXTOS.tentarOutraVez })).toBeInTheDocument();
    semFotoNemVazio();
    expect(
      document.querySelector('[aria-busy="true"]'),
      "nunca «a carregar» para sempre",
    ).toBeNull();
    expect(h1()).toBeInTheDocument();
    expect(botaoEnviarDaPagina(), "o envio não depende da fila").toBeInTheDocument();
  });

  it("sem resposta e servidor dizem coisas diferentes", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirGaleria();
    expect(screen.queryByText(TEXTOS.carregarServidor)).toBeNull();
    cleanup();

    obterFalso.mockRejectedValueOnce(erroDoServidor(500));
    await abrirGaleria();
    expect(screen.queryByText(TEXTOS.carregarSemResposta)).toBeNull();
  });

  it("«Tentar outra vez»: «A tentar…» (aria-busy) enquanto corre, um só pedido por toque; depois a fila", async () => {
    obterFalso.mockRejectedValueOnce(erroSemResposta());
    await abrirGaleria();
    const segunda = pendente<{ fotos: ReturnType<typeof filaDeTeste> }>();
    obterFalso.mockReturnValueOnce(segunda.promessa);

    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));

    const ocupado = screen.getByRole("button", { name: TEXTOS.aTentar });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    await tocar(ocupado);
    expect(obterFalso, "um segundo toque não faz um terceiro pedido").toHaveBeenCalledTimes(2);

    segunda.resolver({ fotos: filaDeTeste(3) });
    await assentar();
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
  });

  it("«Tentar outra vez» que volta a falhar volta ao erro, sem foto", async () => {
    obterFalso.mockRejectedValue(erroSemResposta());
    await abrirGaleria();
    await tocar(screen.getByRole("button", { name: TEXTOS.tentarOutraVez }));
    expect(screen.getByText(TEXTOS.carregarTitulo)).toBeInTheDocument();
    semFotoNemVazio();
  });

  it("401 ao carregar: aoPerderSessao uma vez e nenhuma frase de erro", async () => {
    obterFalso.mockRejectedValue(erro401());
    const sessao = await abrirGaleria();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
  });
});

describe("200 com fotos: a primeira, com a contagem", () => {
  // F4-04b: o teste dizia «uma só região» porque a F4-04 não tinha mais nenhuma. A F4-04b acrescenta
  // a secção «Fotos no site» a seguir à fila (spec 2 e 11.1): agora são exatamente duas, a da fila
  // primeiro. O resto do teste (o <h2> e o nome da região da fila) não mudou.
  it("o <h2> diz «Fotos à espera (3)» e a região tem esse nome; duas regiões: a fila e, a seguir, «Fotos no site»", async () => {
    await abrirGaleria();

    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(3));
    expect(h2()).toHaveAttribute("tabindex", "-1");
    const fila = screen.getByRole("region", { name: TEXTOS.fotosAEsperaN(3) });
    expect(fila).toBeInTheDocument();
    const regioes = screen.getAllByRole("region");
    expect(regioes).toHaveLength(2);
    expect(regioes[0], "a fila vem primeiro").toBe(fila);
    expect(regioes[1], "e a secção das aprovadas a seguir").toBe(seccaoDasAprovadas());
    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
  });

  it("a ordem é a do servidor: a primeira é a atual, mesmo com ids e datas fora de ordem", async () => {
    prepararApi([
      fotoPendenteDeTeste({ id: 9, criada_em: "2026-11-02T09:00:00Z" }),
      fotoPendenteDeTeste({ id: 3, criada_em: "2026-11-01T09:00:00Z" }),
    ]);
    await abrirGaleria();
    expect(idDaImagem(imgAtual())).toBe(9);
    expect(imgsOcultas().map(idDaImagem)).toEqual([3]);
  });

  it("o <img> atual tem `src` = enderecoDaImagem(id) e `alt` = «Foto enviada {quando}», sem a legenda", async () => {
    await abrirGaleria();
    const [primeira] = filaDeTeste(3);

    expect(imgAtual().getAttribute("src")).toBe(enderecoDaImagem(101));
    expect(imgAtual().getAttribute("src")).toBe("/api/gestao/fotos/101/imagem");
    expect(imgAtual().getAttribute("alt")).toBe("Foto enviada ontem, às 23:40");
    expect(imgAtual().getAttribute("alt")).toBe(
      altDaFoto(primeira as FotoPendente, new Date("2026-11-02T10:00:00Z")),
    );
    expect(imgAtual().getAttribute("alt")).not.toContain("samba");
    expect(imgAtual().hidden).toBe(false);
  });

  it('existe UMA seguinte, `hidden`, `alt=""`, `loading="eager"`; a terceira NÃO existe no DOM', async () => {
    await abrirGaleria();

    expect(imgsOcultas()).toHaveLength(1);
    const oculta = imgsOcultas()[0] as HTMLImageElement;
    expect(oculta.getAttribute("src")).toBe(enderecoDaImagem(102));
    expect(oculta.getAttribute("alt")).toBe("");
    expect(oculta.getAttribute("loading")).toBe("eager");
    expect(idsDasImagens(), "só a atual e a seguinte: nunca a fila inteira").toEqual([101, 102]);
    expect(document.querySelectorAll("img").length).toBe(2);
  });

  it("com uma só foto não há seguinte para pré-carregar", async () => {
    prepararApi(filaDeTeste(1));
    await abrirGaleria();
    expect(idsDasImagens()).toEqual([101]);
    expect(imgsOcultas()).toEqual([]);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(1));
  });

  it("a linha da foto: «Enviada {quando}, por {nome}»; é a descrição dos dois botões", async () => {
    await abrirGaleria();
    const linha = screen.getByText("Enviada ontem, às 23:40, por Rita");
    expect(linha).toBeInTheDocument();
    for (const b of [botaoAprovar(), botaoRejeitar()]) {
      const id = b.getAttribute("aria-describedby");
      expect(id, "aria-describedby aponta para a linha da data e do nome").not.toBeNull();
      expect(document.getElementById(id ?? "")).toBe(linha);
    }
  });

  it("os nomes acessíveis são só o verbo: «Aprovar» e «Rejeitar»", async () => {
    await abrirGaleria();
    expect(botaoAprovar()).toHaveAccessibleName(TEXTOS.aprovar);
    expect(botaoRejeitar()).toHaveAccessibleName(TEXTOS.rejeitar);
  });

  it("a ordem do DOM e da tabulação: Enviar foto, Rejeitar, Aprovar", async () => {
    await abrirGaleria();
    const ordem = [botaoEnviarDaPagina(), botaoRejeitar(), botaoAprovar()];
    for (let i = 0; i < ordem.length - 1; i += 1) {
      const a = ordem[i] as HTMLElement;
      const b = ordem[i + 1] as HTMLElement;
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("os dois botões são grandes (min-h-grande, 56 px) e o «Rejeitar» da página não é vermelho (perigo só na folha)", async () => {
    await abrirGaleria();
    for (const b of [botaoAprovar(), botaoRejeitar()]) {
      const classes = `${b.className} ${b.parentElement?.className ?? ""}`;
      expect(classes, "56 px: o `min-h-grande` do D5").toMatch(/min-h-grande/);
    }
    expect(botaoRejeitar().className).not.toMatch(/bg-perigo/);
  });

  it("os botões começam inertes: a imagem ainda não carregou", async () => {
    await abrirGaleria();
    expect(botaoAprovar()).toHaveAttribute("aria-disabled", "true");
    expect(botaoRejeitar()).toHaveAttribute("aria-disabled", "true");
    expect(botaoAprovar()).not.toBeDisabled();
    expect(botaoRejeitar()).not.toBeDisabled();
  });
});

describe("o que se mostra de cada foto (spec 4.3) e o que nunca se mostra", () => {
  it("com legenda: «Legenda no site» e o texto, tal como vem (com & e emoji)", async () => {
    await abrirGaleria();
    expect(screen.getByText(TEXTOS.legendaNoSite)).toBeInTheDocument();
    expect(screen.getByText("Noite de samba 🎶 & amigos d'a casa")).toBeInTheDocument();
  });

  it("sem legenda nem nome (102): nada de «Legenda no site», nem «Sem legenda», e a linha acaba na hora", async () => {
    prepararApi(filaDeTeste(5).slice(1));
    await abrirGaleria();
    expect(screen.getByText("Enviada hoje, às 00:30")).toBeInTheDocument();
    expect(screen.queryByText(TEXTOS.legendaNoSite)).toBeNull();
    expect(document.body.textContent).not.toMatch(/sem legenda|, por /i);
  });

  it("a hora da uma da manhã escreve-se «à 01:10»", async () => {
    prepararApi(filaDeTeste(5).slice(2));
    await abrirGaleria();
    expect(screen.getByText(/^Enviada hoje, à 01:10, por Zé$/)).toBeInTheDocument();
  });

  it("a legenda de 255 carateres sem espaços quebra: a classe `break-words`", async () => {
    prepararApi(filaDeTeste(5).slice(2));
    await abrirGaleria();
    const legenda = screen.getByText(LEGENDA_DE_255);
    expect(`${legenda.className} ${legenda.parentElement?.className ?? ""}`).toMatch(/break-words/);
  });

  it("a legenda e o nome são texto: HTML na legenda não vira elemento (só texto do React; o S-13 proíbe a outra via)", async () => {
    prepararApi([
      fotoPendenteDeTeste({
        id: 7,
        descricao: '<b>negrito</b> <img src=x onerror="alert(1)">',
        enviada_por: "<i>Rita</i>",
      }),
    ]);
    await abrirGaleria();

    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("i")).toBeNull();
    expect(imagensDaPagina(), "só a imagem da foto, nenhuma injetada").toHaveLength(1);
    expect(screen.getByText('<b>negrito</b> <img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.getByText(/<i>Rita<\/i>/)).toBeInTheDocument();
  });

  it.each([101, 102, 103])("o `alt` da foto %i nunca repete a legenda nem o nome", async (id) => {
    const fila = filaDeTeste(5).filter((f) => f.id >= id);
    prepararApi(fila);
    await abrirGaleria();
    const alt = imgAtual().getAttribute("alt") ?? "";
    const foto = fila[0];
    expect(alt.startsWith("Foto enviada ")).toBe(true);
    if (foto?.descricao) expect(alt).not.toContain(foto.descricao.slice(0, 10));
    if (foto?.enviada_por) expect(alt).not.toContain(foto.enviada_por);
  });

  it("nunca o `ficheiro` nem o `id` no texto nem no DOM visível", async () => {
    await abrirGaleria();
    expect(document.body.innerHTML).not.toContain("foto-101.webp");
    expect(document.body.innerHTML).not.toContain("foto-102.webp");
    expect(document.body.textContent).not.toMatch(/\b10[123]\b/);
  });

  // F4-04b: o teste proibia «aprovadas|eliminar|retirar» na página inteira porque a F4-04 não tinha
  // lista das aprovadas nem «Eliminar». Agora existem, na secção «Fotos no site»; o que o teste
  // protege (a FILA não ganha nada novo e o «Desfazer» continua a não existir) passa a ler-se
  // na região da fila, e a página inteira só continua proibida de «desfazer» e «em lote».
  it("nada que não existe: sem «Desfazer» nem «em lote» na página; a fila não ganha «Eliminar» (esse é da secção «Fotos no site»)", async () => {
    await abrirGaleria();
    expect(haBotao(/desfazer/i)).toBe(false);
    expect(document.body.textContent).not.toMatch(PROIBIDOS_DA_F4_04);
    const fila = screen.getByRole("region", { name: TEXTOS.fotosAEsperaN(3) });
    expect(fila.textContent).not.toMatch(/eliminar|aprovadas|retirar/i);
    expect(within(fila).queryByRole("button", { name: /eliminar/i })).toBeNull();
  });

  it("o único aviso da página começa vazio (a região viva está no DOM desde o início)", async () => {
    await abrirGaleria();
    expect(aviso()).toBeNull();
  });
});

describe("a fila só se recarrega quando é preciso (sem polling)", () => {
  it("passado muito tempo, nenhum GET novo sozinho", async () => {
    await abrirGaleria();
    await avancar(10 * 60_000);
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it("voltar à aba (visibilitychange para «visible») recarrega em silêncio: a foto atual fica, as novas vão para o fim, sem esqueleto", async () => {
    await abrirGaleria();
    const atualAntes = imgAtual();
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(5) });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();

    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(5));
    expect(imgAtual(), "a foto que o dono tem à frente não muda").toBe(atualAntes);
    expect(document.querySelector('[aria-busy="true"]'), "sem esqueleto").toBeNull();
  });

  it("a aba a ficar escondida não recarrega", async () => {
    await abrirGaleria();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();
    expect(obterFalso).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  it("a recarga silenciosa que falha NÃO tira a foto nem mostra o erro de carregar (a foto continua válida)", async () => {
    await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erroSemResposta());

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();

    expect(screen.queryByText(TEXTOS.carregarTitulo)).toBeNull();
    expect(idDaImagem(imgAtual())).toBe(101);
  });

  it("a recarga com um 401 leva ao login", async () => {
    const sessao = await abrirGaleria();
    obterFalso.mockRejectedValueOnce(erro401());

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
  });

  it("uma aba que volta com a fila de outro aparelho já sem a foto atual: a seguinte passa a atual", async () => {
    await abrirGaleria();
    obterFalso.mockResolvedValueOnce({ fotos: filaDeTeste(3).slice(1) });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await assentar();

    expect(idDaImagem(imgAtual())).toBe(102);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(2));
  });
});

describe("sessão", () => {
  it("o ecrã usa a sessão do contexto: sem 401 nunca chama aoPerderSessao", async () => {
    const sessao = sessaoFalsa();
    await abrirGaleria(sessao);
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
    await tocar(botaoEnviarDaPagina());
    expect(sessao.aoPerderSessao).not.toHaveBeenCalled();
  });
});
