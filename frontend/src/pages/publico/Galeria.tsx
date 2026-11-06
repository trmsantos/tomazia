import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { Botao } from "../../components/ui/Botao";
import { EstadoVazio } from "../../components/ui/EstadoVazio";
import { ErroDaApi } from "../../lib/api/cliente";
import { obterGaleria } from "../../lib/api/publico";
import type { Galeria as RespostaDaGaleria } from "../../lib/api/publico";
import { FolhaEnviarFoto } from "./FolhaEnviarFoto";
import { VisualizadorDeFotos } from "./VisualizadorDeFotos";

/**
 * A secção "Galeria" (`docs/ecras/F3-05.md`, secção 3) — a quinta secção
 * pública, a seguir aos eventos.
 *
 * **Ao contrário dos eventos, a galeria nunca desaparece** (2.1): o `<h2>`
 * existe nos seis estados de 12.1, incluindo o vazio e o erro — é a mesma
 * regra 10 do `CLAUDE.md` que já governa a ementa e os eventos, aplicada
 * aqui com uma diferença: aqui "não há fotos" é o estado de lançamento, não
 * um caso de borda, e tem texto de convite próprio (`EstadoVazio`).
 *
 * **A grelha começa com seis fotos.** `GET /galeria` devolve todas as
 * aprovadas, sem paginação; é esta secção que corta para seis e revela o
 * resto com "Ver mais fotos", sem pedido novo (4.6) — os dados já estão
 * todos em memória.
 *
 * O Visualizador e a Folha de envio vivem aqui, fora da `<ul>` (3): dois
 * `<dialog>` que a `Galeria` mantém montados o tempo todo, abertos ou não,
 * e aos quais só passa o que decide quando se abrem.
 */

const TEXTOS = {
  titulo: "Galeria",
  enviarUmaFoto: "Enviar uma foto",
  vazioTitulo: "Ainda não há fotos.",
  vazioLinha: "Sê o primeiro a mostrar uma noite no bar.",
  erroTitulo: "Não consegui carregar a galeria.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroComResposta: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
  verMaisFotos: "Ver mais fotos",
  altSemLegenda: "Fotografia do bar enviada por um cliente.",
} as const;

const ID_DA_SECCAO = "galeria";
const ID_DO_TITULO = "titulo-galeria";

/** Quantas fotos ficam à vista antes de "Ver mais fotos" (4.6). */
const QUANTAS_CABEM = 6;

/** O mesmo prazo da ementa e dos eventos: mais e a pessoa já saiu, menos e uma rede fraca falha. */
const PRAZO_MS = 10_000;

/** Uma foto da resposta pública, sem repetir o caminho do tipo gerado. */
export type FotoPublica = RespostaDaGaleria["fotos"][number];

type EstadoDaGaleria =
  | { estado: "a-carregar" }
  | { estado: "pronto"; fotos: FotoPublica[] }
  | { estado: "falhou"; semResposta: boolean };

/**
 * O nome do erro, lido sem acreditar na forma dele. `null` é "não sei", não
 * "não é um cancelamento" — a mesma função da `Ementa` e dos `Eventos`,
 * repetida aqui pela razão que a regra 10 do `CLAUDE.md` dá: um guarda que
 * confunda "não encontrei" com "não consegui procurar" decide ao contrário.
 */
function nomeDoErro(erro: unknown): string | null {
  if (typeof erro !== "object" || erro === null || !("name" in erro)) return null;
  return String((erro as { name: unknown }).name);
}

/** O `alt` de cada foto (5.4): a descrição, ou a frase genérica — nunca vazio. */
export function altDaFoto(foto: FotoPublica): string {
  return foto.descricao ?? TEXTOS.altSemLegenda;
}

/** Os seis quadrados do esqueleto, sem imagem e fora da árvore de acessibilidade (4.4). */
function Esqueleto(): ReactElement {
  return (
    <ul
      aria-busy="true"
      className="mx-auto grid max-w-coluna grid-cols-2 gap-1 px-4 lg:grid-cols-3"
    >
      {Array.from({ length: QUANTAS_CABEM }, (_valor, indice) => (
        <li
          key={indice}
          aria-hidden="true"
          className="aspect-foto rounded-pequeno bg-fio-interno"
        />
      ))}
    </ul>
  );
}

/**
 * Um item da grelha, com o mesmo cuidado do cartaz de evento (`Eventos.tsx`,
 * `CartaoDoEvento`): se a imagem falhar a chegar (um 404, por exemplo),
 * mostra-se uma caixa neutra do mesmo tamanho em vez do ícone nativo de
 * imagem partida do browser — sugestão da ui-ux, confirmada com um 404 a
 * sério: sem isto, o Chromium desenha o próprio ícone, mais o `alt` como
 * texto corrido por baixo dele.
 */
function ItemDaGrelha({ foto, onAbrir }: { foto: FotoPublica; onAbrir: () => void }): ReactElement {
  const [falhou, setFalhou] = useState(false);

  return (
    <li>
      {/* O botão herda o `alt` da `<img>` como nome acessível, sem
          `aria-label` próprio (3, 5.4) — exceto quando a imagem falha: aí
          não há `alt` nenhum para herdar (a caixa neutra é decorativa), e
          só nesse estado o botão ganha o seu próprio `aria-label`. */}
      <button
        type="button"
        aria-label={falhou ? altDaFoto(foto) : undefined}
        className="block w-full"
        onClick={onAbrir}
      >
        {falhou ? (
          <div
            aria-hidden="true"
            className="aspect-foto w-full rounded-pequeno border border-fio-interno bg-fio-interno"
          />
        ) : (
          <img
            src={`/media/${foto.ficheiro}`}
            alt={altDaFoto(foto)}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => {
              setFalhou(true);
            }}
            className="aspect-foto w-full rounded-pequeno border border-fio-interno object-cover"
          />
        )}
      </button>
    </li>
  );
}

export function Galeria(): ReactElement {
  const [estado, setEstado] = useState<EstadoDaGaleria>({ estado: "a-carregar" });
  const [tentativa, setTentativa] = useState(0);
  const [aTentar, setATentar] = useState(false);
  const [tudoRevelado, setTudoRevelado] = useState(false);
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [indiceAberto, setIndiceAberto] = useState<number | null>(null);

  useEffect(() => {
    const controlo = new AbortController();
    const prazo = window.setTimeout(() => {
      controlo.abort(new DOMException("prazo", "TimeoutError"));
    }, PRAZO_MS);

    obterGaleria({ sinal: controlo.signal })
      .then((resposta) => {
        if (controlo.signal.aborted) return;
        setEstado({ estado: "pronto", fotos: resposta.fotos });
        setATentar(false);
      })
      .catch((erro: unknown) => {
        if (erro instanceof ErroDaApi) {
          setEstado({ estado: "falhou", semResposta: erro.estado === null });
          setATentar(false);
          return;
        }
        if (controlo.signal.aborted || nomeDoErro(erro) === "AbortError") return;
        setEstado({ estado: "falhou", semResposta: false });
        setATentar(false);
      })
      .finally(() => {
        window.clearTimeout(prazo);
      });

    return () => {
      window.clearTimeout(prazo);
      controlo.abort();
    };
  }, [tentativa]);

  const fotos = estado.estado === "pronto" ? estado.fotos : [];
  const visiveis = tudoRevelado ? fotos : fotos.slice(0, QUANTAS_CABEM);
  const temMais = !tudoRevelado && fotos.length > QUANTAS_CABEM;

  return (
    <section id={ID_DA_SECCAO} aria-labelledby={ID_DO_TITULO} className="pb-8">
      <h2
        id={ID_DO_TITULO}
        className="mx-auto max-w-coluna px-4 pb-3 pt-8 font-titulo text-titulo text-texto"
      >
        {TEXTOS.titulo}
      </h2>

      {estado.estado === "a-carregar" && <Esqueleto />}

      {estado.estado === "falhou" && (
        <div className="mx-auto max-w-coluna px-4">
          <EstadoVazio
            tom="erro"
            titulo={TEXTOS.erroTitulo}
            linha={estado.semResposta ? TEXTOS.erroSemResposta : TEXTOS.erroComResposta}
          >
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
          </EstadoVazio>
        </div>
      )}

      {estado.estado === "pronto" && fotos.length === 0 && (
        <div className="mx-auto max-w-coluna px-4">
          <EstadoVazio titulo={TEXTOS.vazioTitulo} linha={TEXTOS.vazioLinha}>
            <Botao
              variante="secundario"
              onClick={() => {
                setFolhaAberta(true);
              }}
            >
              {TEXTOS.enviarUmaFoto}
            </Botao>
          </EstadoVazio>
        </div>
      )}

      {estado.estado === "pronto" && fotos.length > 0 && (
        <>
          <div className="mx-auto max-w-coluna px-4 pb-3">
            <Botao
              variante="secundario"
              onClick={() => {
                setFolhaAberta(true);
              }}
            >
              {TEXTOS.enviarUmaFoto}
            </Botao>
          </div>

          <ul className="mx-auto grid max-w-coluna grid-cols-2 gap-1 px-4 lg:grid-cols-3">
            {visiveis.map((foto, indice) => (
              <ItemDaGrelha
                key={foto.id}
                foto={foto}
                onAbrir={() => {
                  setIndiceAberto(indice);
                }}
              />
            ))}
          </ul>

          {temMais && (
            <div className="mx-auto max-w-coluna px-4 pt-3">
              <Botao
                variante="secundario"
                onClick={() => {
                  setTudoRevelado(true);
                }}
              >
                {TEXTOS.verMaisFotos}
              </Botao>
            </div>
          )}
        </>
      )}

      <VisualizadorDeFotos
        fotos={fotos}
        indiceAberto={indiceAberto}
        aoFechar={() => {
          setIndiceAberto(null);
        }}
        aoNavegar={(novoIndice) => {
          setIndiceAberto(novoIndice);
        }}
      />

      <FolhaEnviarFoto
        aberta={folhaAberta}
        aoFechar={() => {
          setFolhaAberta(false);
        }}
      />
    </section>
  );
}
