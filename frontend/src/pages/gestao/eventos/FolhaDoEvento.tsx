import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import type { AlteracaoDeEvento, EventoGestao, NovoEvento } from "../../../lib/api/gestao-eventos";
import { partesEmLisboa } from "../../../lib/formato/data-do-evento";
import { CampoDaGestao } from "../ementa/CampoDaGestao";
import { CampoDeHora } from "../definicoes/CampoDeHora";
import { definirGuardaDeSaida } from "../navegacao";
import { CampoDeData } from "./CampoDeData";
import {
  type CampoDoFormulario,
  corpoDoPatch,
  corpoDoPost,
  type ErrosDoFormulario,
  type EstadoDoFormulario,
  formularioInicial,
  haAlteracoes,
  type Intencao,
  LIMITE_DA_DESCRICAO,
  pontosDeCodigo,
  validar,
} from "./formulario";
import { deCampo } from "./hora-de-lisboa";
import { PreVisualizacao } from "./PreVisualizacao";
import { TEXTOS } from "./textos";

/**
 * A folha de criar e de editar um evento (F4-03, `docs/ecras/F4-03.md`, 7): a mesma `Folha`
 * (`<dialog>` nativo) para as duas tarefas, como a do produto da F4-02.
 *
 *  - **Criar**: dois botões no fim, «Publicar» (principal) e «Guardar rascunho». Sem interruptor
 *    «Publicado»: quem cria escolhe ao carregar. Sem resposta **nunca reenvia** (duplicava o
 *    evento): quem grava recarrega a lista e a folha diz o que encontrou.
 *  - **Editar**: pré-preenchida com a hora **de Lisboa**; o `PATCH` leva só o que mudou; um
 *    rascunho tem os dois botões, um publicado só «Guardar alterações» (nunca despublica); o
 *    estado muda-se pelo interruptor da linha. O cartaz só se lê.
 *  - **Sair com alterações** (7.6): a guarda de saída da F4-05a, mais uma pergunta numa segunda
 *    folha empilhada para «Cancelar», `Esc` e a cortina.
 *
 * A validação é só ao guardar, com o foco no primeiro campo com erro. A `mensagem` do backend
 * nunca aparece: um 422 com `campo` vira a frase do campo.
 */
export type ModoDaFolha = { tipo: "criar" } | { tipo: "editar"; evento: EventoGestao };

export type ResultadoDaFolha =
  | { tipo: "fechou" }
  | {
      tipo: "erro";
      /** Erros junto de campos (um 422 com `campo`). */
      campos?: ErrosDoFormulario;
      primeiro?: CampoDoFormulario;
      /** A linha por cima dos botões, quando o erro não é de um campo. */
      texto?: string;
    };

/** Uma linha de erro que vem de fora da folha (a eliminação que falhou), com identidade própria. */
export type FalhaDeFora = { texto: string };

type SaidaPendente = { seguir: () => void; modo: ModoDaFolha };

const FUSO_DO_BAR = "Europe/Lisbon";
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

function dois(n: number): string {
  return String(n).padStart(2, "0");
}

export function FolhaDoEvento({
  modo,
  agora,
  falhaDeFora,
  aoFechar,
  aoCriar,
  aoEditar,
  aoPedirEliminar,
}: {
  /** `null` = fechada. */
  modo: ModoDaFolha | null;
  agora: Date;
  falhaDeFora: FalhaDeFora | null;
  aoFechar: () => void;
  aoCriar: (novo: NovoEvento) => Promise<ResultadoDaFolha>;
  aoEditar: (evento: EventoGestao, corpo: AlteracaoDeEvento) => Promise<ResultadoDaFolha>;
  aoPedirEliminar: (evento: EventoGestao) => void;
}): ReactElement {
  const [pendente, setSaida] = useState<SaidaPendente | null>(null);
  // A pergunta é desta abertura da folha: uma folha que fecha por fora (um 404, um sucesso)
  // leva-a consigo, e a abertura seguinte (um `modo` novo) nunca a herda.
  const saida = pendente !== null && pendente.modo === modo ? pendente : null;
  // O formulário regista aqui o seu «fechar com pergunta»: quem fecha a `Folha` (Esc, cortina,
  // a cruz) é de fora dele, mas quem sabe se há alterações é ele.
  const pedirFechar = useRef<(() => void) | null>(null);
  const botaoDeContinuar = useRef<HTMLButtonElement>(null);

  const temSaida = saida !== null;
  useEffect(() => {
    // Depois de a `Folha` abrir (o `showModal` dela corre antes): a ação segura.
    if (temSaida) botaoDeContinuar.current?.focus();
  }, [temSaida]);

  const titulo = modo?.tipo === "editar" ? TEXTOS.tituloEditar : TEXTOS.tituloCriar;

  return (
    <>
      <Folha
        aberta={modo !== null}
        titulo={titulo}
        aoFechar={() => {
          (pedirFechar.current ?? aoFechar)();
        }}
      >
        {modo !== null && (
          <Formulario
            // Cada abertura é um formulário novo: nada do que se escreveu antes volta.
            key={modo.tipo === "editar" ? `editar-${String(modo.evento.id)}` : "criar"}
            aberto={modo.tipo === "editar" ? modo.evento : null}
            agora={agora}
            falhaDeFora={falhaDeFora}
            aoFechar={aoFechar}
            aoCriar={aoCriar}
            aoEditar={aoEditar}
            aoPedirEliminar={aoPedirEliminar}
            aoPedirSaida={(seguir) => {
              setSaida({ seguir, modo });
            }}
            registarFechar={(fechar) => {
              pedirFechar.current = fechar;
            }}
          />
        )}
      </Folha>

      <Folha
        aberta={saida !== null}
        // Fechada, a Folha não leva texto no DOM.
        titulo={saida !== null ? TEXTOS.saidaTitulo : ""}
        aoFechar={() => {
          setSaida(null);
        }}
      >
        {saida !== null && (
          <>
            <p>{TEXTOS.saidaLinha}</p>
            <Botao
              variante="perigo"
              larguraTotal
              onClick={() => {
                const dela = saida;
                setSaida(null);
                // O que se escreveu descarta-se: a guarda sai antes de a navegação seguir.
                definirGuardaDeSaida(null);
                dela.seguir();
              }}
            >
              {TEXTOS.saidaSair}
            </Botao>
            <Botao
              ref={botaoDeContinuar}
              variante="principal"
              larguraTotal
              onClick={() => {
                setSaida(null);
              }}
            >
              {TEXTOS.saidaContinuar}
            </Botao>
          </>
        )}
      </Folha>
    </>
  );
}

/** O `<input>` está escrito a meio? (`value` vazio e `validity.badInput`). Lê-se do DOM ao guardar. */
function escritoAMeio(id: string): boolean {
  const campo = document.getElementById(id);
  return campo instanceof HTMLInputElement && campo.value === "" && campo.validity.badInput;
}

function Formulario({
  aberto,
  agora,
  falhaDeFora,
  aoFechar,
  aoCriar,
  aoEditar,
  aoPedirEliminar,
  aoPedirSaida,
  registarFechar,
}: {
  aberto: EventoGestao | null;
  agora: Date;
  falhaDeFora: FalhaDeFora | null;
  aoFechar: () => void;
  aoCriar: (novo: NovoEvento) => Promise<ResultadoDaFolha>;
  aoEditar: (evento: EventoGestao, corpo: AlteracaoDeEvento) => Promise<ResultadoDaFolha>;
  aoPedirEliminar: (evento: EventoGestao) => void;
  aoPedirSaida: (seguir: () => void) => void;
  registarFechar: (fechar: (() => void) | null) => void;
}): ReactElement {
  const base = useId();
  const ids: Record<CampoDoFormulario, string> = {
    titulo: `${base}-titulo`,
    descricao: `${base}-descricao`,
    data: `${base}-data`,
    hora: `${base}-hora`,
  };
  const idDaNotaDaData = `${base}-nota-da-data`;
  const idDaNotaDaHora = `${base}-nota-da-hora`;

  const [f, setF] = useState<EstadoDoFormulario>(() => formularioInicial(aberto));
  const [erros, setErros] = useState<ErrosDoFormulario>({});
  const [falha, setFalha] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [emCurso, setEmCurso] = useState<Intencao | null>(null);
  // Um objeto novo a cada pedido de foco: o mesmo campo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ campo: CampoDoFormulario | "geral" } | null>(null);
  const [falhaVista, setFalhaVista] = useState(falhaDeFora);
  const geral = useRef<HTMLDivElement>(null);

  // Uma falha que veio de fora (eliminar com 5xx) entra na linha de estado, uma vez.
  if (falhaDeFora !== falhaVista) {
    setFalhaVista(falhaDeFora);
    if (falhaDeFora !== null) {
      setFalha(falhaDeFora.texto);
      setFoco({ campo: "geral" });
    }
  }

  useEffect(() => {
    if (foco === null) return;
    if (foco.campo === "geral") geral.current?.focus();
    else document.getElementById(ids[foco.campo])?.focus();
    // `ids` deriva de `base`, que não muda; só o pedido de foco dispara isto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);

  const ha = haAlteracoes(f, aberto);

  // --- Sair com alterações por guardar --------------------------------------

  const aoFecharAgora = useRef(aoFechar);
  const aoPedirSaidaAgora = useRef(aoPedirSaida);
  const haAgora = useRef(ha);
  const aGuardarAgora = useRef(aGuardar);
  useEffect(() => {
    aoFecharAgora.current = aoFechar;
    aoPedirSaidaAgora.current = aoPedirSaida;
    haAgora.current = ha;
    aGuardarAgora.current = aGuardar;
  });

  /** «Cancelar», `Esc`, a cortina e a cruz: com alterações pergunta; a meio de um pedido, espera. */
  function fecharComPergunta(): void {
    // A folha não fecha antes da resposta de um pedido que já partiu.
    if (aGuardarAgora.current) return;
    if (haAgora.current) aoPedirSaidaAgora.current(aoFecharAgora.current);
    else aoFecharAgora.current();
  }

  useEffect(() => {
    registarFechar(fecharComPergunta);
    return () => {
      registarFechar(null);
    };
    // `fecharComPergunta` só lê referências e `registarFechar` é uma função nova a cada render do
    // pai: o registo faz-se uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ha) return;
    definirGuardaDeSaida((seguir) => {
      aoPedirSaidaAgora.current(seguir);
      return true;
    });
    const aoDescarregar = (evento: BeforeUnloadEvent): void => {
      evento.preventDefault();
    };
    window.addEventListener("beforeunload", aoDescarregar);
    return () => {
      window.removeEventListener("beforeunload", aoDescarregar);
      definirGuardaDeSaida(null);
    };
  }, [ha]);

  // --- Editar ---------------------------------------------------------------

  function limpar(campo: CampoDoFormulario): void {
    setErros((antes) => {
      if (antes[campo] === undefined) return antes;
      return Object.fromEntries(
        Object.entries(antes).filter(([chave]) => chave !== campo),
      ) as ErrosDoFormulario;
    });
  }

  function mudar(parcial: Partial<EstadoDoFormulario>, campo: CampoDoFormulario): void {
    setF((antes) => ({ ...antes, ...parcial }));
    limpar(campo);
  }

  // --- Guardar --------------------------------------------------------------

  async function guardar(intencao: Intencao): Promise<void> {
    if (aGuardar) return;
    // `value === ""` com `validity.badInput` não dispara `change` (de vazio para vazio): lê-se
    // do DOM aqui, para «escreveu metade» nunca se ler como «não escreveu» (regra 10).
    const lido: EstadoDoFormulario = {
      ...f,
      dataIncompleta: f.dataIncompleta || escritoAMeio(ids.data),
      horaIncompleta: f.horaIncompleta || escritoAMeio(ids.hora),
    };

    const v = validar(lido, aberto, intencao);
    if (!v.ok) {
      setF(lido);
      setErros(v.erros);
      setFalha(null);
      setFoco({ campo: v.primeiro });
      return;
    }

    let pedido: Promise<ResultadoDaFolha>;
    if (aberto !== null) {
      const corpo = corpoDoPatch(lido, aberto, intencao);
      // Nada mudou: fecha sem pedido e sem aviso.
      if (Object.keys(corpo).length === 0) {
        aoFechar();
        return;
      }
      pedido = aoEditar(aberto, corpo);
    } else {
      pedido = aoCriar(corpoDoPost(lido, intencao === "publicar" ? "publicar" : "rascunho"));
    }

    setErros({});
    setFalha(null);
    setEmCurso(intencao);
    setAGuardar(true);
    const resultado = await pedido;
    if (resultado.tipo === "fechou") return;

    setAGuardar(false);
    setEmCurso(null);
    if (resultado.campos !== undefined && resultado.primeiro !== undefined) {
      setErros(resultado.campos);
      setFoco({ campo: resultado.primeiro });
    } else {
      setFalha(resultado.texto ?? null);
      setFoco({ campo: "geral" });
    }
  }

  // --- O que se vê ----------------------------------------------------------

  const lerData = DATA.test(f.data);
  const publicado = aberto?.publicado === true;

  // Os avisos de data não bloqueiam: o relógio do telemóvel pode estar errado, e a verdade é a
  // parte onde a lista recarregada põe o evento.
  const hoje = partesEmLisboa(agora);
  const hojeEmTexto = `${String(hoje.ano).padStart(4, "0")}-${dois(hoje.mes)}-${dois(hoje.dia)}`;
  const daquiAUmAno = `${String(hoje.ano + 1).padStart(4, "0")}-${dois(hoje.mes)}-${dois(hoje.dia)}`;
  let notaDaData: string | null = null;
  if (lerData && f.data < hojeEmTexto) {
    notaDaData = publicado ? TEXTOS.dataPassada : TEXTOS.dataPassadaRascunho;
  } else if (lerData && f.data > daquiAUmAno) {
    notaDaData = TEXTOS.dataLonge;
  }

  const avisoDeFuso = Intl.DateTimeFormat().resolvedOptions().timeZone !== FUSO_DO_BAR;
  const horaDeMadrugada = HORA.test(f.hora) && f.hora < "06:00";

  const leitura = deCampo(`${f.data}T${f.hora}`, f.dataIncompleta || f.horaIncompleta);
  const inicioDoCartao = leitura.ok ? leitura.inicio : null;

  const caracteresEmFalta = LIMITE_DA_DESCRICAO - pontosDeCodigo(f.descricao);
  let contador: string | undefined;
  if (pontosDeCodigo(f.descricao) >= 900) {
    if (caracteresEmFalta > 1) contador = TEXTOS.contadorFaltam(caracteresEmFalta);
    else if (caracteresEmFalta === 1) contador = TEXTOS.contadorUm;
    else if (caracteresEmFalta === 0) contador = TEXTOS.contadorLimite;
  }

  const comErros = Object.keys(erros).length > 0;
  const linhaDeEstado = falha ?? (comErros ? TEXTOS.corrigeOsCampos : null);

  const campoDeTexto = (campo: "titulo" | "descricao", etiqueta: string): ReactElement => (
    <CampoDaGestao
      id={ids[campo]}
      etiqueta={etiqueta}
      valor={f[campo]}
      aoMudar={(valor) => {
        mudar({ [campo]: valor }, campo);
      }}
      parado={aGuardar}
      {...(erros[campo] !== undefined ? { erro: erros[campo] } : {})}
      {...(campo === "titulo"
        ? { enterKeyHint: "next" as const, autoCapitalize: "sentences" as const }
        : { multilinha: true, ...(contador !== undefined ? { ajuda: contador } : {}) })}
    />
  );

  /** «Publicar» e «Guardar alterações» são os principais; «Guardar rascunho» é o secundário. */
  function botaoDeGuardar(intencao: Intencao, texto: string): ReactElement {
    return (
      <Botao
        variante={intencao === "rascunho" ? "secundario" : "principal"}
        larguraTotal
        desativado={aGuardar}
        aTrabalhar={aGuardar && emCurso === intencao}
        textoATrabalhar={TEXTOS.aGuardar}
        onClick={() => {
          void guardar(intencao);
        }}
      >
        {texto}
      </Botao>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {campoDeTexto("titulo", TEXTOS.etiquetaTitulo)}
      {campoDeTexto("descricao", TEXTOS.etiquetaDescricao)}

      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 min-w-0">
          <CampoDeData
            id={ids.data}
            etiqueta={TEXTOS.etiquetaData}
            nome={TEXTOS.etiquetaData}
            valor={f.data}
            parado={aGuardar}
            aoMudar={(valor, incompleto) => {
              mudar({ data: valor, dataIncompleta: incompleto }, "data");
            }}
            {...(erros.data !== undefined ? { erro: erros.data } : {})}
            {...(notaDaData !== null ? { idDaNota: idDaNotaDaData } : {})}
          />
        </div>
        <div className="col-span-2 min-w-0">
          <CampoDeHora
            id={ids.hora}
            etiqueta={TEXTOS.etiquetaHora}
            nome={TEXTOS.etiquetaHora}
            valor={f.hora}
            parado={aGuardar}
            aoMudar={(valor, incompleto) => {
              mudar({ hora: valor, horaIncompleta: incompleto }, "hora");
            }}
            {...(erros.hora !== undefined ? { erro: erros.hora } : {})}
            {...(horaDeMadrugada ? { idDaNota: idDaNotaDaHora } : {})}
          />
        </div>
      </div>

      {avisoDeFuso && <p className="text-nota text-texto-suave">{TEXTOS.avisoDeFuso}</p>}
      {horaDeMadrugada && (
        <p id={idDaNotaDaHora} className="text-nota text-texto-suave">
          {TEXTOS.ajudaMeiaNoite}
        </p>
      )}
      {notaDaData !== null && (
        <p id={idDaNotaDaData} className="text-nota text-texto">
          {notaDaData}
        </p>
      )}

      <PreVisualizacao
        titulo={f.titulo}
        descricao={f.descricao}
        inicio={inicioDoCartao}
        agora={agora}
        publicado={publicado}
        temCartaz={aberto !== null && aberto.imagem !== null && aberto.imagem !== ""}
      />

      {aberto !== null && (
        <p className="text-nota text-texto-suave">
          {publicado ? TEXTOS.estadoPublicado : TEXTOS.estadoRascunho}
        </p>
      )}

      {linhaDeEstado !== null && (
        <div ref={geral} tabIndex={-1}>
          <p role="status" className="text-corpo text-erro">
            {linhaDeEstado}
          </p>
        </div>
      )}

      {publicado ? (
        botaoDeGuardar("guardar", TEXTOS.guardarAlteracoes)
      ) : (
        <>
          {botaoDeGuardar("publicar", TEXTOS.publicar)}
          {botaoDeGuardar("rascunho", TEXTOS.guardarRascunho)}
        </>
      )}
      <Botao larguraTotal desativado={aGuardar} onClick={fecharComPergunta}>
        {TEXTOS.cancelar}
      </Botao>

      {aberto !== null && (
        <div className="flex flex-col gap-4 border-t border-fio-interno pt-6">
          <Botao
            variante="perigo"
            larguraTotal
            desativado={aGuardar}
            onClick={() => {
              aoPedirEliminar(aberto);
            }}
          >
            {TEXTOS.eliminarEvento}
          </Botao>
        </div>
      )}
    </div>
  );
}
