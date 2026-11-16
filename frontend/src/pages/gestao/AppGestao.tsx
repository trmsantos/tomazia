import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { quemSouEu } from "../../lib/api/auth";
import { ErroDaApi } from "../../lib/api/cliente";
import { AAbrirAGestao, ErroAoAbrirAGestao } from "../AberturaDaGestao";
import { Destino } from "./Destino";
import { Entrar } from "./Entrar";
import { MolduraDaGestao } from "./MolduraDaGestao";
import { destinoParaLembrar } from "./destino-depois-de-entrar";
import { DESTINOS, ROTAS_DOS_DESTINOS, navegar, useCaminho } from "./navegacao";
import { armarPrazo } from "./prazo";
import { ContextoDaSessao } from "./SessaoDaGestao";

/**
 * A gestão inteira (F4-01, secções 2, 4 e 5.5). É o que o `main.tsx` carrega à
 * parte por `import()`: export por omissão.
 *
 * `/gestao/entrar` é o login, sem guarda e sem moldura. Qualquer outra rota é
 * `guarda -> moldura -> destino`; uma rota desconhecida (ou `/gestao/`)
 * substitui-se por `/gestao`.
 *
 * **A guarda** pergunta `GET /auth/eu` **uma vez** ao entrar e guarda o
 * resultado enquanto se navega entre destinos. Só o 401 manda para o login; tudo
 * o resto — sem resposta, 403, 5xx — é «não consegui perguntar», e um dono com
 * sessão não pode ser empurrado para escrever a password por causa disso
 * (regra 10). Sair, ou um 401 a meio de um destino, apaga o resultado.
 *
 * **O 401 lembra de onde veio** (F4-02, D4): leva ao login com `{ voltar,
 * sessaoTerminou? }` no `history.state` (nunca no endereço — um link de fora não
 * escreve lá). `sessaoTerminou` só quando a sessão estava confirmada: o 401 da
 * guarda à chegada (nunca houve sessão nesta visita) não diz «a sessão
 * terminou». «Sair» de propósito não passa por aqui (não lembra nada): navega
 * para o login e é o `useEffect` de «chegou ao login» que apaga o resultado.
 */
const ENTRAR = "/gestao/entrar";
const TITULO_DA_GESTAO = "Gestão — Bar da Tomazia";

type Guarda =
  | { estado: "a-abrir" }
  | { estado: "ok" }
  | { estado: "erro"; semResposta: boolean; aTentar: boolean };

/** Sem a barra final (exceto a raiz). */
function semBarraFinal(caminho: string): string {
  return caminho.length > 1 && caminho.endsWith("/") ? caminho.slice(0, -1) : caminho;
}

export default function AppGestao(): ReactElement {
  const caminho = useCaminho();
  const normal = semBarraFinal(caminho);
  const naEntrada = normal === ENTRAR;
  const conhecida = naEntrada || ROTAS_DOS_DESTINOS.has(normal);

  const [guarda, setGuarda] = useState<Guarda>({ estado: "a-abrir" });
  // Aumenta a cada «Tentar outra vez», para a guarda voltar a perguntar.
  const [tentativa, setTentativa] = useState(0);
  // Espelha «a sessão está confirmada» para o efeito não depender do estado.
  const confirmada = useRef(false);

  const aoConfirmarSessao = useCallback(() => {
    confirmada.current = true;
    setGuarda({ estado: "ok" });
  }, []);

  const aoPerderSessao = useCallback(() => {
    const estavaConfirmada = confirmada.current;
    confirmada.current = false;
    setGuarda({ estado: "a-abrir" });

    const origem = window.location;
    const voltar = destinoParaLembrar(semBarraFinal(origem.pathname) + origem.search);
    const estado = {
      ...(voltar !== undefined ? { voltar } : {}),
      ...(estavaConfirmada ? { sessaoTerminou: true } : {}),
    };
    navegar(ENTRAR, {
      substituir: true,
      ...(Object.keys(estado).length > 0 ? { estado } : {}),
    });
  }, []);

  const sessao = useMemo(
    () => ({ aoPerderSessao, aoConfirmarSessao }),
    [aoPerderSessao, aoConfirmarSessao],
  );

  // Chegar ao login, por qualquer via (401, «Sair», o Recuar), apaga o resultado
  // da guarda: o que se abrir a seguir pergunta outra vez. O estado ajusta-se
  // durante o desenho (o padrão do React para «mudou isto, muda aquilo»), e o
  // espelho em `confirmada` no efeito da guarda, abaixo.
  const [estavaNaEntrada, setEstavaNaEntrada] = useState(naEntrada);
  if (naEntrada !== estavaNaEntrada) {
    setEstavaNaEntrada(naEntrada);
    if (naEntrada) setGuarda({ estado: "a-abrir" });
  }

  // Rota desconhecida, ou com barra a mais: para a raiz da gestão, a substituir.
  useEffect(() => {
    const alvo = conhecida ? normal : "/gestao";
    if (alvo !== caminho) navegar(alvo, { substituir: true });
  }, [caminho, normal, conhecida]);

  // A guarda. Só pergunta fora do login e enquanto a sessão não está confirmada;
  // tocar na barra de navegação não repete o pedido.
  useEffect(() => {
    if (naEntrada) {
      confirmada.current = false;
      return;
    }
    if (confirmada.current) return;

    const controlador = new AbortController();
    const desarmar = armarPrazo(controlador);

    quemSouEu({ sinal: controlador.signal }).then(
      () => {
        desarmar();
        if (controlador.signal.aborted) return;
        aoConfirmarSessao();
      },
      (erro: unknown) => {
        desarmar();
        // Desmontou, ou a gestão mudou de rota: não é uma resposta.
        if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
        if (erro instanceof ErroDaApi && erro.estado === 401) {
          aoPerderSessao();
          return;
        }
        setGuarda({
          estado: "erro",
          semResposta: erro instanceof ErroDaApi && erro.estado === null,
          aTentar: false,
        });
      },
    );

    return () => {
      desarmar();
      controlador.abort();
    };
  }, [naEntrada, tentativa, aoConfirmarSessao, aoPerderSessao]);

  // Ao mudar de destino por qualquer via: o título do separador, o foco no
  // `<h1>` do destino novo e a deslocação ao topo (5.5). Na primeira chegada
  // não se move o foco; depois de um login (vindo de /gestao/entrar) move-se.
  const anterior = useRef<string | null>(null);
  const focoPendente = useRef(false);
  useEffect(() => {
    if (anterior.current !== null && anterior.current !== normal) focoPendente.current = true;
    anterior.current = normal;

    if (naEntrada || guarda.estado !== "ok" || !ROTAS_DOS_DESTINOS.has(normal)) return;

    const rotulo = DESTINOS.find((destino) => destino.caminho === normal)?.rotulo;
    document.title = rotulo !== undefined ? `${rotulo} — ${TITULO_DA_GESTAO}` : TITULO_DA_GESTAO;

    if (focoPendente.current) {
      focoPendente.current = false;
      document.documentElement.scrollTop = 0;
      document.querySelector<HTMLElement>("main h1")?.focus();
    }
  }, [normal, naEntrada, guarda.estado]);

  let ecra: ReactElement;
  if (naEntrada) {
    ecra = <Entrar />;
  } else if (guarda.estado === "erro") {
    ecra = (
      <ErroAoAbrirAGestao
        semResposta={guarda.semResposta}
        aTentar={guarda.aTentar}
        aoTentar={() => {
          setGuarda({ ...guarda, aTentar: true });
          setTentativa((anteriorTentativa) => anteriorTentativa + 1);
        }}
      />
    );
  } else if (guarda.estado === "ok" && conhecida) {
    ecra = (
      <MolduraDaGestao caminho={normal}>
        <Destino caminho={normal} />
      </MolduraDaGestao>
    );
  } else {
    ecra = <AAbrirAGestao />;
  }

  return <ContextoDaSessao.Provider value={sessao}>{ecra}</ContextoDaSessao.Provider>;
}
