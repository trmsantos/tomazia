import type { ReactElement, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { AvisoTemporario } from "../../../components/ui/AvisoTemporario";
import { Botao } from "../../../components/ui/Botao";
import { EstadoVazio } from "../../../components/ui/EstadoVazio";
import { Folha } from "../../../components/ui/Folha";
import { ErroDaApi } from "../../../lib/api/cliente";
import {
  type DefinicoesGestao as DefinicoesDaApi,
  guardarDefinicoes,
  obterDefinicoes,
} from "../../../lib/api/gestao-definicoes";
import { executar as executarPedido } from "../ementa/pedidos";
import { CampoDaGestao } from "../ementa/CampoDaGestao";
import { definirGuardaDeSaida, eCliqueSimples, navegarComGuarda } from "../navegacao";
import { armarPrazo } from "../prazo";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { EditorDoHorario, idDaHora, idDoDia } from "./EditorDoHorario";
import {
  type CampoDeTexto,
  type FormularioDeDefinicoes,
  completarTextos,
  corpoDoPut,
  formularioDaApi,
  haAlteracoes,
} from "./formulario";
import {
  type DiaNoFormulario,
  type ErrosDoHorario,
  type HorarioNoFormulario,
  comecarHorario,
  horarioSemErros,
  validarHorario,
} from "./horario-do-formulario";
import { ERRO_422_POR_CAMPO, TEXTOS } from "./textos";
import { validarLink, validarTexto } from "./validar-campos";

/**
 * «Mais › Definições» (F4-05a, `docs/ecras/F4-05a.md`): o WiFi, o horário, a morada
 * e os contactos, guardados de uma vez.
 *
 * **O `PUT` substitui os sete campos**, por isso o formulário **só existe depois de
 * um `GET` 200** e nasce dele (`FormularioDasDefinicoes`). «Não consegui carregar»
 * nunca se desenha como «está tudo vazio»: um formulário vazio, guardado, apagava
 * o WiFi, a morada e o horário (regra 10). O vazio de uma instalação nova é um `200`
 * com tudo `""`, e esse **é** o formulário.
 *
 * O estado muda pela **resposta** do servidor. Um `PUT` sem resposta é «não sei se
 * gravou»: o formulário fica como está, diz-se isso, e um `GET` por baixo confirma
 * (o `PUT` é absoluto: repetir é seguro). Um 401 em qualquer pedido leva ao login
 * (`aoPerderSessao`) e o rascunho perde-se — nunca se guarda a password do WiFi no
 * browser.
 */
type Fase =
  | { estado: "a-carregar" }
  | { estado: "pronta" }
  | { estado: "erro"; semResposta: boolean; aTentar: boolean };

const CAMADA =
  "superficie-painel flex flex-col gap-4 rounded-cartao border border-contorno-superficie p-4";
const SEM_ERROS: ErrosDoHorario = { porDia: {}, porPeriodo: {} };
const TECLADO_DO_TELEFONE = { inputMode: "tel" } as const;
const ID_DO_ERRO_DO_HORARIO = "erro-do-horario";
// Os botões do horário não têm `id`: o foco pede-os por estas chaves.
const FOCO_DESFAZER = "desfazer-o-horario";
const FOCO_ESCREVER = "escrever-o-horario";
const FOCO_REMOVER = "remover-o-horario";

const IDS_DOS_CAMPOS: Record<CampoDeTexto, string> = {
  wifi_rede: "campo-rede",
  wifi_password: "campo-password",
  morada: "campo-morada",
  telefone: "campo-telefone",
  instagram: "campo-instagram",
  maps_url: "campo-maps",
};

type ErrosDeTexto = Partial<Record<CampoDeTexto, string>>;

function eCampoDeTexto(campo: string | null): campo is CampoDeTexto {
  return campo !== null && Object.prototype.hasOwnProperty.call(IDS_DOS_CAMPOS, campo);
}

/** Uma instalação nova: tudo `""` e sem horário. */
function eInstalacaoNova(d: DefinicoesDaApi): boolean {
  return (
    d.horario_estado === "nao_configurado" &&
    d.wifi_rede === "" &&
    d.wifi_password === "" &&
    d.morada === "" &&
    d.telefone === "" &&
    d.instagram === "" &&
    d.maps_url === ""
  );
}

function temEspacoNasPontas(valor: string): boolean {
  return valor !== valor.trim();
}

function Titulo(): ReactElement {
  return (
    <h1 tabIndex={-1} className="pb-3 pt-8 font-titulo text-titulo text-texto">
      {TEXTOS.titulo}
    </h1>
  );
}

function VoltarAMais(): ReactElement {
  return (
    <a
      href="/gestao/mais"
      onClick={(evento) => {
        if (!eCliqueSimples(evento)) return;
        evento.preventDefault();
        navegarComGuarda("/gestao/mais");
      }}
      className="inline-flex min-h-toque items-center self-start text-nota text-texto underline"
    >
      {TEXTOS.voltarAMais}
    </a>
  );
}

function Esqueleto(): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      {[2, 7, 4].map((barras) => (
        <div key={barras} aria-busy="true" className={CAMADA}>
          {Array.from({ length: barras }, (_, n) => (
            <div
              key={n}
              className={`h-4 rounded-pequeno bg-fio-interno ${n % 2 === 0 ? "w-3/4" : "w-1/2"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DefinicoesGestao(): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const [fase, setFase] = useState<Fase>({ estado: "a-carregar" });
  const [definicoes, setDefinicoes] = useState<DefinicoesDaApi | null>(null);
  const leitura = useRef<AbortController | null>(null);

  const carregar = useCallback((): void => {
    leitura.current?.abort();
    const controlador = new AbortController();
    leitura.current = controlador;
    const desarmar = armarPrazo(controlador);

    obterDefinicoes({ sinal: controlador.signal })
      .then((resposta) => {
        if (controlador.signal.aborted) return;
        setDefinicoes(resposta);
        setFase({ estado: "pronta" });
      })
      .catch((erro: unknown) => {
        // Desmontou, ou uma leitura mais nova ocupou o lugar: não é uma resposta.
        if (controlador.signal.aborted && !(erro instanceof ErroDaApi)) return;
        if (erro instanceof ErroDaApi && erro.estado === 401) {
          aoPerderSessao();
          return;
        }
        // Tudo o que não for «sem resposta» é do servidor — o nosso código a
        // rebentar e um corpo que não se sabe ler incluídos: nunca «a carregar»
        // para sempre, nunca um formulário.
        setFase({
          estado: "erro",
          semResposta: erro instanceof ErroDaApi && erro.estado === null,
          aTentar: false,
        });
      })
      .finally(desarmar);
  }, [aoPerderSessao]);

  useEffect(() => {
    // Um `queueMicrotask` e não a chamada direta: no desenvolvimento o `StrictMode`
    // monta, desmonta e volta a montar de seguida, e o primeiro pedido seria
    // deitado fora. O cancelamento chega antes da microtarefa, por isso parte um só.
    let ativo = true;
    queueMicrotask(() => {
      if (ativo) carregar();
    });
    return () => {
      ativo = false;
      leitura.current?.abort();
    };
  }, [carregar]);

  let corpo: ReactElement;
  if (fase.estado === "a-carregar") {
    corpo = <Esqueleto />;
  } else if (fase.estado === "erro") {
    corpo = (
      <EstadoVazio
        tom="erro"
        titulo={TEXTOS.carregarTitulo}
        linha={fase.semResposta ? TEXTOS.carregarSemResposta : TEXTOS.carregarServidor}
      >
        <Botao
          aTrabalhar={fase.aTentar}
          textoATrabalhar={TEXTOS.aTentar}
          onClick={() => {
            setFase({ ...fase, aTentar: true });
            carregar();
          }}
        >
          {TEXTOS.tentarOutraVez}
        </Botao>
      </EstadoVazio>
    );
  } else if (definicoes !== null) {
    corpo = <FormularioDasDefinicoes inicial={definicoes} />;
  } else {
    corpo = <Esqueleto />;
  }

  return (
    <>
      <Titulo />
      <div className="flex flex-col gap-4">
        <VoltarAMais />
        {corpo}
      </div>
    </>
  );
}

function Painel({
  titulo,
  ondeAparece,
  children,
}: {
  titulo: string;
  ondeAparece: string;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className={CAMADA}>
      <h2 id={id} className="text-seccao font-forte text-texto">
        {titulo}
      </h2>
      <p className="text-nota text-texto-suave">{ondeAparece}</p>
      {children}
    </section>
  );
}

/** O primeiro campo com erro, pela ordem do ecrã (rede, password, horário, morada, …). */
function primeiroIdComErro(
  textos: ErrosDeTexto,
  horario: ErrosDoHorario,
  formulario: HorarioNoFormulario,
): string | null {
  const doTexto = (campos: CampoDeTexto[]): string | null => {
    const campo = campos.find((c) => textos[c] !== undefined);
    return campo !== undefined ? IDS_DOS_CAMPOS[campo] : null;
  };
  const noWifi = doTexto(["wifi_rede", "wifi_password"]);
  if (noWifi !== null) return noWifi;

  if (formulario.modo === "editar") {
    for (const d of formulario.dias) {
      for (const p of d.periodos) {
        const erro = horario.porPeriodo[p.chave];
        if (erro?.abre !== undefined) return idDaHora(p.chave, "abre");
        if (erro?.fecha !== undefined) return idDaHora(p.chave, "fecha");
      }
      if (horario.porDia[d.dia] !== undefined) return idDoDia(d.dia);
    }
  }
  return doTexto(["morada", "telefone", "instagram", "maps_url"]);
}

function FormularioDasDefinicoes({ inicial }: { inicial: DefinicoesDaApi }): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();

  // `base` é a última resposta confirmada (o `GET` ou o `PUT` 200).
  const [base, setBase] = useState(inicial);
  const [formulario, setFormulario] = useState(() => formularioDaApi(inicial));
  const [primeiraVez, setPrimeiraVez] = useState(() => eInstalacaoNova(inicial));
  const [errosDeTexto, setErrosDeTexto] = useState<ErrosDeTexto>({});
  const [errosDoHorario, setErrosDoHorario] = useState<ErrosDoHorario>(SEM_ERROS);
  const [recusouOHorario, setRecusouOHorario] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [horarioRemovido, setHorarioRemovido] = useState<HorarioNoFormulario | null>(null);
  const [saida, setSaida] = useState<{ seguir: () => void } | null>(null);
  const [foco, setFoco] = useState<{ id: string } | null>(null);

  const idDaLinha = useId();
  const botaoDeGuardar = useRef<HTMLButtonElement>(null);
  const botaoDeContinuar = useRef<HTMLButtonElement>(null);
  const botaoDeDesfazer = useRef<HTMLButtonElement>(null);
  const botaoDeEscrever = useRef<HTMLButtonElement>(null);
  const botaoDeRemover = useRef<HTMLButtonElement>(null);
  const aGuardarAgora = useRef(false);
  const montado = useRef(false);
  const geracao = useRef(0);
  const verificacao = useRef<AbortController | null>(null);
  const formularioAgora = useRef(formulario);

  useEffect(() => {
    formularioAgora.current = formulario;
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      verificacao.current?.abort();
    };
  }, []);

  const ha = haAlteracoes(formulario, base);
  const comErros =
    Object.keys(errosDeTexto).length > 0 || !horarioSemErros(errosDoHorario) || recusouOHorario;

  // --- O foco ---------------------------------------------------------------

  // O nó que recebe o foco só existe depois do render: pede-se por um `id` (ou por
  // uma das três chaves dos botões do horário) e cumpre-se aqui.
  useEffect(() => {
    if (foco === null) return;
    const botoes: Record<string, HTMLElement | null> = {
      [FOCO_DESFAZER]: botaoDeDesfazer.current,
      [FOCO_ESCREVER]: botaoDeEscrever.current,
      [FOCO_REMOVER]: botaoDeRemover.current,
    };
    (botoes[foco.id] ?? document.getElementById(foco.id))?.focus();
  }, [foco]);

  // --- Sair com alterações por guardar (D3) -----------------------------------

  useEffect(() => {
    if (!ha) return;
    definirGuardaDeSaida((seguir) => {
      setSaida({ seguir });
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

  const temSaida = saida !== null;
  useEffect(() => {
    // Depois de a `Folha` abrir (o `showModal` dela corre antes): a ação segura.
    if (temSaida) botaoDeContinuar.current?.focus();
  }, [temSaida]);

  // --- Editar ---------------------------------------------------------------

  function mudarTexto(campo: CampoDeTexto, valor: string): void {
    setFormulario((f) => ({ ...f, [campo]: valor }));
    setPrimeiraVez(false);
    setErrosDeTexto((erros) =>
      erros[campo] === undefined
        ? erros
        : (Object.fromEntries(Object.entries(erros).filter(([k]) => k !== campo)) as ErrosDeTexto),
    );
  }

  function mudarHorario(dias: DiaNoFormulario[]): void {
    const antes = formulario.horario.modo === "editar" ? formulario.horario.dias : [];
    const mudados = dias.filter((d, i) => d !== antes[i]);
    const chaves = new Set(
      [...mudados, ...antes.filter((d, i) => d !== dias[i])].flatMap((d) =>
        d.periodos.map((p) => p.chave),
      ),
    );
    const nomes = new Set(mudados.map((d) => d.dia));
    setErrosDoHorario((e) => ({
      porDia: Object.fromEntries(
        Object.entries(e.porDia).filter(([dia]) => !nomes.has(dia as never)),
      ),
      porPeriodo: Object.fromEntries(Object.entries(e.porPeriodo).filter(([c]) => !chaves.has(c))),
    }));
    setRecusouOHorario(false);
    setHorarioRemovido(null);
    setPrimeiraVez(false);
    setFormulario((f) => ({ ...f, horario: { modo: "editar", dias } }));
  }

  function comecarAEscrever(): void {
    setFormulario((f) => ({ ...f, horario: comecarHorario() }));
    setHorarioRemovido(null);
    setPrimeiraVez(false);
    setFoco({ id: idDoDia("segunda") });
  }

  function removerOHorario(): void {
    const antes = formulario.horario;
    setFormulario((f) => ({ ...f, horario: { modo: "sem_horario" } }));
    setErrosDoHorario(SEM_ERROS);
    setRecusouOHorario(false);
    setPrimeiraVez(false);
    // Só há «Desfazer» quando o que se remove é o horário que o site mostra.
    if (base.horario_estado === "configurado") {
      setHorarioRemovido(antes);
      setFoco({ id: FOCO_DESFAZER });
    } else {
      setHorarioRemovido(null);
      setFoco({ id: FOCO_ESCREVER });
    }
  }

  function desfazerARemocao(): void {
    if (horarioRemovido === null) return;
    setFormulario((f) => ({ ...f, horario: horarioRemovido }));
    setHorarioRemovido(null);
    setFoco({ id: FOCO_REMOVER });
  }

  // --- Guardar --------------------------------------------------------------

  /** Depois de um `PUT` sem resposta: o que o servidor tem diz se gravou. */
  async function verificar(minhaGeracao: number): Promise<void> {
    verificacao.current?.abort();
    const controlador = new AbortController();
    verificacao.current = controlador;
    const desarmar = armarPrazo(controlador);
    try {
      const resposta = await obterDefinicoes({ sinal: controlador.signal });
      if (controlador.signal.aborted || geracao.current !== minhaGeracao) return;
      if (aGuardarAgora.current) return;
      setBase(resposta);
      if (!haAlteracoes(formularioAgora.current, resposta)) {
        // Gravou: o que o formulário tem é o que o servidor tem.
        setFormulario(formularioDaApi(resposta));
        setHorarioRemovido(null);
        setFalha(null);
        setAviso(TEXTOS.sucesso);
      }
    } catch (erro) {
      if (erro instanceof ErroDaApi && erro.estado === 401 && !controlador.signal.aborted) {
        aoPerderSessao();
      }
      // Qualquer outra falha: nada muda — continua «não sei».
    } finally {
      desarmar();
    }
  }

  async function guardar(): Promise<void> {
    if (aGuardarAgora.current || !ha) return;
    setFalha(null);
    setAviso(null);

    // O que se vê passa a ser o que vai: links completados, morada e telefone aparados.
    const completo: FormularioDeDefinicoes = completarTextos(formulario);
    setFormulario(completo);

    const erros: ErrosDeTexto = {};
    for (const campo of ["wifi_rede", "wifi_password", "morada", "telefone"] as const) {
      const erro = validarTexto(completo[campo]);
      if (erro !== undefined) erros[campo] = erro;
    }
    for (const campo of ["instagram", "maps_url"] as const) {
      const erro = validarLink(completo[campo], campo);
      if (erro !== undefined) erros[campo] = erro;
    }
    const errosH = validarHorario(completo.horario);
    setRecusouOHorario(false);
    setErrosDeTexto(erros);
    setErrosDoHorario(errosH);
    const primeiro = primeiroIdComErro(erros, errosH, completo.horario);
    if (primeiro !== null) {
      setFoco({ id: primeiro });
      return;
    }

    const corpo = corpoDoPut(completo);
    aGuardarAgora.current = true;
    geracao.current += 1;
    const minhaGeracao = geracao.current;
    setAGuardar(true);

    const r = await executarPedido(async (opcoes) => {
      try {
        return await guardarDefinicoes(corpo, opcoes);
      } catch (erro) {
        // Um 200 cujo corpo não se lê: o servidor pode ter gravado. É «não sei», como
        // não ter resposta (regra 10), e não «o problema é nosso».
        if (erro instanceof ErroDaApi && erro.estado !== null && erro.estado < 300) {
          throw new ErroDaApi(erro.message, { estado: null, codigo: null, causa: erro });
        }
        throw erro;
      }
    });
    aGuardarAgora.current = false;
    if (!montado.current) return;
    setAGuardar(false);

    if (r.ok) {
      setBase(r.valor);
      setFormulario(formularioDaApi(r.valor));
      setHorarioRemovido(null);
      setAviso(TEXTOS.sucesso);
      botaoDeGuardar.current?.focus();
      return;
    }

    const f = r.falha;
    if (f.tipo === "sessao") {
      aoPerderSessao();
      return;
    }
    if (f.tipo === "invalido" && eCampoDeTexto(f.campo)) {
      setErrosDeTexto({ [f.campo]: ERRO_422_POR_CAMPO[f.campo] });
      setFoco({ id: IDS_DOS_CAMPOS[f.campo] });
      return;
    }
    if (f.tipo === "invalido" && f.campo === "horario") {
      setRecusouOHorario(true);
      setFoco({ id: ID_DO_ERRO_DO_HORARIO });
      return;
    }

    if (f.tipo === "sem-resposta") setFalha(TEXTOS.guardarSemResposta);
    else if (f.tipo === "invalido") setFalha(TEXTOS.guardar422SemCampo);
    else setFalha(TEXTOS.guardarServidor);
    botaoDeGuardar.current?.focus();
    if (f.tipo === "sem-resposta") void verificar(minhaGeracao);
  }

  // --- Desenho --------------------------------------------------------------

  function campoDeTexto(
    campo: CampoDeTexto,
    etiqueta: string,
    extras: {
      inputMode?: "tel" | "url";
      autoCapitalize?: "none";
      spellCheck?: boolean;
      ajuda?: string;
    } = {},
  ): ReactElement {
    const erro = errosDeTexto[campo];
    return (
      <CampoDaGestao
        id={IDS_DOS_CAMPOS[campo]}
        etiqueta={etiqueta}
        valor={formulario[campo]}
        aoMudar={(valor) => {
          mudarTexto(campo, valor);
        }}
        parado={aGuardar}
        {...(erro !== undefined ? { erro } : {})}
        {...extras}
      />
    );
  }

  const horario = formulario.horario;
  const semRedeOuPassword =
    formulario.wifi_rede.trim() === "" || formulario.wifi_password.trim() === "";

  const campoRede = campoDeTexto("wifi_rede", TEXTOS.etiquetaRede, {
    autoCapitalize: "none",
    spellCheck: false,
    ...(temEspacoNasPontas(formulario.wifi_rede) ? { ajuda: TEXTOS.wifiEspacos } : {}),
  });
  const campoPassword = campoDeTexto("wifi_password", TEXTOS.etiquetaPassword, {
    autoCapitalize: "none",
    spellCheck: false,
    ...(temEspacoNasPontas(formulario.wifi_password) ? { ajuda: TEXTOS.wifiEspacos } : {}),
  });
  const campoMorada = campoDeTexto("morada", TEXTOS.etiquetaMorada);
  const campoTelefone = campoDeTexto("telefone", TEXTOS.etiquetaTelefone, TECLADO_DO_TELEFONE);
  const campoInstagram = campoDeTexto("instagram", TEXTOS.etiquetaInstagram, {
    inputMode: "url",
    autoCapitalize: "none",
    spellCheck: false,
    ajuda: TEXTOS.ajudaInstagram,
  });
  const campoMaps = campoDeTexto("maps_url", TEXTOS.etiquetaMaps, {
    inputMode: "url",
    autoCapitalize: "none",
    spellCheck: false,
    ajuda: TEXTOS.ajudaMaps,
  });
  const linhaDoWifi = semRedeOuPassword ? (
    <p className="text-nota text-texto-suave">{TEXTOS.wifiVazio}</p>
  ) : null;

  let painelDoHorario: ReactElement;
  if (horario.modo === "editar") {
    painelDoHorario = (
      <>
        <EditorDoHorario
          dias={horario.dias}
          erros={errosDoHorario}
          parado={aGuardar}
          aoMudar={mudarHorario}
        />
        <div>
          <Botao ref={botaoDeRemover} desativado={aGuardar} onClick={removerOHorario}>
            {TEXTOS.removerOHorario}
          </Botao>
        </div>
      </>
    );
  } else if (base.horario_estado === "invalido") {
    painelDoHorario = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-corpo text-erro">{TEXTOS.horarioInvalido}</p>
        <p className="text-nota text-texto-suave">{TEXTOS.horarioInvalidoAviso}</p>
        <Botao ref={botaoDeEscrever} desativado={aGuardar} onClick={comecarAEscrever}>
          {TEXTOS.escreverHorarioNovo}
        </Botao>
      </div>
    );
  } else {
    painelDoHorario = (
      <div className="flex flex-col items-start gap-3">
        {horarioRemovido !== null && (
          <div role="status" className="flex flex-wrap items-center gap-2 text-nota text-texto">
            <p>{TEXTOS.horarioRemovido}</p>
            <Botao ref={botaoDeDesfazer} variante="discreto" onClick={desfazerARemocao}>
              {TEXTOS.desfazer}
            </Botao>
          </div>
        )}
        <p className="text-corpo text-texto">{TEXTOS.horarioNaoConfigurado}</p>
        <Botao ref={botaoDeEscrever} desativado={aGuardar} onClick={comecarAEscrever}>
          {TEXTOS.configurarHorario}
        </Botao>
      </div>
    );
  }

  const linhaDeErro = falha ?? (comErros ? TEXTOS.corrigeOsCampos : null);

  return (
    <>
      {primeiraVez && <p className="text-corpo text-texto">{TEXTOS.primeiraVez}</p>}

      <form
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          void guardar();
        }}
        className="flex flex-col gap-4"
      >
        <Painel titulo={TEXTOS.painelWifi} ondeAparece={TEXTOS.ondeApareceWifi}>
          {campoRede}
          {campoPassword}
          {linhaDoWifi}
        </Painel>

        <Painel titulo={TEXTOS.painelHorario} ondeAparece={TEXTOS.ondeApareceHorario}>
          {recusouOHorario && (
            <p id={ID_DO_ERRO_DO_HORARIO} tabIndex={-1} className="text-nota text-erro">
              {ERRO_422_POR_CAMPO.horario}
            </p>
          )}
          {painelDoHorario}
        </Painel>

        <Painel titulo={TEXTOS.painelContactos} ondeAparece={TEXTOS.ondeApareceContactos}>
          {campoMorada}
          {campoTelefone}
          {campoInstagram}
          {campoMaps}
        </Painel>

        <div className="sticky bottom-barra-gestao z-10 -mx-4 flex flex-col gap-2 border-t border-fio-interno bg-fundo px-4 py-3 lg:bottom-0 lg:-mx-8 lg:px-8">
          <p id={idDaLinha} role="status" className="flex flex-col gap-1 text-nota">
            {linhaDeErro !== null && <span className="text-erro">{linhaDeErro}</span>}
            {ha && <span className="text-texto">{TEXTOS.haAlteracoes}</span>}
          </p>
          <Botao
            ref={botaoDeGuardar}
            variante="principal"
            tipo="submit"
            larguraTotal
            desativado={!ha || aGuardar}
            aTrabalhar={aGuardar}
            textoATrabalhar={TEXTOS.aGuardar}
            descritoPor={idDaLinha}
          >
            {TEXTOS.guardar}
          </Botao>
        </div>
      </form>

      <Folha
        aberta={saida !== null}
        // Fechada, a Folha não leva texto: «Há alterações por guardar.» é também a
        // linha de estado da barra, e o mesmo texto duas vezes no DOM confunde.
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
                const pendente = saida;
                setSaida(null);
                // O rascunho descarta-se: a guarda sai antes de a navegação seguir.
                definirGuardaDeSaida(null);
                pendente.seguir();
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

      <div className="aviso-sobre-a-barra-da-gestao">
        <AvisoTemporario
          tipo="sucesso"
          {...(aviso !== null ? { mensagem: aviso } : {})}
          aoFechar={() => {
            setAviso(null);
          }}
        />
      </div>
    </>
  );
}
