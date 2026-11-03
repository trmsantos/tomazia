import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { Botao } from "../../components/ui/Botao";
import { EstadoVazio } from "../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../lib/api/cliente";
import { obterEventos } from "../../lib/api/publico";
import type { Eventos as RespostaDosEventos } from "../../lib/api/publico";
import { formatarDataDoEvento } from "../../lib/formato/data-do-evento";
import type { DataDoEvento } from "../../lib/formato/data-do-evento";

/**
 * Próximos eventos — a terceira secção da página pública (`docs/ecras/F3-04.md`).
 *
 * Entra **depois da ementa** (2.1): assim a ligação "Saltar para a ementa" do
 * cabeçalho continua a aterrar onde aterrava, sem nada pelo meio, e esta
 * secção não paga uma segunda ligação de salto a toda a gente.
 *
 * Quatro coisas que este ficheiro carrega e que não se mudam sem passar pela
 * especificação:
 *
 * 1. **A secção some quando não há eventos, e aparece quando o pedido
 *    falhou** (8). É a regra 10 do `CLAUDE.md` num ecrã público, e é o
 *    defeito mais provável desta tarefa: "não há" e "não consegui perguntar"
 *    desenham-se igual se ninguém escrever o contrário.
 * 2. **A carregar não há nada — nem esqueleto** (8.1). Esta é a primeira
 *    secção da página que pode não existir, e o fim normal do estado "a
 *    carregar" é ela desaparecer. Um esqueleto prometia uma secção que, na
 *    maior parte dos dias, acaba por não vir.
 * 3. **Nada aqui é tocável** (1, ponto 4). Não há ecrã de detalhe do evento
 *    neste projeto, e um cartão clicável que não leva a lado nenhum é pior do
 *    que um cartão quieto. A única paragem de `Tab` da secção é o "Tentar
 *    outra vez" do erro.
 * 4. **A data calcula-se no browser, no render** (5.5). `GET /eventos` tem
 *    cache de 60 s: um "Hoje" cozido na resposta servia-se na manhã seguinte.
 */

/** O texto visível, todo ele. A tabela está em `docs/ecras/F3-04.md`, 9. */
const TEXTOS = {
  titulo: "Próximos eventos",
  maisEventos: "Há mais eventos marcados. Pergunta no balcão.",
  erroTitulo: "Não consegui carregar os eventos.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  /*
   * A terceira causa tem **a sua própria frase e nenhum botão** (5.4).
   * «mostrar» e não «carregar» porque os eventos carregaram: o pedido
   * correu bem e quem não sabe ler datas de Lisboa é o aparelho. Nenhuma
   * das duas linhas de cima servia — não é a ligação da pessoa, não é
   * problema nosso, e «daqui a pouco» é falso: o aparelho continua sem a
   * base de fusos.
   *
   * Esta linha **não** colide com o par da ementa: a ementa não formata
   * datas e nunca chega a este estado, por isso não há aqui dois verbos
   * para a mesma avaria na mesma página — há dois verbos para duas.
   */
  erroSemLisboaTitulo: "Não consegui mostrar os eventos.",
  erroSemLisboa: "Não consegui ler as datas neste aparelho. Pergunta no balcão.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;

const ID_DA_SECCAO = "eventos";
const ID_DO_TITULO = "titulo-eventos";

/** Quantos cartões ficam à vista. Quem corta é a secção, não o backend (7.1). */
const QUANTOS_CABEM = 3;

/** O mesmo prazo da ementa: mais e a pessoa já saiu, menos e uma rede fraca falha. */
const PRAZO_MS = 10_000;

/** Um evento da resposta pública, sem repetir o caminho do tipo gerado. */
type EventoPublico = RespostaDosEventos["eventos"][number];

/**
 * A máquina de estados de 8.3. Três membros, e o render tem três ramos.
 *
 * **O vazio não é um estado à parte**: é o `pronto` com uma lista vazia, e os
 * dois dão o mesmo ecrã — nenhum. O que tem de ser um estado à parte é o
 * `falhou`, porque é o único que tem de aparecer.
 */
type EstadoDosEventos =
  | { estado: "a-carregar" }
  | { estado: "pronto"; eventos: EventoPublico[] }
  | { estado: "falhou"; semResposta: boolean };

/** Um cartão já com a data escrita, pronto a desenhar. */
type CartaoDeEvento = { evento: EventoPublico; data: DataDoEvento };

/**
 * O nome do erro, lido sem acreditar na forma dele.
 *
 * Devolve `null` quando não há nome nenhum para ler — que é "não sei" e não
 * "não é um cancelamento". É a mesma função da `Ementa`, e está repetida pela
 * razão que o `CLAUDE.md` dá na regra 10: um guarda que confunda "não
 * encontrei" com "não consegui procurar" decide ao contrário.
 */
function nomeDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("name" in erro)) return null;
  return String((erro as { name: unknown }).name);
}

/**
 * As datas dos cartões, ou `null` se o aparelho não souber que dia é em
 * Lisboa.
 *
 * `formatarDataDoEvento` lança `RangeError` num aparelho sem a base de dados
 * de fusos (5.4). Se a excessão subisse do render, não era a secção dos
 * eventos que desaparecia: era a página inteira a ficar em branco, com a
 * ementa e o cabeçalho lá dentro. Aqui ela vira **estado de erro** — "não
 * consegui saber que dia é em Lisboa" não se pode ler como "não há eventos"
 * (regra 10).
 */
function prepararCartoes(eventos: EventoPublico[], agora: Date): CartaoDeEvento[] | null {
  try {
    return eventos.map((evento) => ({
      evento,
      data: formatarDataDoEvento(evento.inicio, agora),
    }));
  } catch {
    return null;
  }
}

/** Um cartão, e nada nele recebe `Tab` (2.2). */
function CartaoDoEvento({ evento, data }: CartaoDeEvento): ReactElement {
  /*
   * O cartaz desaparece do cartão quando a imagem não chega (6.3). Um 404 em
   * `/media/` é um caso normal e não uma avaria: a F2-08 importou nomes de
   * ficheiro da base de dados antiga e esses ficheiros podem nunca ter
   * chegado ao servidor. Deixar lá a caixa vazia era um buraco permanente.
   */
  const [cartazFalhou, setCartazFalhou] = useState(false);
  const comCartaz = evento.imagem !== null && evento.imagem !== "" && !cartazFalhou;

  return (
    <li className="superficie-painel rounded-cartao border border-fio-interno p-4">
      {/*
       * **Um só cabeçalho por cartão, com a data lá dentro** (4.3). Quem usa
       * leitor de ecrã salta de cabeçalho em cabeçalho: com o `<h3>` a conter
       * só o nome, ouvia "Noite de samba" e não ouvia a data — ela está
       * *acima* do cabeçalho, e teria de voltar atrás para a encontrar.
       *
       * É também o que faz o texto do cartão chegar sozinho: o cartaz traz a
       * data e a hora desenhadas dentro da imagem, e isso não existe para
       * quem não vê a imagem.
       */}
      {/*
       * Os espaços entre as três linhas são **texto, e de propósito**. O nome
       * acessível de um cabeçalho junta-se a partir dos filhos, e quem lá põe
       * os separadores é o `display: block` de cada `<span>` — ou seja, a
       * folha de estilo. Sem eles escritos, uma folha que não chegue (e o
       * jsdom é precisamente isso) dá "HojeA partir das 22:00Noite de samba",
       * que é o cartão inteiro colado numa palavra só para quem o ouve. Um
       * nome acessível não pode depender do CSS ter carregado.
       */}
      <h3>
        <span className="block font-titulo text-destaque text-texto">{data.grande}</span>{" "}
        <span className="mt-1 block text-nota text-texto-suave">{data.pequena}</span>{" "}
        <span className="mt-2 block text-seccao font-forte text-texto">{evento.titulo}</span>
      </h3>

      {/*
       * A descrição aparece **inteira**, sem corte e sem "ver mais" (10): não
       * há ecrã de detalhe para onde mandar quem quer ler o resto. E só
       * existe quando há texto — um `<p>` vazio não se vê e ocupa a sua linha
       * de altura, e o cartão curto deixava de ser curto.
       */}
      {evento.descricao !== null && evento.descricao !== "" && (
        <p className="mt-2 text-corpo text-texto-suave">{evento.descricao}</p>
      )}

      {/*
       * O cartaz é a última coisa do cartão e **não tem lugar reservado**
       * (6.1): sem imagem, o cartão é mais baixo e mais nada. Em baixo e não
       * em cima para que os três cartões comecem todos na data grande, que é
       * o que se vem aqui ler.
       *
       * A caixa é de proporção fixa porque o contrato não manda dimensões:
       * sem ela, a imagem só ocupa lugar depois de chegar e a página salta
       * por baixo de quem está a ler, numa ligação de dados móveis (6.2).
       * Vazia, é um retângulo com um fio de 1 px — nem bloco pintado nem
       * animação: o movimento, neste projeto, é só resposta a ações.
       */}
      {comCartaz && (
        <div className="mt-4 aspect-cartaz overflow-hidden rounded-pequeno border border-fio-interno">
          <img
            src={`/media/${evento.imagem ?? ""}`}
            /* O título, e não "cartaz": "cartaz" nomeia o objeto e deixa quem
               ouve sem saber de quê. É a única descrição honesta que temos —
               o contrato não traz texto alternativo nenhum (6.4). */
            alt={evento.titulo}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={() => {
              setCartazFalhou(true);
            }}
          />
        </div>
      )}
    </li>
  );
}

export function Eventos(): ReactElement | null {
  const [estado, setEstado] = useState<EstadoDosEventos>({ estado: "a-carregar" });
  const [tentativa, setTentativa] = useState(0);
  const [aTentar, setATentar] = useState(false);

  /*
   * O relógio contra o qual as datas se lêem (5.6).
   *
   * Duas fronteiras mexem sozinhas enquanto a página está aberta: a
   * meia-noite de Lisboa (que troca "Amanhã" por "Hoje") e a hora de início
   * (que troca "A partir das" por "Começou às"). Um telemóvel ficado numa
   * mesa atravessa as duas.
   *
   * A recontagem é **no regresso à página**, e não num `setInterval`: um
   * relógio a bater num separador aberto durante uma noite inteira gasta
   * bateria para corrigir uma frase que ninguém está a olhar.
   */
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    function aoVoltar(): void {
      if (document.visibilityState === "visible") setAgora(new Date());
    }

    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);

  /*
   * O pedido é desta secção e não do `App.tsx` (8.1): o `/info` subiu porque
   * dois ecrãs precisam do mesmo payload, e o `/eventos` é só daqui, como o
   * `/ementa` é só da ementa. Parte **ao montar** e não ao chegar perto do
   * ecrã — um pedido adiado punha a secção a aparecer por baixo do polegar de
   * quem está a ler a ementa.
   *
   * O prazo não é zelo. Sem ele, um pedido pendurado deixa a secção
   * invisível para sempre, e uma secção invisível lê-se exactamente como
   * "não há eventos marcados": a regra 10 outra vez, desta vez pelo relógio.
   */
  useEffect(() => {
    const controlo = new AbortController();
    const prazo = window.setTimeout(() => {
      controlo.abort(new DOMException("prazo", "TimeoutError"));
    }, PRAZO_MS);

    obterEventos({ sinal: controlo.signal })
      .then((resposta) => {
        if (controlo.signal.aborted) return;
        setEstado({ estado: "pronto", eventos: resposta.eventos });
        setATentar(false);
      })
      .catch((erro: unknown) => {
        // Três ramos para três casos, pela mesma ordem da `Ementa`, e **a
        // ordem não é óbvia**.
        //
        // 1. Um erro da API é sempre ecrã de erro.
        if (erro instanceof ErroDaApi) {
          setEstado({ estado: "falhou", semResposta: erro.estado === null });
          setATentar(false);
          return;
        }
        // 2. **Só depois** se pergunta pelo cancelamento. Um prazo esgotado
        //    põe `signal.aborted` a `true` **e** chega aqui como `ErroDaApi`:
        //    com o guarda do cancelamento à frente, ele era engolido e a
        //    secção ficava invisível para sempre, sem botão nenhum para
        //    tentar outra vez. Um cancelamento nosso, esse, não é uma
        //    resposta que não chegou — em `StrictMode` há sempre um.
        if (controlo.signal.aborted || nomeDoErro(erro) === "AbortError") return;
        // 3. Tudo o resto é o nosso próprio código a rebentar com uma
        //    resposta que chegou mas não era a esperada. Houve resposta, por
        //    isso a linha é a do servidor.
        setEstado({ estado: "falhou", semResposta: false });
        setATentar(false);
      })
      .finally(() => {
        window.clearTimeout(prazo);
      });

    return () => {
      window.clearTimeout(prazo);
      // Sem motivo: um desmontar é um cancelamento, e tem de se distinguir
      // do prazo esgotado.
      controlo.abort();
    };
  }, [tentativa]);

  const eventos = estado.estado === "pronto" ? estado.eventos : undefined;

  /*
   * Os três mais próximos, que são os três primeiros porque a lista vem
   * ordenada do backend (ADR 0010): quem corta não reordena.
   *
   * A memória não é otimização — é o que mantém o estado de erro **estável**.
   * Sem ela, uma data que falhou a ser escrita podia ser tentada outra vez no
   * render seguinte e a secção oscilava entre o erro e os cartões.
   */
  const cartoes = useMemo(
    () => (eventos === undefined ? null : prepararCartoes(eventos.slice(0, QUANTOS_CABEM), agora)),
    [eventos, agora],
  );

  // A carregar e sem eventos dão o mesmo ecrã, e esse ecrã é nenhum (8).
  if (estado.estado === "a-carregar") return null;
  if (estado.estado === "pronto" && estado.eventos.length === 0) return null;

  const semLisboa = estado.estado === "pronto" && cartoes === null;
  const falhou = estado.estado === "falhou" || semLisboa;

  /*
   * **Três causas, três ecrãs** — e é a regra 10 outra vez, no quarto sítio
   * desta secção. Durante uma versão houve três causas e duas frases: o fuso
   * que o aparelho não conhece caía na linha do servidor e a pessoa lia "o
   * problema é nosso… tenta outra vez daqui a pouco", com um botão que
   * repetia o pedido e voltava a falhar, para sempre.
   *
   * O botão só existe onde pode resolver alguma coisa. Sem Lisboa, tentar
   * outra vez traz a mesma resposta e volta a não se conseguir ler: um botão
   * que não pode funcionar é pior do que nenhum (decisão do Tomás).
   */
  const avaria = semLisboa
    ? { titulo: TEXTOS.erroSemLisboaTitulo, linha: TEXTOS.erroSemLisboa, comBotao: false }
    : {
        titulo: TEXTOS.erroTitulo,
        // Um erro sem resposta é a ligação da pessoa; com resposta é nossa.
        linha:
          estado.estado === "falhou" && estado.semResposta
            ? TEXTOS.erroSemResposta
            : TEXTOS.erroComResposta,
        comBotao: true,
      };

  return (
    <section
      id={ID_DA_SECCAO}
      aria-labelledby={ID_DO_TITULO}
      /*
       * Sem `aria-live`: a secção aparece uma vez, depois de a resposta
       * chegar, e nunca mais muda sozinha. Uma região viva anunciava a
       * chegada dos eventos a quem está a ler a ementa, por cima do que
       * estava a ler (3).
       */
      className="pb-8"
    >
      {/*
       * As mesmas classes do `<h2> Ementa`, à letra: as duas secções alinham
       * na mesma coluna de 640 px e os dois títulos têm de assentar na mesma
       * linha vertical, senão a página lê-se como duas páginas coladas. O
       * `pt-8` daqui mais o `pb-8` da ementa são os 64 px de respiro entre as
       * duas, que é o maior da página pública e é intencional (3).
       */}
      <h2
        id={ID_DO_TITULO}
        className="mx-auto max-w-coluna px-4 pb-3 pt-8 font-titulo text-titulo text-texto"
      >
        {TEXTOS.titulo}
      </h2>

      {falhou ? (
        <div className="px-4">
          <EstadoVazio tom="erro" titulo={avaria.titulo} linha={avaria.linha}>
            {/*
             * **Secundário.** O dourado da página pública está gasto no
             * "WiFi" do cabeçalho (F3-03, 6.1) e esta não é a ação principal
             * de ecrã nenhum — o único dourado desta secção é o anel de foco.
             *
             * E o botão fica montado durante a tentativa, a dizer "A
             * tentar…": voltar ao estado "a carregar" fazia a secção
             * desaparecer, botão incluído, e o foco de quem acabou de
             * carregar caía para o `<body>` (8.3).
             */}
            {avaria.comBotao && (
              <Botao
                aTrabalhar={aTentar}
                textoATrabalhar={TEXTOS.aTentar}
                onClick={() => {
                  setATentar(true);
                  setTentativa((anterior) => anterior + 1);
                }}
              >
                {TEXTOS.tentarOutraVez}
              </Botao>
            )}
          </EstadoVazio>
        </div>
      ) : (
        <>
          {/* Uma `<ul>` só: um leitor de ecrã anuncia "lista com 3 itens",
              que é a informação que o olho recebe de graça (3). */}
          <ul className="mx-auto flex max-w-coluna flex-col gap-4 px-4">
            {(cartoes ?? []).map((cartao) => (
              <CartaoDoEvento key={cartao.evento.id} evento={cartao.evento} data={cartao.data} />
            ))}
          </ul>

          {/*
           * A linha dos excedentes (7.2). Aparece **só** quando a resposta
           * trouxe mais de três: com exactamente três não há nada a mais.
           *
           * Não é ligação, não é botão e não tem seta — não existe ecrã
           * público de eventos neste projeto e não há para onde mandar
           * ninguém. Existe por honestidade de contagem: nós sabemos quantos
           * eventos há, e mostrar três em silêncio era omitir uma coisa que
           * acabámos de receber.
           */}
          {eventos !== undefined && eventos.length > QUANTOS_CABEM && (
            <p className="mx-auto max-w-coluna px-4 pt-4 text-nota text-texto-suave">
              {TEXTOS.maisEventos}
            </p>
          )}
        </>
      )}
    </section>
  );
}
