import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../components/ui/Botao";
import { EstadoVazio } from "../../components/ui/EstadoVazio";
import { sair } from "../../lib/api/auth";
import { ErroDaApi } from "../../lib/api/cliente";
import { DefinicoesGestao } from "./definicoes/DefinicoesGestao";
import { TEXTOS as TEXTOS_DAS_DEFINICOES } from "./definicoes/textos";
import { EmentaGestao } from "./ementa/EmentaGestao";
import { EventosGestao } from "./eventos/EventosGestao";
import { GaleriaGestao } from "./galeria/GaleriaGestao";
import { DESTINOS, eCliqueSimples, navegar } from "./navegacao";
import { armarPrazo } from "./prazo";

/**
 * O conteúdo de cada destino (F4-01, secções 6 e 7).
 *
 * Nesta altura só o Início é vazio (a F4-05b preenche-o), e «Mais» tem «Definições» e «Sair».
 * Quando um destino ganha o seu ecrã, perde o `EstadoVazio` e fica só o `<h1>`. O `<h1>` é de
 * cada destino (`tabindex="-1"`, para receber o
 * foco ao mudar de destino — quem o move é o `AppGestao`).
 */
const TEXTOS = {
  vazioTitulo: "Ainda não há nada aqui.",
  vazioInicio: "Esta página não tem conteúdo nesta versão.",
  sair: "Sair",
  aSair: "A sair…",
  saiuSemResposta:
    "Não consegui sair, por isso a sessão continua aberta. Verifica a ligação e tenta outra vez.",
  saiuServidor:
    "Não consegui sair, por isso a sessão continua aberta. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
} as const;

const LINHA_DO_VAZIO: Record<string, string> = {
  "/gestao": TEXTOS.vazioInicio,
};

function Titulo({ children }: { children: string }): ReactElement {
  return (
    <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
      {children}
    </h1>
  );
}

/**
 * «Sair» (7.2 a 7.4). Secundário, do tamanho do texto, sem confirmação e sem
 * «Desfazer»: sair não apaga nada e volta a entrar-se.
 *
 * Nunca se finge que a sessão fechou: se o pedido falha, o dono fica em «Mais»,
 * com a sessão aberta, e a linha diz-lhe isso. O foco fica no botão.
 */
function Mais(): ReactElement {
  const idDaLinha = useId();
  const botao = useRef<HTMLButtonElement>(null);
  const cancelamento = useRef<AbortController | null>(null);
  const [aSair, setASair] = useState(false);
  // Um objeto novo a cada falha: a mesma frase duas vezes seguidas volta a
  // devolver o foco ao botão.
  const [falha, setFalha] = useState<{ texto: string } | null>(null);

  useEffect(() => {
    if (falha !== null) botao.current?.focus();
  }, [falha]);

  useEffect(() => {
    return () => {
      cancelamento.current?.abort();
    };
  }, []);

  async function aoSair(): Promise<void> {
    setFalha(null);
    setASair(true);

    const controlador = new AbortController();
    cancelamento.current = controlador;
    const desarmar = armarPrazo(controlador);
    try {
      await sair({ sinal: controlador.signal });
    } catch (erro) {
      // Desmontou a meio: não é uma falha, e já não há ecrã onde a mostrar.
      if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
      const semResposta = erro instanceof ErroDaApi && erro.estado === null;
      setASair(false);
      setFalha({ texto: semResposta ? TEXTOS.saiuSemResposta : TEXTOS.saiuServidor });
      return;
    } finally {
      desarmar();
    }

    // 204: navega para o login, a substituir (o `AppGestao` apaga o resultado da
    // guarda ao chegar lá). Sem destino e sem «A sessão terminou»: saiu de
    // propósito. O login que aparece é a confirmação; sem Aviso.
    navegar("/gestao/entrar", { substituir: true });
  }

  return (
    <>
      <Titulo>Mais</Titulo>
      <div className="flex flex-col items-start gap-4">
        {/* A lista de «Mais» (F4-05a): a F4-05b junta-lhe «Clientes» e «Conta», e o
            «Sair» passa então para «Conta». Uma linha inteira é a ligação. */}
        <ul className="superficie-painel w-full divide-y divide-fio-interno rounded-cartao border border-contorno-superficie">
          <li>
            <a
              href="/gestao/mais/definicoes"
              onClick={(evento) => {
                if (!eCliqueSimples(evento)) return;
                evento.preventDefault();
                navegar("/gestao/mais/definicoes");
              }}
              className="flex min-h-toque flex-col justify-center px-4 py-3"
            >
              <span className="text-corpo font-forte text-texto">
                {TEXTOS_DAS_DEFINICOES.ligacaoNoMais}
              </span>
              <span className="text-nota text-texto-suave">
                {TEXTOS_DAS_DEFINICOES.linhaDaLigacaoNoMais}
              </span>
            </a>
          </li>
        </ul>
        <Botao
          ref={botao}
          desativado={aSair}
          aTrabalhar={aSair}
          textoATrabalhar={TEXTOS.aSair}
          descritoPor={falha !== null ? idDaLinha : undefined}
          onClick={() => {
            void aoSair();
          }}
        >
          {TEXTOS.sair}
        </Botao>
        {falha !== null && (
          <p id={idDaLinha} role="status" className="text-nota text-erro">
            {falha.texto}
          </p>
        )}
      </div>
    </>
  );
}

export function Destino({ caminho }: { caminho: string }): ReactElement {
  if (caminho === "/gestao/mais") return <Mais />;
  if (caminho === "/gestao/mais/definicoes") return <DefinicoesGestao />;
  if (caminho === "/gestao/ementa") return <EmentaGestao />;
  if (caminho === "/gestao/eventos") return <EventosGestao />;
  if (caminho === "/gestao/galeria") return <GaleriaGestao />;

  const titulo = DESTINOS.find((destino) => destino.caminho === caminho)?.rotulo ?? "Início";
  return (
    <>
      <Titulo>{titulo}</Titulo>
      <EstadoVazio
        titulo={TEXTOS.vazioTitulo}
        linha={LINHA_DO_VAZIO[caminho] ?? TEXTOS.vazioInicio}
      />
    </>
  );
}
