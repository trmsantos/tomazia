/**
 * F4-04, decisão D1 (a), decisão D6, plano 5.7 e spec 7 — o dono envia uma foto do bar pelo
 * `POST /fotos` **público** (o mesmo `enviarFoto` do ecrã público; com a sessão válida salta o
 * limite). A foto entra **pendente, no fim da fila** e aprova-se como as outras: o `202` não traz
 * `id`, por isso o ecrã não sabe qual é e **não tenta adivinhar**.
 *
 * A folha «Enviar foto» reaproveita a F3-05 (a mesma `reduzir()`, os mesmos erros) **sem** o campo
 * «O teu nome» e **sem** o campo-isco `website`: o `FormData` leva só `ficheiro` e, se escrita,
 * `descricao`. A **pré-visualização é um `data:` URL do ficheiro já reduzido, nunca `blob:`** (a CSP
 * de produção é `img-src 'self' data:`; o jsdom não a aplica, por isso aqui prova-se a forma — o
 * efeito a sério está em `e2e/gestao-fotos-csp.spec.ts`).
 *
 * **Regra 10:** sem resposta o ecrã **não reenvia** (um segundo envio criava duas fotos): fecha a
 * folha, recarrega a fila e diz «Não sei se a foto foi enviada…». Uma redução que falha é recusa
 * no telemóvel, **sem pedido**.
 *
 * **Deixa passar:** o foco a voltar ao botão da página, o seletor de ficheiros do sistema e o
 * `<dialog>` a sério (e2e).
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDaApi } from "../../../lib/api/cliente";
import {
  erro401,
  erroDoServidor,
  erroSemResposta,
  fotoPendenteDeTeste,
  filaDeTeste,
} from "../../../testes/gestao";
import {
  TEXTOS,
  abrirFolhaDeEnviar,
  abrirGaleria,
  assentar,
  avancar,
  aviso,
  aprovarFalso,
  botaoCancelarDaFolha,
  botaoEnviarDaFolha,
  campoDaFoto,
  campoDaLegenda,
  comSinal,
  corpoEnviado,
  enviarFalso,
  escolherFoto,
  escolherFotoSemEsperar,
  escreverLegenda,
  ficarPendenteAteAbortar,
  ficheiroFalso,
  folha,
  h2,
  haFolha,
  idDaImagem,
  imgAtual,
  inerte,
  linhaDeEstado,
  obterFalso,
  pendente,
  previa,
  prepararApi,
  reduzirFalso,
  REDUZIDA,
  tocar,
} from "../../../testes/fotos-gestao";

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

const criarFalso = vi.fn<(blob: Blob) => string>(() => "blob:http://localhost/fingido");

beforeEach(() => {
  prepararApi();
  criarFalso.mockClear();
  URL.createObjectURL = criarFalso;
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

/** Tudo pronto para enviar: folha aberta, foto escolhida e reduzida. */
async function comFotoPronta(): Promise<void> {
  await abrirGaleria();
  await abrirFolhaDeEnviar();
  await escolherFoto();
}
async function enviar(): Promise<void> {
  await tocar(botaoEnviarDaFolha());
}

describe("a folha «Enviar foto» (spec 7.2)", () => {
  it("abre sem pedido nenhum; o título é «Enviar foto» e a promessa está lá ANTES de haver foto", async () => {
    await abrirGaleria();

    const f = await abrirFolhaDeEnviar();

    expect(f).toHaveTextContent(TEXTOS.promessaEnviar);
    expect(enviarFalso).not.toHaveBeenCalled();
    expect(reduzirFalso).not.toHaveBeenCalled();
    expect(obterFalso).toHaveBeenCalledTimes(1);
  });

  it('os campos: «Foto» (ficheiro, `accept="image/*"`) e «Legenda (opcional)» com a ajuda «Aparece no site, junto da foto.»', async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEnviar();

    expect(campoDaFoto()).toHaveAttribute("type", "file");
    expect(campoDaFoto()).toHaveAttribute("accept", "image/*");
    expect(campoDaLegenda()).toBeInTheDocument();
    expect(campoDaLegenda()).toHaveAccessibleDescription(TEXTOS.ajudaLegenda);
    expect(f).toHaveTextContent(TEXTOS.ajudaLegenda);
  });

  it("SEM «O teu nome» e SEM campo-isco: a foto é do bar e `enviada_por` fica nulo", async () => {
    await abrirGaleria();
    const f = await abrirFolhaDeEnviar();

    expect(within(f).queryByLabelText(/nome/i)).toBeNull();
    expect(f.querySelector('[name="website"]')).toBeNull();
    expect(f.querySelector('[name="enviada_por"]')).toBeNull();
    expect(
      f.querySelectorAll('input:not([type="file"]):not([type="hidden"])').length,
    ).toBeLessThanOrEqual(1);
    expect(f.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
  });

  it("dois botões: «Enviar foto» (o dourado) e «Cancelar»; o botão da página fica por baixo da folha, não duplicado nela", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    expect(botaoEnviarDaFolha().className).toMatch(/bg-acao/);
    expect(botaoCancelarDaFolha().className).not.toMatch(/bg-acao/);
  });

  it("sem foto escolhida, tocar em «Enviar foto» diz «Escolhe uma foto para enviar.», leva o foco ao campo e não envia nada", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();

    await tocar(botaoEnviarDaFolha());

    expect(screen.getByText(TEXTOS.semEscolha)).toBeInTheDocument();
    expect(document.activeElement).toBe(campoDaFoto());
    expect(enviarFalso).not.toHaveBeenCalled();
  });
});

describe("escolher a foto: reduzir e pré-visualizar", () => {
  it("a redução recebe o ficheiro escolhido; enquanto corre: «A preparar a foto…» (role=status) e «Enviar foto» inerte COM explicação à vista", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    const reducao = pendente<typeof REDUZIDA>();
    reduzirFalso.mockReturnValueOnce(reducao.promessa);
    const escolhido = ficheiroFalso("jantar.jpg");

    await escolherFotoSemEsperar(escolhido);

    expect(reduzirFalso).toHaveBeenCalledTimes(1);
    expect(reduzirFalso.mock.calls[0]?.[0]).toBe(escolhido);
    expect(linhaDeEstado(TEXTOS.aPreparar)?.getAttribute("role")).toBe("status");
    expect(inerte(botaoEnviarDaFolha())).toBe(true);
    expect(enviarFalso).not.toHaveBeenCalled();
  });

  it("passado um segundo: «Pode demorar um pouco em fotos grandes.»; não antes", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    reduzirFalso.mockReturnValueOnce(pendente<typeof REDUZIDA>().promessa);
    await escolherFotoSemEsperar();

    await avancar(999);
    expect(screen.queryByText(TEXTOS.demoraUmPouco)).toBeNull();
    await avancar(1);
    expect(screen.getByText(TEXTOS.demoraUmPouco)).toBeInTheDocument();
  });

  it("reduzida: a preparação acaba, a pré-visualização aparece e o botão fica ativo", async () => {
    await comFotoPronta();

    expect(screen.queryByText(TEXTOS.aPreparar)).toBeNull();
    expect(previa()).not.toBeNull();
    expect(inerte(botaoEnviarDaFolha())).toBe(false);
  });

  it("A PRÉVIA É UM `data:` URL DO FICHEIRO JÁ REDUZIDO — nunca `blob:`, e `URL.createObjectURL` nem é chamado (CSP `img-src 'self' data:`)", async () => {
    await comFotoPronta();

    const src = previa()?.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/")).toBe(true);
    expect(src, "o ficheiro reduzido, não o original").toBe(
      `data:image/jpeg;base64,${btoa("reduzida")}`,
    );
    expect(src.startsWith("blob:")).toBe(false);
    expect(
      criarFalso,
      "createObjectURL dá um blob: que a CSP de produção bloqueia",
    ).not.toHaveBeenCalled();
    for (const img of Array.from(folha(TEXTOS.tituloEnviar).querySelectorAll("img"))) {
      expect(img.getAttribute("src") ?? "").not.toMatch(/^blob:/);
    }
  });

  it("«sem-mudanca» (já era um JPEG pequeno) também se pré-visualiza, pelo mesmo `data:`", async () => {
    reduzirFalso.mockResolvedValue({
      estado: "sem-mudanca",
      ficheiro: new Blob(["original"], { type: "image/png" }),
    });
    await abrirGaleria();
    await abrirFolhaDeEnviar();

    await escolherFoto();

    expect(previa()?.getAttribute("src")).toBe(`data:image/png;base64,${btoa("original")}`);
  });

  it.each(["nao-descodificou", "nao-codificou", "sem-contexto", "demorou-demais"] as const)(
    "redução falhada (%s): «Não consegui preparar esta foto…» junto do campo, nenhuma prévia e ZERO pedidos",
    async (estado) => {
      reduzirFalso.mockResolvedValue({ estado });
      await abrirGaleria();
      await abrirFolhaDeEnviar();

      await escolherFoto();
      await tocar(botaoEnviarDaFolha());

      expect(screen.getByText(TEXTOS.falhaAPreparar)).toBeInTheDocument();
      expect(previa()).toBeNull();
      expect(enviarFalso).not.toHaveBeenCalled();
      expect(screen.queryByText(TEXTOS.aPreparar)).toBeNull();
    },
  );

  it("depois de uma falha, escolher outra no mesmo campo recupera (a mensagem sai e a prévia vem)", async () => {
    reduzirFalso.mockResolvedValueOnce({ estado: "nao-descodificou" });
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    await escolherFoto();
    expect(screen.getByText(TEXTOS.falhaAPreparar)).toBeInTheDocument();
    reduzirFalso.mockResolvedValueOnce({ ...REDUZIDA });

    await escolherFoto(ficheiroFalso("outra.jpg"));

    expect(screen.queryByText(TEXTOS.falhaAPreparar)).toBeNull();
    expect(previa()).not.toBeNull();
    expect(inerte(botaoEnviarDaFolha())).toBe(false);
  });
});

describe("enviar", () => {
  it("o FormData leva `ficheiro` e `descricao` — SEM `website` e SEM `enviada_por`; um só pedido, com o sinal", async () => {
    await comFotoPronta();
    escreverLegenda("Noite de samba");

    await enviar();

    expect(enviarFalso).toHaveBeenCalledTimes(1);
    expect(enviarFalso).toHaveBeenCalledWith(expect.any(FormData), comSinal);
    const corpo = corpoEnviado();
    expect(corpo.get("descricao")).toBe("Noite de samba");
    expect(corpo.get("ficheiro")).toBeInstanceOf(Blob);
    expect(corpo.has("website"), "o isco não se manda").toBe(false);
    expect(corpo.has("enviada_por"), "a foto é do bar").toBe(false);
    expect([...corpo.keys()].sort()).toEqual(["descricao", "ficheiro"]);
  });

  it("o `ficheiro` enviado é o REDUZIDO, não o original", async () => {
    await comFotoPronta();
    await enviar();
    const f = corpoEnviado().get("ficheiro") as Blob;
    expect(await f.text()).toBe("reduzida");
  });

  it("sem legenda a `descricao` não se manda (só se escrita)", async () => {
    await comFotoPronta();
    await enviar();
    expect([...corpoEnviado().keys()]).toEqual(["ficheiro"]);
  });

  it("uma legenda só de espaços também não se manda", async () => {
    await comFotoPronta();
    escreverLegenda("   ");
    await enviar();
    expect(corpoEnviado().has("descricao")).toBe(false);
  });

  it("a enviar: «A enviar…» (aria-busy, aria-disabled), os campos inertes SEM `disabled` (o foco não cai), a folha não fecha", async () => {
    await comFotoPronta();
    enviarFalso.mockReturnValueOnce(pendente<{ estado: "pendente" }>().promessa);

    await enviar();

    const ocupado = within(folha(TEXTOS.tituloEnviar)).getByRole("button", {
      name: TEXTOS.aEnviar,
    });
    expect(ocupado).toHaveAttribute("aria-busy", "true");
    expect(ocupado).toHaveAttribute("aria-disabled", "true");
    expect(campoDaFoto()).toHaveAttribute("aria-disabled", "true");
    expect(campoDaLegenda()).toHaveAttribute("aria-disabled", "true");
    expect(campoDaFoto()).not.toBeDisabled();
    expect(campoDaLegenda()).not.toBeDisabled();
    expect(botaoCancelarDaFolha()).toHaveAttribute("aria-disabled", "true");
  });

  it("a meio do envio, Cancelar, `Esc` e a cortina NÃO fecham a folha (fechar cancelava o pedido e deixava o ecrã sem saber)", async () => {
    await comFotoPronta();
    enviarFalso.mockReturnValueOnce(pendente<{ estado: "pendente" }>().promessa);
    await enviar();

    await tocar(botaoCancelarDaFolha());
    fireEvent(folha(TEXTOS.tituloEnviar), new Event("cancel", { cancelable: true }));
    await assentar();
    await tocar(folha(TEXTOS.tituloEnviar));

    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
    expect(enviarFalso).toHaveBeenCalledTimes(1);
  });

  it("uma segunda pressão (ou duas no mesmo instante) não envia um segundo pedido", async () => {
    await comFotoPronta();
    enviarFalso.mockReturnValueOnce(pendente<{ estado: "pendente" }>().promessa);

    await tocar(botaoEnviarDaFolha());
    await tocar(within(folha(TEXTOS.tituloEnviar)).getByRole("button", { name: TEXTOS.aEnviar }));

    expect(enviarFalso).toHaveBeenCalledTimes(1);
  });

  it("o prazo é de 30 s (um envio por dados móveis), não os 10 s das leituras", async () => {
    await comFotoPronta();
    enviarFalso.mockImplementation(ficarPendenteAteAbortar);
    await enviar();
    const sinal = (enviarFalso.mock.calls[0]?.[1] as { sinal: AbortSignal }).sinal;

    await avancar(10_000);
    expect(sinal.aborted, "aos 10 s ainda não").toBe(false);
    await avancar(19_999);
    expect(sinal.aborted, "aos 29 999 ms ainda não").toBe(false);
    await avancar(1);
    expect(sinal.aborted, "aos 30 s sim").toBe(true);
  });
});

describe("202: a foto entra na fila (o «Feito quando» do envio próprio)", () => {
  it("a folha fecha; aviso «Foto enviada. Está na fila para aprovares.» (sucesso, 5 s por omissão); UM GET; a foto aparece no fim da fila", async () => {
    await comFotoPronta();
    obterFalso.mockResolvedValueOnce({
      fotos: [...filaDeTeste(3), fotoPendenteDeTeste({ id: 120, enviada_por: null })],
    });

    await enviar();

    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);
    expect(aviso()?.textContent).toMatch(/^\s*Feito\./);
    expect(aviso()).toHaveTextContent(TEXTOS.fotoEnviada);
    expect(obterFalso).toHaveBeenCalledTimes(2);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(4));
    expect(idDaImagem(imgAtual()), "a foto que o dono tem à frente não muda").toBe(101);
    expect(
      aprovarFalso,
      "uma foto nunca se aprova sem o dono a ver na fila",
    ).not.toHaveBeenCalled();
  });

  it("o aviso do envio dura 5 s (não os 3 dos avisos de moderar)", async () => {
    await comFotoPronta();
    await enviar();
    await avancar(4_999);
    expect(aviso()).not.toBeNull();
    await avancar(1);
    expect(aviso()).toBeNull();
  });

  it("com a fila vazia (o normal): a foto enviada é logo a que está à frente, com o foco no <h2> «Fotos à espera (1)»", async () => {
    prepararApi([]);
    await abrirGaleria();
    expect(screen.getByText(TEXTOS.vazioTitulo)).toBeInTheDocument();
    await abrirFolhaDeEnviar();
    await escolherFoto();
    obterFalso.mockResolvedValueOnce({ fotos: [fotoPendenteDeTeste({ id: 120 })] });

    await enviar();

    expect(screen.queryByText(TEXTOS.vazioTitulo)).toBeNull();
    expect(idDaImagem(imgAtual())).toBe(120);
    expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(1));
    expect(document.activeElement).toBe(h2());
  });

  it("depois de enviar, reabrir a folha mostra-a limpa (sem a foto nem a legenda de antes)", async () => {
    await comFotoPronta();
    escreverLegenda("Noite de samba");
    await enviar();

    await abrirFolhaDeEnviar();

    expect(campoDaLegenda()).toHaveValue("");
    expect(previa()).toBeNull();
  });

  it("o aviso de enviar não promete aprovação: a foto só aparece no site depois de aprovada", async () => {
    await comFotoPronta();
    await enviar();
    expect(aviso()?.textContent ?? "").not.toMatch(/já aparece no site/i);
  });
});

describe("erros do backend (spec 7.5): a `mensagem` tal como vem, junto do campo certo", () => {
  function erroDoBackend(estado: number, codigo: string, mensagem: string): ErroDaApi {
    return new ErroDaApi(mensagem, { estado, codigo });
  }

  it.each([
    [400, "imagem_invalida", "A imagem não é um JPEG, PNG ou WebP válido (teste)."],
    [400, "imagem_demasiado_grande", "A imagem tem píxeis a mais (teste)."],
    [413, "ficheiro_grande_demais", "O ficheiro é demasiado grande (teste)."],
  ])("%i %s → sob o campo «Foto»", async (estado, codigo, mensagem) => {
    await comFotoPronta();
    enviarFalso.mockRejectedValueOnce(erroDoBackend(estado, codigo, mensagem));

    await enviar();

    const texto = within(folha(TEXTOS.tituloEnviar)).getByText(mensagem);
    const ids = (campoDaFoto().getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id))).toContain(texto);
    expect(haFolha(TEXTOS.tituloEnviar), "a folha fica aberta").toBe(true);
    expect(enviarFalso).toHaveBeenCalledTimes(1);
    expect(aviso()).toBeNull();
    expect(inerte(botaoEnviarDaFolha()), "o botão volta").toBe(false);
  });

  it("422 descricao_grande_demais → sob o campo «Legenda»", async () => {
    await comFotoPronta();
    const mensagem = "A legenda tem caracteres a mais (teste).";
    enviarFalso.mockRejectedValueOnce(erroDoBackend(422, "descricao_grande_demais", mensagem));

    await enviar();

    const texto = within(folha(TEXTOS.tituloEnviar)).getByText(mensagem);
    const ids = (campoDaLegenda().getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids.map((id) => document.getElementById(id))).toContain(texto);
  });

  it.each([
    [422, "dados_invalidos", "Os dados não são válidos (teste)."],
    [411, "tamanho_do_pedido_em_falta", "Falta o tamanho do pedido (teste)."],
    [429, "limite_de_envios_excedido", "Já enviaste demasiadas fotos (teste)."],
  ])("%i %s → na linha de estado, por cima do botão", async (estado, codigo, mensagem) => {
    await comFotoPronta();
    enviarFalso.mockRejectedValueOnce(erroDoBackend(estado, codigo, mensagem));

    await enviar();

    const linha = linhaDeEstado(mensagem);
    expect(linha).not.toBeNull();
    expect(folha(TEXTOS.tituloEnviar)).toContainElement(linha);
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
    expect(aviso()).toBeNull();
  });

  it.each([
    [
      "um código que não conhecemos",
      () => erroDoBackend(400, "codigo_que_nao_existe", "MENSAGEM-QUE-NAO-SE-MOSTRA"),
    ],
    ["um 500", () => erroDoServidor(500)],
    ["um 403", () => erroDoServidor(403)],
  ])(
    "%s → «Não consegui enviar a foto. O problema é nosso…» e nunca a mensagem do backend",
    async (_n, erro) => {
      await comFotoPronta();
      enviarFalso.mockRejectedValueOnce(erro());

      await enviar();

      expect(screen.getByText(TEXTOS.envioServidor)).toBeInTheDocument();
      expect(document.body.textContent).not.toContain("MENSAGEM-QUE-NAO-SE-MOSTRA");
      expect(haFolha(TEXTOS.tituloEnviar)).toBe(true);
      expect(enviarFalso).toHaveBeenCalledTimes(1);
    },
  );

  it("depois de um erro, o dono pode tentar outra vez com a mesma foto", async () => {
    await comFotoPronta();
    enviarFalso.mockRejectedValueOnce(erroDoServidor(500));
    await enviar();

    await enviar();

    expect(enviarFalso).toHaveBeenCalledTimes(2);
    expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);
    expect(aviso()).toHaveTextContent(TEXTOS.fotoEnviada);
  });

  it("401: aoPerderSessao uma vez; nada se repete", async () => {
    const sessao = await abrirGaleria();
    await abrirFolhaDeEnviar();
    await escolherFoto();
    enviarFalso.mockRejectedValueOnce(erro401());

    await enviar();

    expect(sessao.aoPerderSessao).toHaveBeenCalledTimes(1);
    expect(enviarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("sem resposta ao enviar (regra 10): o ecrã não sabe, não reenvia, recarrega a fila", () => {
  it.each([
    ["a rede caiu", () => enviarFalso.mockRejectedValueOnce(erroSemResposta()), 0],
    ["passaram os 30 s", () => enviarFalso.mockImplementation(ficarPendenteAteAbortar), 30_000],
  ])(
    "%s: um só POST; a folha fecha; aviso de ERRO «Não sei se a foto foi enviada…»; a fila recarrega",
    async (_n, preparar, espera) => {
      await comFotoPronta();
      preparar();
      obterFalso.mockResolvedValueOnce({
        fotos: [...filaDeTeste(3), fotoPendenteDeTeste({ id: 120 })],
      });

      await enviar();
      await avancar(espera);

      expect(enviarFalso, "um segundo envio criava duas fotos").toHaveBeenCalledTimes(1);
      expect(haFolha(TEXTOS.tituloEnviar)).toBe(false);
      expect(aviso()?.textContent).toMatch(/^\s*Erro\./);
      expect(aviso()).toHaveTextContent(TEXTOS.envioSemSaber);
      expect(obterFalso).toHaveBeenCalledTimes(2);
      expect(h2()).toHaveTextContent(TEXTOS.fotosAEsperaN(4));
      expect(screen.queryByText(TEXTOS.fotoEnviada)).toBeNull();
      expect(
        screen.queryByText(TEXTOS.envioServidor),
        "nunca «Não consegui enviar»: pode ter chegado",
      ).toBeNull();
    },
  );

  it("não conclui «enviada» ao ver uma foto nova: pode ser a de um cliente (o POST não diz quem a enviou)", async () => {
    await comFotoPronta();
    enviarFalso.mockRejectedValueOnce(erroSemResposta());
    obterFalso.mockResolvedValueOnce({
      fotos: [...filaDeTeste(3), fotoPendenteDeTeste({ id: 120 })],
    });

    await enviar();

    expect(aviso()?.textContent ?? "").not.toContain(TEXTOS.fotoEnviada);
    expect(aviso()?.textContent).toMatch(/^\s*Erro\./);
  });

  it("depois de assentar e de passar muito tempo, continua a haver um só POST", async () => {
    await comFotoPronta();
    enviarFalso.mockRejectedValueOnce(erroSemResposta());
    await enviar();
    await assentar();
    await avancar(120_000);
    expect(enviarFalso).toHaveBeenCalledTimes(1);
  });
});

describe("o campo da foto não reenvia por engano", () => {
  it("escolher outra foto não faz nenhum pedido", async () => {
    await comFotoPronta();
    await escolherFoto(ficheiroFalso("outra.jpg"));
    expect(enviarFalso).not.toHaveBeenCalled();
    expect(campoDaFoto()).toBeInTheDocument();
  });

  it("o seletor de ficheiros do sistema não abre sozinho: nenhum `autofocus` no campo da foto", async () => {
    await abrirGaleria();
    await abrirFolhaDeEnviar();
    expect(campoDaFoto()).not.toHaveAttribute("autofocus");
    expect(document.activeElement).not.toBe(campoDaFoto());
  });
});
