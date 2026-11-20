/**
 * F3-05, secção 16.4 — a Folha "Enviar uma foto" (docs/ecras/F3-05.md,
 * secção 6), com Vitest + Testing Library.
 *
 * Contrato que este ficheiro define e que `FolhaEnviarFoto.tsx` tem de
 * cumprir:
 *
 * ```tsx
 * export type PropriedadesDaFolhaEnviarFoto = { aberta: boolean; aoFechar: () => void };
 * export function FolhaEnviarFoto(propriedades): ReactElement
 * ```
 *
 * Três dependências que este ficheiro mocka, de propósito, para isolar o
 * que é desta Folha do que já tem o seu próprio teste:
 *
 *  - `reduzir()` de `src/lib/imagens/reduzir.ts` — a redução a sério é
 *    `reduzir.test.ts` (16.1); aqui o ficheiro "pronto" é injectado
 *    directamente, como 16.4 manda.
 *  - `enviarFoto()` de `src/lib/api/publico.ts` — **a segunda função que o
 *    ADR 0012 pediu**, a par de `obterGaleria`: `enviarFoto(corpo: FormData,
 *    opcoes?: OpcoesDePedido): Promise<RespostaEnvioFoto>`, por cima de
 *    `pedir("/fotos", { metodo: "POST", corpo, sinal })`.
 *  - A `Folha` partilhada não se mocka — é código já testado (F3-01) e é
 *    por ela que se encontra o `<dialog>`.
 *
 * **Prova:** a frase-promessa está visível **antes** de qualquer campo ser
 * preenchido; sem ficheiro escolhido, "Enviar foto" fica por clicar (não é
 * `aria-disabled` — é o único dos quatro estados sem pronto-para-enviar que
 * a 6.4 manda deixar o botão por conta própria) e clicar mostra "Escolhe
 * uma foto para enviar." em vez de disparar um pedido; com um ficheiro
 * escolhido mas ainda a preparar (7.2) ou que falhou a preparar (7.3), aí
 * sim o botão fica `aria-disabled`; cada um dos oito erros de 8 aparece associado
 * ao campo certo (ou à linha geral) e move o foco para lá; o `202` com
 * corpo `{"estado": "pendente"}` — com um isco preenchido e com um isco
 * vazio, nos dois casos — leva à mesma confirmação, com a mesma
 * frase-promessa ainda visível; o campo `website` nunca aparece no
 * `getByRole` nem no `getByLabelText` e o seu valor vai sempre no
 * `FormData`, preenchido ou vazio.
 *
 * **Deixa passar:** a redução de imagem a sério (o ficheiro "pronto" é
 * injectado) e o tempo real do prazo de 30 s (testado com relógio falso,
 * não com um `setTimeout` a sério).
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../lib/api/cliente";
import { enviarFoto } from "../../lib/api/publico";
import { reduzir } from "../../lib/imagens/reduzir";
import type { ResultadoDaReducao } from "../../lib/imagens/reduzir";
import { TEXTOS_DA_GALERIA } from "../../testes/galeria";
import { FolhaEnviarFoto } from "./FolhaEnviarFoto";

vi.mock("../../lib/api/publico", () => ({ enviarFoto: vi.fn() }));
vi.mock("../../lib/imagens/reduzir", () => ({ reduzir: vi.fn() }));

const enviar = vi.mocked(enviarFoto);
const reduzirFalso = vi.mocked(reduzir);

/** Um `File` falso — o conteúdo não importa, `reduzir()` está sempre fingido. */
function ficheiroFalso(nome = "foto.jpg"): File {
  return new File([Uint8Array.from([1, 2, 3])], nome, { type: "image/jpeg" });
}

/**
 * Apaga os `id`/`aria-labelledby` gerados por `useId()`, que mudam de
 * instância para instância do componente por razões que nada têm a ver
 * com o isco — sem isto, a comparação "mesma árvore" de baixo falhava
 * sempre, por um motivo que não é o que o teste quer provar.
 */
function semIdsGerados(html: string): string {
  return html.replace(/(?:id|aria-labelledby)="[^"]*"/g, "");
}

/** Escolhe `ficheiro` no campo "Foto". */
function escolherFicheiro(ficheiro: File): void {
  const campo = screen.getByLabelText(/^Foto/) as HTMLInputElement;
  fireEvent.change(campo, { target: { files: [ficheiro] } });
}

const RESULTADO_PRONTO: ResultadoDaReducao = {
  estado: "reduzida",
  ficheiro: new Blob(["reduzida"], { type: "image/webp" }),
};

/**
 * Monta a Folha aberta, escolhe um ficheiro e espera a redução "pronta".
 *
 * Devolve o `RenderResult`, para quem precisar de `rerender` (o caso de
 * fechar a Folha a meio do envio, mais abaixo: `aberta` é controlada pelo
 * pai, e é um `rerender` com `aberta={false}` que simula isso — nunca um
 * `cancel` disparado à mão sobre um `aberta={true}` fixo, que não muda
 * propriedade nenhuma).
 */
async function comFicheiroPronto(
  resultado: ResultadoDaReducao = RESULTADO_PRONTO,
  aoFechar: () => void = vi.fn(),
): Promise<ReturnType<typeof render>> {
  reduzirFalso.mockResolvedValue(resultado);
  const desenho = render(<FolhaEnviarFoto aberta aoFechar={aoFechar} />);
  escolherFicheiro(ficheiroFalso());
  await waitFor(() => {
    expect(reduzirFalso).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    await Promise.resolve();
  });
  // A prévia é um `data:` URL lido de forma assíncrona (FileReader).
  await waitFor(() => {
    expect(document.querySelector("img")).not.toBeNull();
  });
  return desenho;
}

function botaoDeEnviar(): HTMLElement {
  return screen.getByRole("button", { name: TEXTOS_DA_GALERIA.enviarFoto });
}

type PedidoEmCurso = {
  sinal: AbortSignal | undefined;
  resolver: (corpo: { estado: "pendente" }) => void;
  rejeitar: (erro: unknown) => void;
};

/** Um `enviarFoto` que fica pendurado até o teste mandar — como `clienteFalso()` em `Eventos.test.tsx`. */
function clienteDeEnvioFalso(): PedidoEmCurso[] {
  const pedidos: PedidoEmCurso[] = [];
  enviar.mockImplementation((_corpo: FormData, opcoes?: { sinal?: AbortSignal }) => {
    let resolver: (corpo: { estado: "pendente" }) => void = () => undefined;
    let rejeitar: (erro: unknown) => void = () => undefined;
    const promessa = new Promise<{ estado: "pendente" }>((cumprir, falhar) => {
      resolver = cumprir;
      rejeitar = falhar;
    });
    pedidos.push({ sinal: opcoes?.sinal, resolver, rejeitar });
    return promessa;
  });
  return pedidos;
}

/** O valor de um campo do último `FormData` enviado, ou `null` se não houver pedido. */
function campoEnviado(nome: string): FormDataEntryValue | null {
  const corpo = enviar.mock.calls.at(-1)?.[0];
  if (!(corpo instanceof FormData)) return null;
  return corpo.get(nome);
}

beforeEach(() => {
  enviar.mockReset();
  reduzirFalso.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a frase-promessa (6.2)", () => {
  it("está visível logo ao abrir, antes de qualquer campo preenchido", () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    expect(screen.getByText(TEXTOS_DA_GALERIA.promessa)).toBeInTheDocument();
  });

  it("continua visível depois da confirmação — a mesma frase, não outra", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());
    await act(async () => {
      pedidos[0]?.resolver({ estado: "pendente" });
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.sucessoTitulo)).toBeInTheDocument();
    expect(screen.getByText(TEXTOS_DA_GALERIA.promessa)).toBeInTheDocument();
  });
});

describe("sem ficheiro escolhido", () => {
  /**
   * Correção ui-ux, 6 de novembro de 2026 (docs/ecras/F3-05.md, 6.4/6.5,
   * 12.3) — e uma nota sobre como se chegou aqui.
   *
   * A versão anterior deste bloco tinha um comentário, datado do mesmo
   * dia e atribuído à revisão de código, que já tinha medido — num
   * Chromium a sério, não em jsdom — que nem um clique nem um `Enter`
   * chegavam a esta frase: "Enviar foto" ficava `aria-disabled` só por não
   * haver ficheiro, o `Botao` trava esse clique (e o `click` sintético que
   * o `Enter` dispara no botão de submissão por omissão cai na mesma
   * guarda), e por isso nunca se chamava `tentarEnviar()` por um caminho
   * real. A resposta certa a essa medição era parar e perguntar — a
   * medição não estava errada, a decisão de testar à volta dela é que não
   * devia ter sido tomada sozinha. O teste antigo trocou o `<form>` por um
   * `fireEvent.submit` sintético e ficou verde a provar que a validação
   * funciona **se for chamada**, quando a questão inteira era que nunca
   * era chamada — o defeito ficou lá, escondido por um teste que medeu o
   * caminho errado de propósito.
   *
   * A correcção a sério está em 6.4: só este estado (nenhum ficheiro
   * escolhido, sem explicação nenhuma já visível) deixa de desactivar o
   * botão. Os outros três (a preparar, falhado, a enviar/limite) continuam
   * — têm cada um a sua frase, e desactivá-los evita que `tentarEnviar()`
   * a substitua por esta genérica.
   */
  it("'Enviar foto' NÃO é aria-disabled — é o único dos quatro estados sem explicação visível", () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    expect(
      botaoDeEnviar(),
      "nenhum ficheiro foi escolhido ainda, e nada no ecrã diz o que falta — o botão tem " +
        "de ficar utilizável para que 'Escolhe uma foto para enviar.' seja alcançável",
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("um clique real mostra 'Escolhe uma foto para enviar.', move o foco, e não dispara pedido nenhum", () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    fireEvent.click(botaoDeEnviar());

    expect(screen.getByText(TEXTOS_DA_GALERIA.semEscolha)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Foto/));
    expect(enviar, "sem ficheiro, nenhum pedido pode ter partido").not.toHaveBeenCalled();
  });
});

describe("a pré-visualização (6.4): aparece de imediato, troca para o ficheiro reduzido", () => {
  it("existe assim que o ficheiro é lido, antes de reduzir() resolver, e é um data: URL (a CSP bloqueia blob:)", async () => {
    reduzirFalso.mockReturnValue(new Promise(() => undefined)); // nunca resolve
    const criarUrl = vi.spyOn(URL, "createObjectURL");
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    escolherFicheiro(ficheiroFalso());

    // `document.querySelector`, não `getByRole("img")`: o `alt=""` dá à
    // imagem o papel ARIA "presentation".
    await waitFor(() => {
      expect(document.querySelector("img")).not.toBeNull();
    });
    expect(document.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:/) as unknown as string,
    );
    expect(screen.getByText(TEXTOS_DA_GALERIA.aPreparar)).toBeInTheDocument();
    expect(criarUrl, "createObjectURL produz blob:, que a CSP bloqueia").not.toHaveBeenCalled();
    criarUrl.mockRestore();
  });

  it("troca a fonte para o ficheiro reduzido assim que reduzir() acaba — fontes distintas, ambas data:", async () => {
    const original = ficheiroFalso();
    const reduzido = new Blob(["reduzida"], { type: "image/jpeg" });

    let resolverReducao: (valor: ResultadoDaReducao) => void = () => undefined;
    reduzirFalso.mockImplementation(
      () =>
        new Promise((resolver) => {
          resolverReducao = resolver;
        }),
    );

    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);
    escolherFicheiro(original);
    await waitFor(() => {
      expect(document.querySelector("img")).not.toBeNull();
    });
    const srcOriginal = document.querySelector("img")?.getAttribute("src") ?? "";
    expect(srcOriginal).toMatch(/^data:/);

    await act(async () => {
      resolverReducao({ estado: "reduzida", ficheiro: reduzido });
      await Promise.resolve();
    });

    await waitFor(() => {
      const src = document.querySelector("img")?.getAttribute("src") ?? "";
      expect(src).toMatch(/^data:/);
      expect(src, "a fonte tem de passar a ser a do ficheiro REDUZIDO").not.toBe(srcOriginal);
    });
  });

  it("a leitura do original acabar depois da reduzida não muda a fonte mostrada: a troca espera pelas duas", async () => {
    // FileReader falso, de resolução manual: cada leitura fica pendente
    // até o teste a concluir, pela ordem que quiser.
    const pendentes: { blob: Blob; concluir: () => void }[] = [];
    class LeitorManual {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: Blob): void {
        pendentes.push({
          blob,
          concluir: () => {
            this.result = `data:x;nome=${blob instanceof File ? "original" : "reduzida"}`;
            this.onload?.();
          },
        });
      }
    }
    vi.stubGlobal("FileReader", LeitorManual);
    try {
      const reduzido = new Blob(["reduzida"], { type: "image/jpeg" });
      reduzirFalso.mockResolvedValue({ estado: "reduzida", ficheiro: reduzido });
      render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);
      escolherFicheiro(ficheiroFalso());

      await waitFor(() => {
        expect(pendentes).toHaveLength(2); // original + reduzida
      });
      const original = pendentes.find((p) => p.blob instanceof File);
      const reduzida = pendentes.find((p) => !(p.blob instanceof File));

      await act(async () => {
        reduzida?.concluir();
        await Promise.resolve();
      });
      await act(async () => {
        original?.concluir(); // chega TARDE, depois da reduzida
        await Promise.resolve();
      });

      expect(document.querySelector("img")).toHaveAttribute("src", "data:x;nome=reduzida");
      expect(
        document.querySelectorAll("img"),
        "só a prévia reduzida existe; a do original não pode voltar",
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uma escolha tardia não se sobrepõe à mais recente: a leitura da primeira acaba depois da segunda", async () => {
    const pendentes: { blob: Blob; concluir: () => void }[] = [];
    class LeitorManual {
      result: string | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(blob: Blob): void {
        pendentes.push({
          blob,
          concluir: () => {
            this.result = `data:x;nome=${(blob as File).name}`;
            this.onload?.();
          },
        });
      }
    }
    vi.stubGlobal("FileReader", LeitorManual);
    try {
      reduzirFalso.mockReturnValue(new Promise(() => undefined));
      render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

      escolherFicheiro(new File(["primeira"], "a.jpg", { type: "image/jpeg" }));
      escolherFicheiro(new File(["segunda"], "b.jpg", { type: "image/jpeg" }));
      expect(pendentes).toHaveLength(2);

      await act(async () => {
        pendentes[1]?.concluir();
        await Promise.resolve();
      });
      await act(async () => {
        pendentes[0]?.concluir(); // a mais antiga chega TARDE
        await Promise.resolve();
      });

      expect(document.querySelector("img")).toHaveAttribute("src", "data:x;nome=b.jpg");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("onError: mostra uma caixa neutra com o nome do ficheiro, nunca o ícone de imagem partida", async () => {
    await comFicheiroPronto();
    const previa = document.querySelector("img");
    expect(
      previa,
      "guarda: tem de haver uma pré-visualização antes de a fazer falhar",
    ).not.toBeNull();
    if (previa === null) return;

    fireEvent.error(previa);

    expect(
      document.querySelector("img"),
      "a imagem (partida) tem de desaparecer, não ficar visível com um ícone quebrado",
    ).toBeNull();
    expect(screen.getByText("foto.jpg")).toBeInTheDocument();
  });
});

describe("escolher um ficheiro: a preparação", () => {
  it("mostra 'A preparar a foto…' e o aviso de demora, e o botão fica aria-disabled", async () => {
    reduzirFalso.mockReturnValue(new Promise(() => undefined)); // nunca resolve: fica "a preparar"
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    escolherFicheiro(ficheiroFalso());

    expect(screen.getByText(TEXTOS_DA_GALERIA.aPreparar)).toBeInTheDocument();
    expect(
      screen.getByText(TEXTOS_DA_GALERIA.avisoDemora),
      "a segunda linha está lá desde o primeiro instante, não só depois de uma demora (7.2)",
    ).toBeInTheDocument();
    expect(botaoDeEnviar()).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => {
      expect(reduzirFalso).toHaveBeenCalledTimes(1);
    });
  });

  it("reduzir() é chamado com o ficheiro escolhido", async () => {
    const ficheiro = ficheiroFalso();
    reduzirFalso.mockResolvedValue(RESULTADO_PRONTO);
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    escolherFicheiro(ficheiro);

    await waitFor(() => {
      expect(reduzirFalso).toHaveBeenCalledTimes(1);
    });
    // O primeiro argumento é sempre o ficheiro; `reduzir()` aceita um
    // segundo argumento opcional (o prazo), e nenhum teste desta Folha
    // obriga a implementação a o passar.
    expect(reduzirFalso.mock.calls[0]?.[0]).toBe(ficheiro);
  });

  it("depois de pronta, o botão deixa de estar aria-disabled", async () => {
    await comFicheiroPronto();

    expect(botaoDeEnviar()).not.toHaveAttribute("aria-disabled", "true");
  });

  // "sem-contexto", não "sem-tela": o estado mudou de nome depois de este
  // ficheiro ter sido escrito (correção do Tomás, 6 de novembro de 2026,
  // ver src/lib/imagens/reduzir.test.ts) — "tela" é PT-PT legítimo para o
  // <canvas>, mas também é a palavra que o PT-BR usa para "ecrã", e
  // src/textos-pt-pt.test.ts não sabe distinguir os dois sentidos.
  it.each([["nao-descodificou"], ["nao-codificou"], ["sem-contexto"], ["demorou-demais"]] as const)(
    "reduzir() a dar %s mostra a frase de falha, e não deixa enviar",
    async (estado) => {
      reduzirFalso.mockResolvedValue({ estado });
      render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

      escolherFicheiro(ficheiroFalso());
      await waitFor(() => {
        expect(
          screen.getByText(TEXTOS_DA_GALERIA.falhaAPreparar),
          `reduzir() devolveu «${estado}», e a Folha tem de mostrar a frase de falha`,
        ).toBeInTheDocument();
      });

      expect(botaoDeEnviar()).toHaveAttribute("aria-disabled", "true");
      expect(
        screen.queryByText(TEXTOS_DA_GALERIA.aPreparar),
        "a preparação já acabou — não pode continuar a dizer que está a preparar",
      ).toBeNull();

      fireEvent.click(botaoDeEnviar());
      expect(
        enviar,
        "o ficheiro nunca saiu do telemóvel: uma foto que o browser não prepara é recusada " +
          "sem gastar tentativa nenhuma (decisão do Tomás, 6 de novembro de 2026, ADR 0018)",
      ).not.toHaveBeenCalled();
    },
  );

  it("mesmo que um submit chegue por baixo do botão, a frase de falha não é substituída pela genérica", async () => {
    // A regressão óbvia da correcção de 6.4: o botão continua `aria-
    // disabled` depois de a preparação falhar, por isso um clique real já
    // não chega a `tentarEnviar()` (é o que o `.each` de cima prova). O que
    // este teste prende é o `tentarEnviar()` em si — mesmo chamado por um
    // caminho que dispense o botão (o `Enter` que, num browser a sério,
    // dispara um `submit` nativo), ele não pode trocar "Não consegui
    // preparar esta foto…" pela frase genérica de "nenhum ficheiro": o
    // `ficheiroEscolhido` continua a não ser `null` nesse estado, e é isso
    // que o distingue de "nenhum ficheiro foi escolhido ainda".
    reduzirFalso.mockResolvedValue({ estado: "nao-descodificou" });
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);
    escolherFicheiro(ficheiroFalso());
    await waitFor(() => {
      expect(screen.getByText(TEXTOS_DA_GALERIA.falhaAPreparar)).toBeInTheDocument();
    });

    const formulario = document.querySelector("form");
    expect(formulario, "guarda: tem de haver um <form> a envolver os campos (6.3)").not.toBeNull();
    fireEvent.submit(formulario as HTMLFormElement);

    expect(
      screen.getByText(TEXTOS_DA_GALERIA.falhaAPreparar),
      "a frase específica da falha de preparação continua lá",
    ).toBeInTheDocument();
    expect(
      screen.queryByText(TEXTOS_DA_GALERIA.semEscolha),
      "a frase genérica de 'nenhum ficheiro' não pode substituir a mais específica",
    ).toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("depois de a preparação falhar, escolher um SEGUNDO ficheiro recupera — fica pronto, e o FormData leva o nome do segundo", async () => {
    // O caminho de recuperação que deixar de repor `ficheiroEscolhido` a
    // `null` no estado de falha tornou possível (correção ui-ux, 6 de
    // novembro de 2026) — e que podia ter partido em silêncio: nada
    // obrigava o segundo `escolher()` a substituir correctamente o
    // primeiro ficheiro (falhado) pelo novo.
    reduzirFalso.mockResolvedValueOnce({ estado: "nao-descodificou" });
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    escolherFicheiro(ficheiroFalso("primeiro.heic"));
    await waitFor(() => {
      expect(screen.getByText(TEXTOS_DA_GALERIA.falhaAPreparar)).toBeInTheDocument();
    });
    expect(botaoDeEnviar()).toHaveAttribute("aria-disabled", "true");

    reduzirFalso.mockResolvedValueOnce(RESULTADO_PRONTO);
    escolherFicheiro(ficheiroFalso("segundo.jpg"));

    await waitFor(() => {
      expect(
        screen.queryByText(TEXTOS_DA_GALERIA.falhaAPreparar),
        "a frase da falha anterior tem de sair assim que o segundo ficheiro fica pronto",
      ).toBeNull();
    });
    expect(
      botaoDeEnviar(),
      "com o segundo ficheiro pronto, o botão volta a ficar utilizável",
    ).not.toHaveAttribute("aria-disabled", "true");

    clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());
    await waitFor(() => {
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    const corpo = enviar.mock.calls[0]?.[0];
    expect(corpo).toBeInstanceOf(FormData);
    const ficheiroEnviado = (corpo as FormData).get("ficheiro");
    expect(
      ficheiroEnviado instanceof File ? ficheiroEnviado.name : null,
      "o nome no FormData tem de ser o do SEGUNDO ficheiro, não o do primeiro (falhado)",
    ).toBe("segundo.jpg");
  });
});

describe("os oito erros do backend (8): o campo certo, e o foco", () => {
  const ERROS_DE_CAMPO_FOTO = [
    ["imagem_invalida", 400, TEXTOS_DA_GALERIA.erroImagemInvalida],
    ["imagem_demasiado_grande", 400, TEXTOS_DA_GALERIA.erroImagemDemasiadoGrande],
    ["ficheiro_grande_demais", 413, TEXTOS_DA_GALERIA.erroFicheiroGrandeDemais],
  ] as const;

  it.each(ERROS_DE_CAMPO_FOTO)(
    "%s (campo Foto): a mensagem do backend aparece tal como veio, sem reescrita",
    async (codigo, estadoHttp, mensagem) => {
      await comFicheiroPronto();
      const pedidos = clienteDeEnvioFalso();
      fireEvent.click(botaoDeEnviar());

      await act(async () => {
        pedidos[0]?.rejeitar(new ErroDaApi(mensagem, { estado: estadoHttp, codigo }));
        await Promise.resolve();
      });

      expect(screen.getByText(mensagem)).toBeInTheDocument();
      expect(
        document.activeElement,
        "o foco move-se para o campo Foto quando o erro é dele (8)",
      ).toBe(screen.getByLabelText(/^Foto/));
    },
  );

  it("descricao_grande_demais (campo Legenda): associado e com foco", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroDescricaoGrandeDemais, {
          estado: 422,
          codigo: "descricao_grande_demais",
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroDescricaoGrandeDemais)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/^Legenda/));
  });

  it("enviada_por_grande_demais (campo O teu nome): associado e com foco", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroEnviadaPorGrandeDemais, {
          estado: 422,
          codigo: "enviada_por_grande_demais",
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroEnviadaPorGrandeDemais)).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText(/^O teu nome/));
  });

  it.each([
    ["dados_invalidos", 422, TEXTOS_DA_GALERIA.erroDadosInvalidos],
    ["tamanho_do_pedido_em_falta", 411, TEXTOS_DA_GALERIA.erroTamanhoEmFalta],
  ] as const)(
    "%s (linha geral): associado à linha geral, com foco no botão",
    async (codigo, estadoHttp, mensagem) => {
      await comFicheiroPronto();
      const pedidos = clienteDeEnvioFalso();
      fireEvent.click(botaoDeEnviar());

      await act(async () => {
        pedidos[0]?.rejeitar(new ErroDaApi(mensagem, { estado: estadoHttp, codigo }));
        await Promise.resolve();
      });

      expect(screen.getByText(mensagem)).toBeInTheDocument();
      expect(
        document.activeElement,
        "dados_invalidos e o 411 não são de campo nenhum — o foco vai para 'Enviar foto' (8)",
      ).toBe(botaoDeEnviar());
    },
  );

  it("limite_de_envios_excedido (429): a frase do backend, verbatim, na linha geral", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 125 },
          cabecalhos: { "retry-after": "125" },
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroLimiteDeEnvios)).toBeInTheDocument();
  });
});

describe("erros sem envelope (codigo === null): nunca o ErroDaApi.mensagem genérico", () => {
  it("sem resposta: a frase fixa de ligação, nunca `erro.mensagem`", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi("mensagem interna do cliente, não para o cliente ver", {
          estado: null,
          codigo: null,
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroSemRespostaAoEnviar)).toBeInTheDocument();
    expect(
      screen.queryByText("mensagem interna do cliente, não para o cliente ver"),
      "a F2-10 já decidiu: nenhum ecrã público mostra o ErroDaApi.mensagem genérico",
    ).toBeNull();
  });

  it("um código inesperado, fora da tabela: a frase fixa do lado do servidor", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi("mensagem interna do cliente", { estado: 502, codigo: null }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroServidorAoEnviar)).toBeInTheDocument();
  });
});

describe("o 429: o tempo composto, e o maior dos dois números (secção 9)", () => {
  it("só com segundos_em_falta (sem Retry-After legível): compõe a partir do corpo", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 125 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText("Podes tentar outra vez daqui a 3 minutos.")).toBeInTheDocument();
  });

  it("90 s, sem Retry-After: arredonda para cima, '2 minutos' (regra nova da F4-01)", async () => {
    // Antes da F4-01 a tabela 9.1 dizia "1 minuto" para 60–119 s, com o botão
    // ainda bloqueado até aos 119 s. Decisão do Tomás (F4-01): arredondar
    // sempre para cima acima de 60 s — a frase não pode prometer menos do que
    // falta. 60 s continua a ser "1 minuto" (ver `tempo-em-falta.test.ts`).
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 90 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText("Podes tentar outra vez daqui a 2 minutos.")).toBeInTheDocument();
  });

  it("com os dois presentes e a divergirem, usa o MAIOR dos dois", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 65 }, // ~2 minutos
          cabecalhos: { "retry-after": "600" }, // 10 minutos
        }),
      );
      await Promise.resolve();
    });

    expect(
      screen.getByText("Podes tentar outra vez daqui a 10 minutos."),
      "o Retry-After (600 s) é maior do que o segundos_em_falta (65 s) — usa-se o maior",
    ).toBeInTheDocument();
  });

  it("menos de 60 segundos, incluindo 0, lê-se 'menos de um minuto' — nunca 'tenta já' (regra 10)", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 0 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    expect(
      screen.getByText("Podes tentar outra vez daqui a menos de um minuto."),
    ).toBeInTheDocument();
    expect(
      botaoDeEnviar(),
      "«faltam 0 segundos» não pode ler-se como «tenta já»: o botão continua desactivado",
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("a suavização do dominio-bar aparece sempre que há um 429", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 30 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.erroLimiteSuavizacao)).toBeInTheDocument();
  });

  it("o botão fica aria-disabled pela duração exacta, e volta sozinho quando o prazo passa", async () => {
    // O relógio falso entra **depois** de `comFicheiroPronto()`: esse
    // apoio usa `waitFor`, que faz o seu próprio `setTimeout` de sondagem
    // — com o relógio já fingido antes dele, essa sondagem nunca avança
    // sozinha e o teste fica pendurado até ao `timeout` do Vitest.
    await comFicheiroPronto();
    vi.useFakeTimers();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 5 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    expect(botaoDeEnviar()).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_900);
    });
    expect(botaoDeEnviar(), "ainda não passaram os 5 s").toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(
      botaoDeEnviar(),
      "sem um número a descer no ecrã (9.2) — só o botão a voltar, sozinho, quando o prazo passa",
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("durante o arrefecimento, submeter o <form> directamente não chama enviarFoto outra vez", async () => {
    // O `Botao` com `aria-disabled` já trava o clique sozinho — o que este
    // teste prende é `tentarEnviar()` em si, pelo caminho que o Enter
    // dentro de "O teu nome" também percorre (correção do Tomás, 6 de
    // novembro de 2026, revisão de segurança: agora que "Enviar foto" é
    // `tipo="submit"`, o `<form>` submete-se a sério, e sem esta guarda um
    // 429 activo não impedia um segundo envio por essa via).
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.rejeitar(
        new ErroDaApi(TEXTOS_DA_GALERIA.erroLimiteDeEnvios, {
          estado: 429,
          codigo: "limite_de_envios_excedido",
          extra: { segundos_em_falta: 60 },
          cabecalhos: {},
        }),
      );
      await Promise.resolve();
    });

    enviar.mockClear();

    const formulario = document.querySelector("form");
    expect(formulario, "guarda: tem de haver um <form>").not.toBeNull();
    fireEvent.submit(formulario as HTMLFormElement);

    expect(
      enviar,
      "um 429 activo tem de bloquear qualquer envio, não só o clique no botão desactivado",
    ).not.toHaveBeenCalled();
  });
});

describe("o FormData leva a legenda e o nome tal como foram escritos", () => {
  it("descricao e enviada_por vão com os valores dos campos Legenda e O teu nome", async () => {
    await comFicheiroPronto();
    fireEvent.change(screen.getByLabelText(/^Legenda/), {
      target: { value: "Uma noite cheia no bar." },
    });
    fireEvent.change(screen.getByLabelText(/^O teu nome/), {
      target: { value: "Cliente de teste" },
    });

    clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await waitFor(() => {
      expect(enviar).toHaveBeenCalledTimes(1);
    });
    expect(campoEnviado("descricao")).toBe("Uma noite cheia no bar.");
    expect(campoEnviado("enviada_por")).toBe("Cliente de teste");
  });

  it("vazios quando ninguém os preencheu — os dois campos são opcionais (6.3)", async () => {
    await comFicheiroPronto();
    clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await waitFor(() => {
      expect(enviar).toHaveBeenCalledTimes(1);
    });
    expect(campoEnviado("descricao")).toBe("");
    expect(campoEnviado("enviada_por")).toBe("");
  });
});

describe("o isco (campo website, secção 11)", () => {
  it("nunca aparece no getByRole nem no getByLabelText", async () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    expect(screen.queryByRole("textbox", { name: /website/i })).toBeNull();
    expect(screen.queryByLabelText(/website/i)).toBeNull();
  });

  it("o FormData leva sempre website, vazio quando ninguém o preencheu", async () => {
    await comFicheiroPronto();
    clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await waitFor(() => {
      expect(enviar).toHaveBeenCalledTimes(1);
    });
    expect(campoEnviado("website")).toBe("");
  });

  it("preenchido à mão (como um robô faria) e enviado: a MESMA árvore do DOM na confirmação", async () => {
    // O corpo de sucesso do backend não leva `id` de propósito, para a
    // indistinguibilidade sair de graça (secção 6.7) — por isso o teste
    // certo não é "o texto X aparece", é "a árvore inteira é igual".
    await comFicheiroPronto();
    const semIsco = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());
    await act(async () => {
      semIsco[0]?.resolver({ estado: "pendente" });
      await Promise.resolve();
    });
    const arvoreSemIsco = semIdsGerados(document.body.innerHTML);

    // Recomeça, desta vez com o isco preenchido por fora da árvore de
    // acessibilidade (como um robô que preenche todos os <input> que
    // encontra, sem ler ARIA).
    document.body.innerHTML = "";
    reduzirFalso.mockClear();
    await comFicheiroPronto();
    const campoIsco = document.querySelector('input[name="website"]') as HTMLInputElement | null;
    expect(campoIsco, "guarda: o campo isco tem de existir no DOM, só escondido").not.toBeNull();
    if (campoIsco !== null) fireEvent.change(campoIsco, { target: { value: "http://spam.test" } });

    const comIsco = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());
    await act(async () => {
      comIsco[0]?.resolver({ estado: "pendente" });
      await Promise.resolve();
    });
    const arvoreComIsco = semIdsGerados(document.body.innerHTML);

    expect(campoEnviado("website")).toBe("http://spam.test");
    expect(
      arvoreComIsco,
      "um isco preenchido tem de dar a MESMA árvore que um envio normal — é essa a " +
        "indistinguibilidade que o backend garante (202 byte a byte igual) e que o " +
        "ecrã não pode desfazer",
    ).toBe(arvoreSemIsco);
  });

  it("escrito directamente no DOM, sem disparar evento nenhum, continua a ir no FormData", async () => {
    // O modelo de ameaça da secção 11 é "um robô simples, que preenche
    // todos os campos de texto que encontra sem executar CSS nem ler
    // ARIA" — e a forma mais comum de o fazer é `elemento.value = "…"`
    // directo no DOM, sem passar pelo `input`/`change` que o React ouve.
    // Um campo **controlado** (`value` + `onChange` do React) nunca vê essa
    // escrita: o estado ficava sempre `""`, o `FormData` ia sempre vazio, e
    // o isco nunca apanhava o robô para que foi desenhado (correção do
    // Tomás, 6 de novembro de 2026, revisão de segurança). Por isso o
    // campo é lido do nó do DOM no momento do envio, não de um estado.
    await comFicheiroPronto();
    const campoIsco = document.querySelector('input[name="website"]') as HTMLInputElement | null;
    expect(campoIsco, "guarda: o campo isco tem de existir no DOM").not.toBeNull();
    if (campoIsco === null) return;

    // Só a propriedade do DOM — nenhum `fireEvent`, nenhum evento `input`
    // ou `change` a disparar, exactamente como um robô que não executa CSS
    // nem lê ARIA o faria.
    campoIsco.value = "http://spam.test";

    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await waitFor(() => {
      expect(enviar).toHaveBeenCalledTimes(1);
    });
    expect(
      campoEnviado("website"),
      "o valor escrito directamente no DOM tem de chegar ao FormData — um campo " +
        "controlado perdia-o, e o isco deixava de apanhar o robô que o visa",
    ).toBe("http://spam.test");
    expect(pedidos).toHaveLength(1);
  });
});

describe("o campo website está escondido dos dois lados (secção 11)", () => {
  it("tabIndex -1, aria-hidden, e fora da ordem de tabulação", () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    const campoIsco = document.querySelector('input[name="website"]');
    expect(campoIsco, "o campo isco tem de existir no DOM").not.toBeNull();
    expect(campoIsco).toHaveAttribute("tabindex", "-1");
    expect(campoIsco).toHaveAttribute("aria-hidden", "true");
  });

  it('className="hidden" (display:none) e autoComplete="off"', () => {
    // As três guardas não dependem umas das outras (secção 11): se o
    // `className="hidden"` um dia for removido por engano (uma
    // refactorização do CSS), o `aria-hidden`/`tabIndex` do teste de cima
    // continuam a impedi-lo de ser alcançado — mas só este teste prende
    // que o `display:none` continua lá. Sem ele, tirar a classe deixava a
    // bateria inteira verde e o campo passava a ser uma caixa de texto à
    // vista de quem enxerga.
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    const campoIsco = document.querySelector('input[name="website"]');
    expect(campoIsco, "o campo isco tem de existir no DOM").not.toBeNull();
    expect(campoIsco).toHaveClass("hidden");
    expect(
      campoIsco,
      "sem autoComplete=off, um gestor de password preenchia o isco com o endereço do " +
        "próprio site, por um motivo que nada tem a ver com ser ou não um robô",
    ).toHaveAttribute("autocomplete", "off");
  });
});

describe("o <form> nunca se submete nativamente (1, 6.3)", () => {
  it("não tem action nem method", () => {
    render(<FolhaEnviarFoto aberta aoFechar={vi.fn()} />);

    // Guarda da regra 10: um `<form>` que não existisse fazia os dois
    // `expect` de baixo não correr nenhum, e o teste passava sem ter visto
    // nada — exactamente como já se faz três blocos acima.
    const formulario = document.querySelector("form");
    expect(formulario, "guarda: tem de haver um <form> a envolver os campos (6.3)").not.toBeNull();

    expect(formulario).not.toHaveAttribute("action");
    expect(formulario).not.toHaveAttribute("method");
  });

  it("um submit nativo não dispara um pedido HTTP: preventDefault chamado", async () => {
    await comFicheiroPronto();
    clienteDeEnvioFalso();

    const formulario = document.querySelector("form");
    expect(formulario, "guarda: tem de haver um <form> a envolver os campos (6.3)").not.toBeNull();
    if (formulario === null) return;

    const evento = new Event("submit", { bubbles: true, cancelable: true });
    formulario.dispatchEvent(evento);

    expect(evento.defaultPrevented, "um submit nativo tem de ser sempre prevenido").toBe(true);
  });
});

describe("depois de enviar com sucesso (6.7)", () => {
  it("troca os três campos e o botão por 'Foto enviada.' e 'Enviar outra foto'", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await act(async () => {
      pedidos[0]?.resolver({ estado: "pendente" });
      await Promise.resolve();
    });

    expect(screen.getByText(TEXTOS_DA_GALERIA.sucessoTitulo)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TEXTOS_DA_GALERIA.sucessoBotao }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Foto/)).toBeNull();
  });

  it("'Enviar outra foto' repõe os campos vazios", async () => {
    await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());
    await act(async () => {
      pedidos[0]?.resolver({ estado: "pendente" });
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: TEXTOS_DA_GALERIA.sucessoBotao }));

    expect(screen.getByLabelText(/^Foto/)).toBeInTheDocument();
    // Correção ui-ux, 6 de novembro de 2026: "nenhum ficheiro escolhido
    // ainda" é o único dos quatro estados que já não desactiva o botão
    // (6.4/6.5) — "Enviar outra foto" repõe exactamente esse estado.
    expect(
      botaoDeEnviar(),
      "repõe para 'nenhum ficheiro escolhido ainda', que é o estado que já não fica aria-disabled",
    ).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("fechar a Folha a meio do envio cancela o pedido (6.6)", () => {
  it("aberta a passar a false, a meio do envio, aborta o pedido em curso", async () => {
    // `aberta` é controlada pelo pai (a `Galeria`): é o pai que decide
    // fechar, em resposta ao `aoFechar` que o Esc do `<dialog>` dispara. Um
    // `cancel` disparado à mão sobre um `aberta={true}` fixo não muda
    // propriedade nenhuma — é por isso que este teste simula o que o pai
    // faz (um `rerender` com `aberta={false}`), a mesma técnica de
    // `Folha.test.tsx` ("ao fechar chama close() no <dialog>").
    const { rerender } = await comFicheiroPronto();
    const pedidos = clienteDeEnvioFalso();
    fireEvent.click(botaoDeEnviar());

    await waitFor(() => {
      expect(pedidos[0]?.sinal).toBeDefined();
    });
    expect(pedidos[0]?.sinal?.aborted).toBe(false);

    rerender(<FolhaEnviarFoto aberta={false} aoFechar={vi.fn()} />);

    expect(pedidos[0]?.sinal?.aborted, "o fecho tem de abortar o pedido em curso").toBe(true);
  });
});

describe("a enviar (6.5, 6.6)", () => {
  it("'Enviar foto' fica aria-disabled enquanto o pedido está em curso", async () => {
    // A 6.5 manda `aria-disabled` nos quatro estados em que não se pode
    // enviar, e "a enviar" é um deles — o `aTrabalhar` do `Botao` já trava
    // o clique sozinho (por isso nenhum teste tinha apanhado a falta
    // disto), mas o `aria-disabled` em si também tem de lá estar, e só o
    // `aEnviar` no `botaoDesativado` o garante. Sem ele, este teste falha.
    await comFicheiroPronto();
    clienteDeEnvioFalso();
    // Captura o nó antes do clique: uma vez "a enviar", o texto do botão
    // passa a "A enviar…" (`aTrabalhar`), e uma segunda chamada a
    // `botaoDeEnviar()` — que procura pelo nome acessível "Enviar foto" —
    // deixa de o encontrar.
    const botao = botaoDeEnviar();
    fireEvent.click(botao);

    await waitFor(() => {
      expect(botao).toHaveAttribute("aria-busy", "true");
    });
    expect(botao).toHaveAttribute("aria-disabled", "true");
  });
});
