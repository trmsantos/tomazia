import type { ChangeEvent, FormEvent, ReactElement, Ref } from "react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Botao } from "../../components/ui/Botao";
import { Folha } from "../../components/ui/Folha";
import { ErroDaApi } from "../../lib/api/cliente";
import { enviarFoto } from "../../lib/api/publico";
import { tempoComposto } from "../../lib/formato/tempo-em-falta";
import { reduzir } from "../../lib/imagens/reduzir";

/**
 * A Folha "Enviar uma foto" (`docs/ecras/F3-05.md`, secção 6).
 *
 * **Controlada pelo pai** (a `Galeria`), como a `FolhaWifi` é controlada
 * pelo `App`. Fechar a Folha em qualquer estado repõe tudo na próxima
 * abertura (12.3): por isso o conteúdo só existe `{aberta && …}`, e é o
 * desmontar — não um `useEffect` de limpeza à parte — que cancela um envio
 * em curso (6.6).
 *
 * **O foco nunca se move dentro do `.then()`/`.catch()` de uma promessa.**
 * Nesse instante o React ainda não removeu o `disabled` dos campos, e um
 * elemento desativado não aceita foco. O pedido de foco fica num estado
 * (`pedirFoco`), e é um `useEffect` a seguir à mudança desse estado —
 * depois do React ter mesmo removido o `disabled` — que o move de verdade.
 */

const TEXTOS = {
  titulo: "Enviar uma foto",
  promessa: "A tua foto aparece depois de aprovada.",
  campoFoto: "Foto (obrigatório)",
  semEscolha: "Escolhe uma foto para enviar.",
  aPreparar: "A preparar a foto…",
  avisoDemora: "Pode demorar um pouco em fotos grandes.",
  falhaAPreparar: "Não consegui preparar esta foto. Tenta outra, ou tira uma fotografia nova.",
  trocarFoto: "Trocar foto",
  campoLegenda: "Legenda (opcional)",
  campoNome: "O teu nome (opcional)",
  notaDoNome: "Fica só para o dono — não aparece no site.",
  enviarFoto: "Enviar foto",
  aEnviar: "A enviar…",

  erroImagemInvalida:
    "Não consegui usar esta fotografia. Tenta enviá-la outra vez ou escolhe outra foto.",
  erroImagemDemasiadoGrande: "Esta foto é demasiado grande para o site. Tenta outra foto.",
  erroFicheiroGrandeDemais: "O ficheiro é demasiado grande. O limite é de 8 MB. Tenta outra foto.",
  erroDescricaoGrandeDemais:
    "Essa legenda é demasiado longa (até 255 carateres). Tenta encurtá-la.",
  erroEnviadaPorGrandeDemais: "Esse nome é demasiado longo (até 60 carateres). Tenta encurtá-lo.",
  erroDadosInvalidos: "Os dados enviados não são válidos. Verifica os campos e tenta novamente.",
  erroTamanhoEmFalta: "Não consegui perceber o tamanho deste envio. Tenta enviar a foto outra vez.",
  erroSemRespostaAoEnviar: "Não consegui enviar a foto. Verifica a ligação e tenta outra vez.",
  erroServidorAoEnviar:
    "Não consegui enviar a foto. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  erroLimiteSuavizacao:
    "Numa noite cheia, este limite é partilhado por todos os que estão no WiFi do bar — " +
    "pode não ter sido só esta foto a gastá-lo.",

  sucessoTitulo: "Foto enviada.",
  sucessoBotao: "Enviar outra foto",
} as const;

/** Onde cada código de erro do backend mora (secção 8). */
const DESTINO_POR_CODIGO: Record<string, "foto" | "legenda" | "nome" | "geral"> = {
  imagem_invalida: "foto",
  imagem_demasiado_grande: "foto",
  ficheiro_grande_demais: "foto",
  descricao_grande_demais: "legenda",
  enviada_por_grande_demais: "nome",
  dados_invalidos: "geral",
  tamanho_do_pedido_em_falta: "geral",
  limite_de_envios_excedido: "geral",
};

type LinhaGeral =
  | { tipo: "simples"; texto: string }
  | { tipo: "limite"; mensagem: string; tempo: string; ateQuando: number };

type AlvoDeFoco = "foto" | "legenda" | "nome" | "geral" | "sucesso";

/**
 * Um campo de texto com a mesma receita visual do `Campo` partilhado
 * (F3-01), mas com acesso directo ao nó do DOM — oito erros do backend
 * movem o foco para o campo certo (secção 8), e isso só é possível com uma
 * referência. O `Campo` de `src/components/ui` não a expõe, e não é desta
 * tarefa acrescentar-lha: é peça própria desta Folha, como o seletor de
 * ficheiro (ver "Não toques", na tarefa).
 */
const CampoComFoco = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  {
    id: string;
    etiqueta: string;
    ajuda?: string;
    erro?: string;
    multilinha?: boolean;
    maxLength: number;
    valor: string;
    aoMudar: (valor: string) => void;
    desativado: boolean;
  }
>(function CampoComFoco(
  { id, etiqueta, ajuda, erro, multilinha = false, maxLength, valor, aoMudar, desativado },
  ref,
) {
  const idAjuda = `${id}-ajuda`;
  const idErro = `${id}-erro`;
  const descritores = [ajuda !== undefined ? idAjuda : null, erro !== undefined ? idErro : null]
    .filter((valorDoId): valorDoId is string => valorDoId !== null)
    .join(" ");

  const classes =
    "min-h-toque w-full px-3 py-2 rounded-pequeno border bg-transparent text-texto text-corpo " +
    "placeholder:text-texto-suave " +
    (erro !== undefined ? "border-erro" : "border-contorno") +
    (desativado ? " opacity-desativado cursor-not-allowed" : "");

  const comuns = {
    id,
    className: classes,
    disabled: desativado,
    maxLength,
    value: valor,
    "aria-invalid": erro !== undefined ? ("true" as const) : undefined,
    "aria-describedby": descritores.length > 0 ? descritores : undefined,
    onChange: (evento: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      aoMudar(evento.target.value);
    },
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={id} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>

      {ajuda !== undefined && (
        <p id={idAjuda} className="text-nota text-texto-suave">
          {ajuda}
        </p>
      )}

      {multilinha ? (
        <textarea ref={ref as Ref<HTMLTextAreaElement>} rows={3} {...comuns} />
      ) : (
        <input ref={ref as Ref<HTMLInputElement>} type="text" {...comuns} />
      )}

      {erro !== undefined && (
        <p id={idErro} className="text-nota text-erro">
          {erro}
        </p>
      )}
    </div>
  );
});

export type PropriedadesDaFolhaEnviarFoto = { aberta: boolean; aoFechar: () => void };

/** Lê um ficheiro como `data:` URL; `null` se a leitura falhar. */
function lerComoDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolver) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      resolver(typeof leitor.result === "string" ? leitor.result : null);
    };
    leitor.onerror = () => {
      resolver(null);
    };
    leitor.readAsDataURL(blob);
  });
}

export function FolhaEnviarFoto({ aberta, aoFechar }: PropriedadesDaFolhaEnviarFoto): ReactElement {
  return (
    <Folha aberta={aberta} titulo={TEXTOS.titulo} aoFechar={aoFechar}>
      {/* Só existe com a Folha aberta — é o que faz "fechar repõe tudo" (12.3)
          sair de um `useEffect` de desmontagem em vez de um reset escrito à
          mão campo a campo. */}
      {aberta && <ConteudoDaFolha />}
    </Folha>
  );
}

function ConteudoDaFolha(): ReactElement {
  const [ficheiroEscolhido, setFicheiroEscolhido] = useState<File | null>(null);
  const [previaUrl, setPreviaUrl] = useState<string | null>(null);
  // A pré-visualização do ficheiro já reduzido (6.4) — só existe depois de
  // `reduzir()` acabar, e é sempre um dos três formatos que o browser sabe
  // pintar (reduzir.ts só produz JPEG). Enquanto não existe, mostra-se
  // `previaUrl` (o ficheiro tal como foi escolhido, que pode ser um HEIC
  // que só o Safari decodifica em `<img>`).
  const [previaReduzidaUrl, setPreviaReduzidaUrl] = useState<string | null>(null);
  // A pré-visualização (de qualquer uma das duas fontes) falhou a pintar —
  // mostra-se a caixa neutra com o nome do ficheiro em vez do ícone de
  // imagem partida (6.4).
  const [previaFalhou, setPreviaFalhou] = useState(false);
  const [aPreparar, setAPreparar] = useState(false);
  const [resultadoPronto, setResultadoPronto] = useState<Blob | null>(null);
  const [erroDeFicheiro, setErroDeFicheiro] = useState<string | null>(null);

  const [legenda, setLegenda] = useState("");
  const [erroDeLegenda, setErroDeLegenda] = useState<string | null>(null);

  const [nome, setNome] = useState("");
  const [erroDeNome, setErroDeNome] = useState<string | null>(null);

  const [linhaGeral, setLinhaGeral] = useState<LinhaGeral | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  const [pedidoDeFoco, setPedidoDeFoco] = useState<{ alvo: AlvoDeFoco; vez: number } | null>(null);

  const inputFotoRef = useRef<HTMLInputElement>(null);
  const refLegenda = useRef<HTMLTextAreaElement>(null);
  const refNome = useRef<HTMLInputElement>(null);
  const containerBotaoRef = useRef<HTMLDivElement>(null);
  const refTituloSucesso = useRef<HTMLParagraphElement>(null);
  /**
   * O campo-isco **não é controlado** (correção do Tomás, 6 de novembro de
   * 2026, revisão de segurança). Um robô simples — o modelo de ameaça da
   * secção 11 — preenche campos com `elemento.value = "…"` direto no DOM,
   * sem disparar `input`/`change`; isso nunca chega a um `onChange` do
   * React, por isso um campo controlado lia sempre `""` e o isco nunca
   * apanhava ninguém. Ler `.value` do nó a sério, no momento do envio,
   * apanha os dois casos: a pessoa que nunca lá toca e o robô que lhe
   * escreve o valor por fora do React.
   */
  const refIsco = useRef<HTMLInputElement>(null);

  const operacaoRef = useRef(0);
  const controladorRef = useRef<AbortController | null>(null);

  // Fechar a Folha a meio do envio cancela o pedido (6.6): o desmontar
  // deste componente (que só existe com `aberta`) é o próprio sinal.
  useEffect(() => {
    return () => {
      controladorRef.current?.abort();
      // Invalida leituras de prévia ainda a decorrer (nada a revogar: as
      // prévias são `data:` URLs, que a CSP permite, e o GC trata delas).
      operacaoRef.current += 1;
    };
  }, []);

  // O foco só se move depois de o React ter removido o `disabled` a sério
  // (ver o cabeçalho do ficheiro) — nunca dentro do `.then()`/`.catch()`.
  useEffect(() => {
    if (pedidoDeFoco === null) return;
    if (pedidoDeFoco.alvo === "foto") inputFotoRef.current?.focus();
    if (pedidoDeFoco.alvo === "legenda") refLegenda.current?.focus();
    if (pedidoDeFoco.alvo === "nome") refNome.current?.focus();
    if (pedidoDeFoco.alvo === "geral") containerBotaoRef.current?.querySelector("button")?.focus();
    if (pedidoDeFoco.alvo === "sucesso") refTituloSucesso.current?.focus();
  }, [pedidoDeFoco]);

  // O botão volta a ficar utilizável sozinho quando o prazo do 429 passa —
  // um único temporizador, nunca um intervalo a recontar (9.2).
  useEffect(() => {
    if (linhaGeral?.tipo !== "limite") return;
    const faltam = linhaGeral.ateQuando - Date.now();
    const temporizador = window.setTimeout(
      () => {
        setLinhaGeral(null);
      },
      Math.max(faltam, 0),
    );
    return () => {
      window.clearTimeout(temporizador);
    };
  }, [linhaGeral]);

  function pedirFoco(alvo: AlvoDeFoco): void {
    setPedidoDeFoco((anterior) => ({ alvo, vez: (anterior?.vez ?? 0) + 1 }));
  }

  function limparErrosDeEnvio(): void {
    setErroDeFicheiro(null);
    setErroDeLegenda(null);
    setErroDeNome(null);
    setLinhaGeral(null);
  }

  function escolher(ficheiro: File): void {
    const minhaOperacao = ++operacaoRef.current;
    limparErrosDeEnvio();
    setFicheiroEscolhido(ficheiro);
    setResultadoPronto(null);
    setPreviaReduzidaUrl(null);
    setPreviaFalhou(false);
    setAPreparar(true);
    // A pré-visualização aparece de imediato, sem esperar pela redução
    // (6.4) — é por isso que fica aqui, antes do `reduzir()` começar, e não
    // dentro do `.then()`.
    // `data:` e não `blob:`: a CSP de produção (`img-src 'self' data:`,
    // ADR 0008) bloqueia `blob:`. A leitura é assíncrona; a guarda da
    // operação descarta-a se entretanto houve outra escolha, uma troca ou
    // o fecho da Folha.
    setPreviaUrl(null);
    const leituraOriginal = lerComoDataUrl(ficheiro);
    void leituraOriginal.then((url) => {
      if (operacaoRef.current !== minhaOperacao) return;
      setPreviaUrl(url);
    });

    reduzir(ficheiro)
      .then((resultado) => {
        // Um segundo ficheiro escolhido antes deste terminar invalida-o:
        // nunca se deixa um resultado tardio sobrepor-se à escolha mais
        // recente.
        if (operacaoRef.current !== minhaOperacao) return;

        setAPreparar(false);

        if (resultado.estado === "reduzida" || resultado.estado === "sem-mudanca") {
          setResultadoPronto(resultado.ficheiro);
          // A fonte troca para o ficheiro já reduzido (sempre JPEG, sempre
          // pintável) assim que ele chega — um HEIC original que o Safari
          // decodifica mas o Chrome não deixava de se ver certo a meio da
          // troca; o reduzido nunca tem esse problema (ver o cabeçalho de
          // `reduzir.ts`).
          // Sem mudança, o ficheiro é o próprio original: reaproveita-se a
          // leitura em vez de a repetir.
          const leituraReduzida =
            resultado.ficheiro === ficheiro ? leituraOriginal : lerComoDataUrl(resultado.ficheiro);
          // Esperar também pelo original garante que a callback dele já
          // correu: o `setPreviaUrl(null)` daqui é sempre o último a
          // escrever, por isso o `data:` do original nunca volta ao estado.
          void Promise.all([leituraReduzida, leituraOriginal]).then(
            ([urlReduzida, urlOriginal]) => {
              if (operacaoRef.current !== minhaOperacao) return;
              if (urlReduzida === null) {
                // Fica a prévia do original; se também essa falhou, a caixa
                // neutra com o nome do ficheiro (6.4).
                if (urlOriginal === null) setPreviaFalhou(true);
                return;
              }
              // Liberta a prévia do original (pode ser de vários MB).
              setPreviaUrl(null);
              setPreviaReduzidaUrl(urlReduzida);
              setPreviaFalhou(false);
            },
          );
          return;
        }

        // Uma foto que o browser não consegue preparar é recusada aqui
        // mesmo, pelos bytes que `reduzir()` já examinou — sem gastar uma
        // das cinco tentativas do balde (decisão do Tomás, 6 de novembro
        // de 2026; ADR 0018).
        //
        // `ficheiroEscolhido` **fica como está**, de propósito (correção
        // ui-ux, 6 de novembro de 2026, docs/ecras/F3-05.md, 6.4/6.5): é
        // ele que distingue este estado ("um ficheiro foi escolhido mas a
        // preparação falhou", que já tem a sua própria frase visível) do
        // de "nenhum ficheiro foi escolhido ainda" (o único em que o botão
        // deixa de ficar `aria-disabled`). O seletor nativo, esse, mostra
        // mesmo "nenhum ficheiro" — repõe-se via `inputFotoRef`, não via
        // este estado.
        setResultadoPronto(null);
        setPreviaUrl(null);
        setPreviaReduzidaUrl(null);
        if (inputFotoRef.current !== null) inputFotoRef.current.value = "";
        setErroDeFicheiro(TEXTOS.falhaAPreparar);
        pedirFoco("foto");
      })
      .catch(() => {
        // `reduzir()` nunca lança (ver o seu próprio cabeçalho) — este
        // ramo é só a rede de segurança para não deixar uma promessa
        // rejeitada sem ninguém a apanhar.
        if (operacaoRef.current !== minhaOperacao) return;
        setAPreparar(false);
        setResultadoPronto(null);
        // `ficheiroEscolhido` fica como está — ver o comentário acima.
        setPreviaUrl(null);
        setPreviaReduzidaUrl(null);
        setErroDeFicheiro(TEXTOS.falhaAPreparar);
        pedirFoco("foto");
      });
  }

  function aoEscolherFicheiro(evento: ChangeEvent<HTMLInputElement>): void {
    const ficheiro = evento.target.files?.[0];
    if (ficheiro === undefined) return;
    escolher(ficheiro);
  }

  function trocarFoto(): void {
    operacaoRef.current += 1;
    setFicheiroEscolhido(null);
    setResultadoPronto(null);
    setAPreparar(false);
    setPreviaUrl(null);
    setPreviaReduzidaUrl(null);
    setPreviaFalhou(false);
    setErroDeFicheiro(null);
    if (inputFotoRef.current !== null) {
      inputFotoRef.current.value = "";
      inputFotoRef.current.click();
    }
  }

  function tratarLimiteDeEnvios(erro: ErroDaApi): void {
    const doCorpo =
      typeof erro.extra["segundos_em_falta"] === "number" ? erro.extra["segundos_em_falta"] : 0;
    const doCabecalho = Number(erro.cabecalhos["retry-after"] ?? "0");
    const segundos = Math.max(doCorpo, Number.isFinite(doCabecalho) ? doCabecalho : 0);

    setLinhaGeral({
      tipo: "limite",
      mensagem: erro.message,
      tempo: tempoComposto(segundos),
      // Pelo menos 1 s: com `segundos_em_falta: 0` o temporizador de 0 ms
      // voltava a activar o botão logo a seguir a dizer "menos de um
      // minuto" — e no runner do CI, mais lento, ganhava a corrida ao teste
      // que o proíbe ("nunca 'tenta já'", regra 10). O backend arredonda
      // para cima, por isso um 0 só chega na fronteira exacta do prazo.
      ateQuando: Date.now() + Math.max(segundos, 1) * 1000,
    });
  }

  function tratarErroDoBackend(erro: ErroDaApi): void {
    if (erro.codigo === null) {
      setLinhaGeral({
        tipo: "simples",
        texto: erro.estado === null ? TEXTOS.erroSemRespostaAoEnviar : TEXTOS.erroServidorAoEnviar,
      });
      pedirFoco("geral");
      return;
    }

    if (erro.codigo === "limite_de_envios_excedido") {
      tratarLimiteDeEnvios(erro);
      pedirFoco("geral");
      return;
    }

    const destino = DESTINO_POR_CODIGO[erro.codigo];
    if (destino === "foto") {
      setErroDeFicheiro(erro.message);
      pedirFoco("foto");
      return;
    }
    if (destino === "legenda") {
      setErroDeLegenda(erro.message);
      pedirFoco("legenda");
      return;
    }
    if (destino === "nome") {
      setErroDeNome(erro.message);
      pedirFoco("nome");
      return;
    }
    // "geral" e qualquer código que a tabela de 8 não conheça: a mesma
    // linha, nunca inventada — dados_invalidos e o 411 vivem aqui.
    setLinhaGeral({ tipo: "simples", texto: erro.message });
    pedirFoco("geral");
  }

  async function enviarAgora(ficheiro: Blob): Promise<void> {
    limparErrosDeEnvio();
    setAEnviar(true);

    const controlo = new AbortController();
    controladorRef.current = controlo;

    const corpo = new FormData();
    corpo.append("ficheiro", ficheiro, ficheiroEscolhido?.name ?? "foto.jpg");
    corpo.append("descricao", legenda);
    corpo.append("enviada_por", nome);
    // O isco: vai sempre, preenchido ou vazio — é o que torna os dois casos
    // indistinguíveis para quem o preencheu (secção 11). Lido do nó do DOM,
    // não de um estado do React — ver o comentário de `refIsco`.
    // O `??` dá o mesmo resultado a "não consegui ler o nó" (o `ref` ainda
    // não ligou) e a "o campo está vazio": hoje o primeiro caso é
    // inalcançável (o campo já existe quando se chega aqui) e, se alguma
    // vez deixar de o ser, o lado permissivo é o seguro — nunca falhar um
    // envio legítimo por um detalhe do isco.
    corpo.append("website", refIsco.current?.value ?? "");

    try {
      await enviarFoto(corpo, { sinal: controlo.signal });
      setAEnviar(false);
      setSucesso(true);
      pedirFoco("sucesso");
    } catch (erro) {
      if (erro instanceof ErroDaApi) {
        setAEnviar(false);
        tratarErroDoBackend(erro);
        return;
      }
      // Cancelamento: a Folha fechou a meio (6.6). Este componente está a
      // desmontar-se; não há ecrã nenhum para mostrar nada a.
    }
  }

  function tentarEnviar(): void {
    if (aEnviar) return;
    // Durante o arrefecimento do 429, nenhum caminho pode chegar a
    // `enviarAgora` — nem o clique (o `Botao` já trava), nem o `Enter`
    // dentro de "O teu nome" a submeter o `<form>` a sério (correção do
    // Tomás, 6 de novembro de 2026, revisão de segurança).
    if (linhaGeral?.tipo === "limite") return;
    if (resultadoPronto === null) {
      // Correção ui-ux, 6 de novembro de 2026 (docs/ecras/F3-05.md, 6.4):
      // só "nenhum ficheiro escolhido ainda" mostra esta frase — é o único
      // dos quatro estados sem pronto-para-enviar que não tinha já uma
      // explicação visível. Com um ficheiro escolhido (a preparar, 7.2, ou
      // falhado, 7.3), o botão continua `aria-disabled` e por isso este
      // ramo só é alcançável por um envio sintético (um teste a dispensar
      // o botão) — e mesmo aí, não se substitui a frase mais específica
      // que já está no ecrã pela genérica de "nenhum ficheiro".
      if (ficheiroEscolhido === null) {
        limparErrosDeEnvio();
        setErroDeFicheiro(TEXTOS.semEscolha);
        pedirFoco("foto");
      }
      return;
    }
    void enviarAgora(resultadoPronto);
  }

  function aoSubmeter(evento: FormEvent<HTMLFormElement>): void {
    // Nunca um `action`/`method`: o `<form>` existe só para o `Enter`
    // dentro de "O teu nome" funcionar como seria de esperar (6.3, 1).
    evento.preventDefault();
    tentarEnviar();
  }

  function reiniciar(): void {
    setSucesso(false);
    setFicheiroEscolhido(null);
    setResultadoPronto(null);
    setAPreparar(false);
    setPreviaUrl(null);
    setPreviaReduzidaUrl(null);
    setPreviaFalhou(false);
    setErroDeFicheiro(null);
    setLegenda("");
    setErroDeLegenda(null);
    setNome("");
    setErroDeNome(null);
    if (refIsco.current !== null) refIsco.current.value = "";
    setLinhaGeral(null);
    pedirFoco("foto");
  }

  const prontoParaEnviar = resultadoPronto !== null;
  const limiteActivo = linhaGeral?.tipo === "limite";
  /**
   * Correção ui-ux, 6 de novembro de 2026 (docs/ecras/F3-05.md, 6.4/6.5,
   * 12.3): dos quatro estados em que não se pode enviar, só "nenhum
   * ficheiro escolhido ainda" (`ficheiroEscolhido === null`) deixa de
   * desativar o botão — é o único sem nenhuma explicação já visível no
   * ecrã. Os outros três continuam: um ficheiro escolhido ainda sem
   * `resultadoPronto` (a preparar, 7.2, **ou** falhado, 7.3 — os dois já
   * têm a sua frase própria por baixo do campo), a enviar, e o limite
   * activo.
   */
  const botaoDesativado =
    (ficheiroEscolhido !== null && !prontoParaEnviar) || aEnviar || limiteActivo;

  return (
    <>
      {/* A frase-promessa: visível antes de qualquer campo, e continua
          visível depois da confirmação — a mesma frase, nunca trocada por
          outra (6.2). */}
      <p className="text-corpo text-texto">{TEXTOS.promessa}</p>

      {sucesso ? (
        <>
          <p
            ref={refTituloSucesso}
            tabIndex={-1}
            className="text-seccao font-forte text-texto focus:outline-none"
          >
            {TEXTOS.sucessoTitulo}
          </p>
          <Botao variante="principal" larguraTotal onClick={reiniciar}>
            {TEXTOS.sucessoBotao}
          </Botao>
        </>
      ) : (
        <form onSubmit={aoSubmeter} noValidate className="flex flex-col gap-4">
          <div className="flex w-full flex-col gap-1">
            <label htmlFor="foto-da-galeria" className="text-nota font-forte text-texto">
              {TEXTOS.campoFoto}
            </label>
            <input
              ref={inputFotoRef}
              id="foto-da-galeria"
              type="file"
              accept="image/*"
              required
              disabled={aEnviar}
              onChange={aoEscolherFicheiro}
              aria-describedby={erroDeFicheiro !== null ? "foto-da-galeria-erro" : undefined}
              className="w-full text-corpo text-texto"
            />

            {/*
             * A pré-visualização aparece de imediato (6.4) — assim que
             * `previaUrl` existe, sem esperar pela redução — e troca para o
             * ficheiro já reduzido (`previaReduzidaUrl`) assim que ele
             * chega: esse é sempre um dos três formatos que o browser sabe
             * pintar, ao contrário do original, que pode ser um HEIC que só
             * o Safari decodifica em `<img>`. Falhando a pintar qualquer uma
             * das duas (`onError`), mostra-se uma caixa neutra com o nome do
             * ficheiro em vez do ícone de imagem partida.
             */}
            {(previaUrl !== null || previaReduzidaUrl !== null || aPreparar || previaFalhou) && (
              <div className="flex flex-col gap-2">
                {previaFalhou ? (
                  <div className="rounded-pequeno border border-fio-interno p-3 text-nota text-texto-suave">
                    {ficheiroEscolhido?.name ?? TEXTOS.campoFoto}
                  </div>
                ) : (
                  // alt="" de propósito: decorativa, o ficheiro já está
                  // nomeado pela etiqueta do campo "Foto".
                  (previaReduzidaUrl ?? previaUrl) !== null && (
                    <img
                      src={previaReduzidaUrl ?? previaUrl ?? undefined}
                      alt=""
                      draggable={false}
                      onError={() => {
                        setPreviaFalhou(true);
                      }}
                      className="w-full rounded-pequeno border border-fio-interno object-contain"
                    />
                  )
                )}

                {aPreparar && (
                  <div>
                    <p className="text-nota text-texto-suave">{TEXTOS.aPreparar}</p>
                    <p className="text-nota text-texto-suave">{TEXTOS.avisoDemora}</p>
                  </div>
                )}

                {!aPreparar && resultadoPronto !== null && (
                  <Botao variante="secundario" desativado={aEnviar} onClick={trocarFoto}>
                    {TEXTOS.trocarFoto}
                  </Botao>
                )}
              </div>
            )}

            {erroDeFicheiro !== null && (
              <p id="foto-da-galeria-erro" className="text-nota text-erro">
                {erroDeFicheiro}
              </p>
            )}
          </div>

          <CampoComFoco
            ref={refLegenda}
            id="legenda-da-galeria"
            etiqueta={TEXTOS.campoLegenda}
            multilinha
            maxLength={255}
            valor={legenda}
            aoMudar={setLegenda}
            erro={erroDeLegenda ?? undefined}
            desativado={aEnviar}
          />

          <CampoComFoco
            ref={refNome}
            id="nome-de-quem-envia"
            etiqueta={TEXTOS.campoNome}
            ajuda={TEXTOS.notaDoNome}
            maxLength={60}
            valor={nome}
            aoMudar={setNome}
            erro={erroDeNome ?? undefined}
            desativado={aEnviar}
          />

          {/* O campo-isco (secção 11): escondido dos dois lados ao mesmo
              tempo — `className="hidden"` tira-o da vista E da árvore de
              acessibilidade e da ordem de tabulação; `aria-hidden` e
              `tabIndex={-1}` são redundância de propósito, para o caso de o
              `hidden` um dia ser removido por engano.

              `defaultValue`, não `value` — não é controlado (ver o
              comentário de `refIsco`): um robô que escreva directamente no
              DOM, sem passar pelo `onChange` do React, tem de continuar a
              cair no isco. */}
          <input
            ref={refIsco}
            type="text"
            name="website"
            defaultValue=""
            tabIndex={-1}
            aria-hidden="true"
            autoComplete="off"
            className="hidden"
          />

          <div ref={containerBotaoRef}>
            <Botao
              tipo="submit"
              variante="principal"
              larguraTotal
              desativado={botaoDesativado}
              aTrabalhar={aEnviar}
              textoATrabalhar={TEXTOS.aEnviar}
            >
              {TEXTOS.enviarFoto}
            </Botao>
          </div>

          {linhaGeral !== null && (
            <div role="status" className="flex flex-col gap-1">
              <p className="text-nota text-erro">
                {linhaGeral.tipo === "simples" ? linhaGeral.texto : linhaGeral.mensagem}
              </p>
              {linhaGeral.tipo === "limite" && (
                <>
                  <p className="text-nota text-texto-suave">{linhaGeral.tempo}</p>
                  <p className="text-nota text-texto-suave">{TEXTOS.erroLimiteSuavizacao}</p>
                </>
              )}
            </div>
          )}
        </form>
      )}
    </>
  );
}
