import type { FormEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { Botao } from "../../components/ui/Botao";
import { Campo } from "../../components/ui/Campo";
import { entrar, quemSouEu } from "../../lib/api/auth";
import { ErroDaApi } from "../../lib/api/cliente";
import { tempoComposto } from "../../lib/formato/tempo-em-falta";
import { destinoDepoisDeEntrar } from "./destino-depois-de-entrar";
import { navegar } from "./navegacao";
import { armarPrazo } from "./prazo";
import { useSessaoOpcional } from "./SessaoDaGestao";

/**
 * O login (`docs/ecras/F4-01.md`, secção 3).
 *
 * **Os cinco desfechos do pedido não se leem iguais** (3.5 a 3.7), e é a coisa
 * mais importante deste ecrã:
 *
 *  - **400** — «Utilizador ou password inválidos…», do backend, tal como vem. É o
 *    único em que os dois campos ficam `aria-invalid`: foi o que se escreveu.
 *  - **429** — a conta está bloqueada. A frase do backend, mais uma segunda linha
 *    nossa com quanto falta, e o «Entrar» fica `aria-disabled` até ao prazo. Os
 *    campos **não** ficam inválidos: marcar a password como errada levava a
 *    pessoa a corrigi-la.
 *  - **sem resposta** e **servidor** — frases nossas e diferentes entre si; nunca
 *    a `mensagem` genérica do cliente e nunca «credenciais inválidas». Uma rede
 *    fraca não é uma password errada (regra 10).
 *
 * As três mensagens vão para o mesmo `<div id="login-mensagem" tabindex="-1">`,
 * que recebe o foco (sem `role="alert"`: duas regiões a dizer o mesmo).
 *
 * Os valores vivem só no estado deste componente: nunca em `localStorage` nem em
 * estado global, e deixam de existir quando o formulário desmonta.
 *
 * **O destino e o aviso vêm do `history.state`** (F4-02, D4), lido uma vez ao
 * montar, com verificação de forma: nunca do endereço, que um link de fora
 * controla. Com `sessaoTerminou === true` (exatamente o booleano) mostra «A sessão
 * terminou. Entra outra vez.»; depois de entrar — e no «já com sessão» — vai ao
 * destino lembrado, por `destinoDepoisDeEntrar`, que o valida outra vez, ou ao
 * Início. A substituir: o «Voltar» não regressa ao login.
 */
const TEXTOS = {
  nomeDoBar: "Bar da Tomazia",
  titulo: "Entrar na gestão",
  etiquetaUtilizador: "Utilizador (obrigatório)",
  etiquetaPassword: "Password (obrigatória)",
  erroUtilizador: "Escreve o utilizador.",
  erroPassword: "Escreve a password.",
  entrar: "Entrar",
  aEntrar: "A entrar…",
  semResposta: "Não consegui entrar. Verifica a ligação e tenta outra vez.",
  servidor:
    "Não consegui entrar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  sessaoTerminou: "A sessão terminou. Entra outra vez.",
} as const;

const ID_DA_MENSAGEM = "login-mensagem";

type Mensagem = {
  tipo: "sessao" | "credenciais" | "bloqueada" | "sem-resposta" | "servidor";
  texto: string;
  /** A segunda linha do 429, só quando há um prazo válido. */
  tempo?: string;
};

/**
 * O teto de um prazo aceitável: 24 horas. O bloqueio real é de 15 minutos, e o
 * `setTimeout` guarda o atraso em 32 bits com sinal (~24,8 dias): acima disso
 * dispara logo e desbloqueava o botão. Um valor acima do teto não é um prazo em
 * que se possa confiar, por isso segue a regra dos números inválidos.
 */
const PRAZO_MAXIMO_S = 86_400;

/**
 * Um prazo em segundos válido: um número finito, maior que zero e até ao teto.
 * «Em falta» não é zero (regra 10): sem número válido, não há prazo.
 */
function segundosValidos(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0 && valor <= PRAZO_MAXIMO_S
    ? valor
    : null;
}

/** O `Retry-After` em segundos inteiros. Qualquer outra coisa não é prazo. */
function segundosDoCabecalho(valor: string | undefined): number | null {
  if (valor === undefined || !/^\d+$/.test(valor.trim())) return null;
  return segundosValidos(Number(valor.trim()));
}

/** O maior dos prazos válidos, ou `null` se nenhum o é. */
function prazoDoBloqueio(erro: ErroDaApi): number | null {
  const candidatos = [
    segundosValidos(erro.extra.segundos_em_falta),
    segundosDoCabecalho(erro.cabecalhos["retry-after"]),
  ].filter((segundos): segundos is number => segundos !== null);
  return candidatos.length === 0 ? null : Math.max(...candidatos);
}

/** `history.state?.sessaoTerminou === true`, sem confiar na forma do que lá está. */
function sessaoTerminou(estado: unknown): boolean {
  if (typeof estado !== "object" || estado === null) return false;
  try {
    return (estado as { sessaoTerminou?: unknown }).sessaoTerminou === true;
  } catch {
    return false;
  }
}

export function Entrar(): ReactElement {
  const sessao = useSessaoOpcional();

  // O `history.state` desta entrada, lido uma vez: uma tentativa falhada tira a
  // mensagem mas não o destino.
  const [estadoDoHistorico] = useState<unknown>(() => window.history.state as unknown);

  const [utilizador, setUtilizador] = useState("");
  const [password, setPassword] = useState("");
  const [erroUtilizador, setErroUtilizador] = useState<string | undefined>(undefined);
  const [erroPassword, setErroPassword] = useState<string | undefined>(undefined);
  const [aEntrar, setAEntrar] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem | null>(() =>
    sessaoTerminou(estadoDoHistorico) ? { tipo: "sessao", texto: TEXTOS.sessaoTerminou } : null,
  );
  // O instante (ms) em que o 429 acaba; `null` quando não há bloqueio com prazo.
  const [bloqueadoAte, setBloqueadoAte] = useState<number | null>(null);

  const campoUtilizador = useRef<HTMLInputElement>(null);
  const campoPassword = useRef<HTMLInputElement>(null);
  const divDaMensagem = useRef<HTMLDivElement>(null);
  const cancelamento = useRef<AbortController | null>(null);

  // Já com sessão: o formulário aparece de imediato e a pergunta corre em
  // segundo plano. 200 segue para a gestão; 401 ou falha não mudam nada.
  //
  // Não se pergunta a quem acabou de ser mandado para aqui por um 401 («A sessão
  // terminou»): o servidor acabou de dizer que não há sessão, e perguntar outra
  // vez era um pedido a mais — e, com uma resposta atrasada de uma sessão que
  // entretanto se abriu noutro separador, um salto que ninguém pediu.
  useEffect(() => {
    if (sessaoTerminou(estadoDoHistorico)) return;
    const controlador = new AbortController();
    quemSouEu({ sinal: controlador.signal }).then(
      () => {
        if (controlador.signal.aborted) return;
        sessao?.aoConfirmarSessao();
        navegar(destinoDepoisDeEntrar(estadoDoHistorico), { substituir: true });
      },
      () => undefined,
    );
    return () => {
      controlador.abort();
    };
    // Corre uma vez, ao montar; o contexto não muda de identidade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O pedido em curso cancela-se ao desmontar.
  useEffect(() => {
    return () => {
      cancelamento.current?.abort();
    };
  }, []);

  // A mensagem recebe o foco sempre que há uma nova (o objeto é novo a cada
  // desfecho), para o leitor de ecrã a ler.
  useEffect(() => {
    if (mensagem !== null) divDaMensagem.current?.focus();
  }, [mensagem]);

  // Um único temporizador para o fim do bloqueio. Quando passa, o botão volta
  // e as duas linhas saem; o foco não se move.
  useEffect(() => {
    if (bloqueadoAte === null) return;
    const temporizador = setTimeout(
      () => {
        setBloqueadoAte(null);
        setMensagem(null);
      },
      Math.max(0, bloqueadoAte - Date.now()),
    );
    return () => {
      clearTimeout(temporizador);
    };
  }, [bloqueadoAte]);

  async function pedir(): Promise<void> {
    setMensagem(null);
    setBloqueadoAte(null);
    setAEntrar(true);

    const controlador = new AbortController();
    cancelamento.current = controlador;
    const desarmar = armarPrazo(controlador);

    try {
      await entrar({ utilizador, password }, { sinal: controlador.signal });
    } catch (erro) {
      desarmar();
      // Desmontou a meio: já não há ecrã onde mostrar nada.
      if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
      setAEntrar(false);

      if (
        erro instanceof ErroDaApi &&
        erro.estado === 400 &&
        erro.codigo === "credenciais_invalidas"
      ) {
        setMensagem({ tipo: "credenciais", texto: erro.message });
      } else if (
        erro instanceof ErroDaApi &&
        erro.estado === 429 &&
        erro.codigo === "conta_bloqueada"
      ) {
        const segundos = prazoDoBloqueio(erro);
        if (segundos === null) {
          // Não sei quanto falta, e isso não é «falta pouco»: só a frase do
          // backend, e o botão fica utilizável (não há prazo para o medir).
          setMensagem({ tipo: "bloqueada", texto: erro.message });
        } else {
          setMensagem({ tipo: "bloqueada", texto: erro.message, tempo: tempoComposto(segundos) });
          setBloqueadoAte(Date.now() + segundos * 1000);
        }
      } else if (erro instanceof ErroDaApi && erro.estado === null) {
        setMensagem({ tipo: "sem-resposta", texto: TEXTOS.semResposta });
      } else {
        // Qualquer 5xx, 403, 422… e o que não for um `ErroDaApi`: é nosso.
        setMensagem({ tipo: "servidor", texto: TEXTOS.servidor });
      }
      return;
    }

    desarmar();
    // 200: a sessão está confirmada; vai-se ao destino de onde se foi mandado
    // (validado à leitura) ou ao Início, a substituir a entrada do histórico
    // (o «Voltar» não regressa ao login).
    sessao?.aoConfirmarSessao();
    navegar(destinoDepoisDeEntrar(estadoDoHistorico), { substituir: true });
  }

  function aoSubmeter(evento: FormEvent<HTMLFormElement>): void {
    // Sempre: o `method="post"` é só a rede de segurança para o dia em que isto
    // falhar. A alternativa por omissão seria um GET com a password no endereço.
    evento.preventDefault();

    // Um pedido em curso, ou um bloqueio que ainda não passou (comparado com a
    // hora e não só com o temporizador, que o browser pode atrasar).
    if (aEntrar) return;
    if (bloqueadoAte !== null && Date.now() < bloqueadoAte) return;

    const faltaUtilizador = utilizador.trim() === "";
    // A password não se apara: um espaço pode fazer parte dela.
    const faltaPassword = password === "";
    if (faltaUtilizador || faltaPassword) {
      setErroUtilizador(faltaUtilizador ? TEXTOS.erroUtilizador : undefined);
      setErroPassword(faltaPassword ? TEXTOS.erroPassword : undefined);
      (faltaUtilizador ? campoUtilizador : campoPassword).current?.focus();
      return;
    }

    void pedir();
  }

  const bloqueado = bloqueadoAte !== null;
  const comMensagem = mensagem !== null;

  const caixaDaMensagem =
    mensagem === null ? null : (
      <div
        id={ID_DA_MENSAGEM}
        ref={divDaMensagem}
        tabIndex={-1}
        className={
          mensagem.tipo === "sessao"
            ? "flex flex-col gap-1 text-corpo text-texto"
            : "flex flex-col gap-1 text-corpo text-erro"
        }
      >
        <p>{mensagem.texto}</p>
        {mensagem.tempo !== undefined && <p className="text-texto">{mensagem.tempo}</p>}
      </div>
    );
  const avisoDaSessao = mensagem?.tipo === "sessao";

  return (
    <main className="mx-auto flex max-w-folha flex-col gap-4 px-4 pt-12">
      <p className="text-corpo text-texto-suave">{TEXTOS.nomeDoBar}</p>
      <h1 className="font-titulo text-titulo text-texto">{TEXTOS.titulo}</h1>

      {avisoDaSessao && caixaDaMensagem}

      <form method="post" noValidate onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-4">
            <Campo
              ref={campoUtilizador}
              etiqueta={TEXTOS.etiquetaUtilizador}
              nome="utilizador"
              autocompletar="username"
              autocapitalize="none"
              autocorrect="off"
              spellcheck={false}
              obrigatorio
              valor={utilizador}
              erro={erroUtilizador}
              invalido={mensagem?.tipo === "credenciais"}
              descritoPor={comMensagem ? ID_DA_MENSAGEM : undefined}
              aoMudar={(valor) => {
                setUtilizador(valor);
                setErroUtilizador(undefined);
              }}
            />
            <Campo
              ref={campoPassword}
              etiqueta={TEXTOS.etiquetaPassword}
              tipo="password"
              nome="password"
              autocompletar="current-password"
              obrigatorio
              valor={password}
              erro={erroPassword}
              invalido={mensagem?.tipo === "credenciais"}
              descritoPor={comMensagem ? ID_DA_MENSAGEM : undefined}
              aoMudar={(valor) => {
                setPassword(valor);
                setErroPassword(undefined);
              }}
            />
          </div>

          {!avisoDaSessao && caixaDaMensagem}
        </div>

        <Botao
          variante="principal"
          tipo="submit"
          larguraTotal
          desativado={aEntrar || bloqueado}
          aTrabalhar={aEntrar}
          textoATrabalhar={TEXTOS.aEntrar}
        >
          {TEXTOS.entrar}
        </Botao>
      </form>
    </main>
  );
}
