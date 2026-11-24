import type { ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import { ErroDaApi } from "../../../lib/api/cliente";
import { enviarFoto } from "../../../lib/api/publico";
import { reduzir } from "../../../lib/imagens/reduzir";
import { CampoDaGestao } from "../ementa/CampoDaGestao";
import { definirGuardaDeSaida } from "../navegacao";
import { useSessaoDaGestao } from "../SessaoDaGestao";
import { DESTINO_POR_CODIGO, TEXTOS } from "./textos";

/**
 * A folha «Enviar foto» do dono (F4-04, D1 (a) e spec 7): usa o `POST /fotos` **público** (com a
 * sessão válida salta o limite) e a foto entra pendente, no fim da fila. O `202` não traz `id`,
 * por isso o ecrã não sabe qual é e não tenta adivinhar.
 *
 * Reaproveita o desenho da F3-05 (a mesma `reduzir()`, os mesmos erros) **sem** «O teu nome» e
 * **sem** o campo-isco `website`: o `FormData` leva só `ficheiro` e, se escrita, `descricao`.
 *
 * A pré-visualização é um `data:` URL do ficheiro **já reduzido**, nunca `blob:`: a CSP de
 * produção é `img-src 'self' data:` (ADR 0008) e o jsdom não a aplica, por isso só um e2e a apanha.
 *
 * **Sem resposta o ecrã não reenvia** (um segundo envio criava duas fotos): dá o resultado ao pai,
 * que recarrega a fila e diz que não sabe. Uma redução que falha é recusa no telemóvel, sem pedido.
 *
 * Com foto escolhida ou legenda escrita há alterações por perder: regista a guarda de saída
 * (`definirGuardaDeSaida`) e o `beforeunload`, e fechar a folha pergunta, por cima, «Ainda não
 * enviaste a foto.» (padrão da F4-03 7.6).
 */
export type ResultadoDoEnvio = "enviada" | "sem-resposta";

type Reducao = "nenhuma" | "a-preparar" | "pronta" | "falhou";
type AlvoDeFoco = "foto" | "legenda" | "geral";
type SaidaPendente = { seguir: () => void };

/** Um envio por dados móveis: não os 10 s das leituras (F3-05 6.6). */
const PRAZO_DO_ENVIO_MS = 30_000;
/** Passado este tempo a prepará-la, avisa-se que fotos grandes demoram (F3-05 7.2). */
const AVISO_DE_DEMORA_MS = 1_000;

export function FolhaEnviarFotoDoDono({
  aberta,
  aoFechar,
  aoTerminar,
}: {
  aberta: boolean;
  aoFechar: () => void;
  /** O envio acabou: a folha é do pai, que a fecha, recarrega a fila e diz o que se sabe. */
  aoTerminar: (resultado: ResultadoDoEnvio) => void;
}): ReactElement {
  const [pendente, setSaida] = useState<SaidaPendente | null>(null);
  // O formulário regista aqui o seu «fechar com pergunta»: quem fecha a `Folha` (Esc, cortina,
  // a cruz) é de fora dele, mas quem sabe se há alterações é ele.
  const pedirFechar = useRef<(() => void) | null>(null);
  const botaoDeContinuar = useRef<HTMLButtonElement>(null);

  // A pergunta é desta abertura da folha: uma folha que fecha por fora leva-a consigo.
  const saida = aberta ? pendente : null;
  const temSaida = saida !== null;
  useEffect(() => {
    // Depois de a `Folha` abrir (o `showModal` dela corre antes): a ação segura.
    if (temSaida) botaoDeContinuar.current?.focus();
  }, [temSaida]);

  return (
    <>
      <Folha
        aberta={aberta}
        // Fechada, a Folha não leva texto no DOM.
        titulo={aberta ? TEXTOS.tituloEnviar : ""}
        aoFechar={() => {
          (pedirFechar.current ?? aoFechar)();
        }}
      >
        {/* Só existe com a folha aberta: fechar repõe tudo, sem um reset campo a campo. */}
        {aberta && (
          <Formulario
            aoFechar={aoFechar}
            aoTerminar={aoTerminar}
            aoPedirSaida={(seguir) => {
              setSaida({ seguir });
            }}
            registarFechar={(fechar) => {
              pedirFechar.current = fechar;
            }}
          />
        )}
      </Folha>

      <Folha
        aberta={saida !== null}
        titulo={saida !== null ? TEXTOS.saidaTitulo : ""}
        aoFechar={() => {
          setSaida(null);
        }}
      >
        {saida !== null && (
          <>
            <p className="text-corpo text-texto">{TEXTOS.saidaLinha}</p>
            <Botao
              variante="perigo"
              larguraTotal
              onClick={() => {
                const dela = saida;
                setSaida(null);
                // O que se escolheu descarta-se: a guarda sai antes de a navegação seguir.
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

function Formulario({
  aoFechar,
  aoTerminar,
  aoPedirSaida,
  registarFechar,
}: {
  aoFechar: () => void;
  aoTerminar: (resultado: ResultadoDoEnvio) => void;
  aoPedirSaida: (seguir: () => void) => void;
  registarFechar: (fechar: (() => void) | null) => void;
}): ReactElement {
  const { aoPerderSessao } = useSessaoDaGestao();
  const base = useId();
  const idDaFoto = `${base}-foto`;
  const idDoErroDaFoto = `${idDaFoto}-erro`;

  const [nomeDoFicheiro, setNomeDoFicheiro] = useState("foto.jpg");
  const [reducao, setReducao] = useState<Reducao>("nenhuma");
  const [reduzida, setReduzida] = useState<Blob | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [demora, setDemora] = useState(false);
  const [legenda, setLegenda] = useState("");
  const [erroDaFoto, setErroDaFoto] = useState<string | null>(null);
  const [erroDaLegenda, setErroDaLegenda] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  // Um objeto novo a cada pedido de foco: o mesmo alvo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ alvo: AlvoDeFoco } | null>(null);

  const campoDaFoto = useRef<HTMLInputElement>(null);
  const campoDaLegenda = useRef<HTMLInputElement>(null);
  const botaoDeEnviar = useRef<HTMLButtonElement>(null);
  /** Cada escolha de ficheiro invalida a anterior: um resultado tardio nunca a sobrepõe. */
  const operacao = useRef(0);
  const vivo = useRef(true);
  const aEnviarAgora = useRef(false);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  // O foco só se move depois de o React ter assentado o estado, nunca dentro de uma promessa.
  useEffect(() => {
    if (foco === null) return;
    if (foco.alvo === "foto") campoDaFoto.current?.focus();
    else if (foco.alvo === "legenda") campoDaLegenda.current?.focus();
    else botaoDeEnviar.current?.focus();
  }, [foco]);

  useEffect(() => {
    if (reducao !== "a-preparar") return;
    const temporizador = setTimeout(() => {
      setDemora(true);
    }, AVISO_DE_DEMORA_MS);
    return () => {
      clearTimeout(temporizador);
    };
  }, [reducao]);

  // --- Sair com alterações por perder ---------------------------------------

  const ha = reducao === "a-preparar" || reducao === "pronta" || legenda !== "";

  const aoFecharAgora = useRef(aoFechar);
  const aoPedirSaidaAgora = useRef(aoPedirSaida);
  const haAgora = useRef(ha);
  useEffect(() => {
    aoFecharAgora.current = aoFechar;
    aoPedirSaidaAgora.current = aoPedirSaida;
    haAgora.current = ha;
  });

  /** «Cancelar», `Esc`, a cortina e a cruz: com alterações pergunta; a meio do envio, espera. */
  function fecharComPergunta(): void {
    if (aEnviarAgora.current) return;
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

  // --- Escolher a foto: reduzir e pré-visualizar -----------------------------

  function limparErros(): void {
    setErroDaFoto(null);
    setErroDaLegenda(null);
    setErroGeral(null);
  }

  function pedirFoco(alvo: AlvoDeFoco): void {
    setFoco({ alvo });
  }

  /** O `data:` URL do ficheiro já reduzido (a CSP de produção bloqueia `blob:`). */
  function lerPrevia(ficheiro: Blob, minhaOperacao: number): void {
    const leitor = new FileReader();
    leitor.onload = () => {
      if (operacao.current !== minhaOperacao || typeof leitor.result !== "string") return;
      setPrevia(leitor.result);
    };
    // Sem prévia a foto envia-se na mesma: o que não se mostra é só a miniatura.
    leitor.readAsDataURL(ficheiro);
  }

  function aoFalharAPreparar(): void {
    setReducao("falhou");
    setReduzida(null);
    setPrevia(null);
    // O seletor nativo continua a dizer o nome do ficheiro recusado: repõe-se.
    if (campoDaFoto.current !== null) campoDaFoto.current.value = "";
    setErroDaFoto(TEXTOS.falhaAPreparar);
    pedirFoco("foto");
  }

  function escolher(ficheiro: File): void {
    operacao.current += 1;
    const minhaOperacao = operacao.current;
    limparErros();
    setNomeDoFicheiro(ficheiro.name);
    setReduzida(null);
    setPrevia(null);
    setDemora(false);
    setReducao("a-preparar");

    reduzir(ficheiro)
      .then((resultado) => {
        if (operacao.current !== minhaOperacao) return;
        if (resultado.estado === "reduzida" || resultado.estado === "sem-mudanca") {
          setReduzida(resultado.ficheiro);
          setReducao("pronta");
          lerPrevia(resultado.ficheiro, minhaOperacao);
          return;
        }
        // Uma foto que o browser não consegue preparar é recusada aqui, sem gastar um pedido.
        aoFalharAPreparar();
      })
      .catch(() => {
        // `reduzir()` nunca lança: este ramo só impede uma promessa rejeitada sem dono.
        if (operacao.current !== minhaOperacao) return;
        aoFalharAPreparar();
      });
  }

  // --- Enviar ----------------------------------------------------------------

  function mostrarErroDoBackend(erro: ErroDaApi): void {
    const destino = erro.codigo === null ? undefined : DESTINO_POR_CODIGO[erro.codigo];
    if (destino === "foto") {
      setErroDaFoto(erro.message);
      pedirFoco("foto");
    } else if (destino === "legenda") {
      setErroDaLegenda(erro.message);
      pedirFoco("legenda");
    } else if (destino === "geral") {
      setErroGeral(erro.message);
      pedirFoco("geral");
    } else {
      // Um código que não conhecemos ou um 5xx: nunca a mensagem do backend.
      setErroGeral(TEXTOS.envioServidor);
      pedirFoco("geral");
    }
  }

  async function enviar(): Promise<void> {
    if (aEnviarAgora.current) return;
    if (reducao === "nenhuma") {
      setErroDaFoto(TEXTOS.semEscolha);
      pedirFoco("foto");
      return;
    }
    if (reducao !== "pronta" || reduzida === null) return;

    limparErros();
    aEnviarAgora.current = true;
    setAEnviar(true);

    const corpo = new FormData();
    corpo.append("ficheiro", reduzida, nomeDoFicheiro);
    if (legenda.trim() !== "") corpo.append("descricao", legenda.trim());

    const controlador = new AbortController();
    const temporizador = setTimeout(() => {
      controlador.abort(new DOMException("O envio demorou demasiado.", "TimeoutError"));
    }, PRAZO_DO_ENVIO_MS);

    try {
      await enviarFoto(corpo, { sinal: controlador.signal });
    } catch (erro) {
      clearTimeout(temporizador);
      aEnviarAgora.current = false;
      // Sair da página a meio não é uma falha, e já não há ecrã onde a mostrar.
      if (!vivo.current) return;
      setAEnviar(false);
      if (erro instanceof ErroDaApi && erro.estado === 401) {
        aoPerderSessao();
        return;
      }
      if (erro instanceof ErroDaApi && erro.estado === null) {
        // Não se sabe se a foto chegou: nunca se reenvia (criava duas fotos).
        aoTerminar("sem-resposta");
        return;
      }
      if (erro instanceof ErroDaApi) {
        mostrarErroDoBackend(erro);
        return;
      }
      setErroGeral(TEXTOS.envioServidor);
      pedirFoco("geral");
      return;
    }
    clearTimeout(temporizador);
    aEnviarAgora.current = false;
    if (!vivo.current) return;
    setAEnviar(false);
    aoTerminar("enviada");
  }

  const aPreparar = reducao === "a-preparar";
  const descricaoDoErroDaFoto = erroDaFoto !== null ? idDoErroDaFoto : undefined;

  return (
    <>
      <p className="text-corpo text-texto">{TEXTOS.promessaEnviar}</p>

      <div className="flex w-full flex-col gap-1">
        <label htmlFor={idDaFoto} className="text-nota font-forte text-texto">
          {TEXTOS.etiquetaFoto}
        </label>
        <input
          ref={campoDaFoto}
          id={idDaFoto}
          type="file"
          accept="image/*"
          aria-disabled={aEnviar ? "true" : undefined}
          aria-invalid={erroDaFoto !== null ? "true" : undefined}
          aria-describedby={descricaoDoErroDaFoto}
          onClick={(evento) => {
            // `aria-disabled` não trava o seletor nativo: trava-se aqui.
            if (aEnviar) evento.preventDefault();
          }}
          onChange={(evento) => {
            const ficheiro = evento.target.files?.[0];
            if (aEnviar || ficheiro === undefined) return;
            escolher(ficheiro);
          }}
          className="min-h-toque w-full text-corpo text-texto"
        />
        {erroDaFoto !== null && (
          <p id={idDoErroDaFoto} className="text-nota text-erro">
            {erroDaFoto}
          </p>
        )}
      </div>

      {previa !== null && (
        <div className="aspect-foto w-full overflow-hidden rounded-cartao border border-fio-interno bg-fundo">
          <img src={previa} alt="" className="h-full w-full object-contain" />
        </div>
      )}

      <CampoDaGestao
        ref={campoDaLegenda}
        etiqueta={TEXTOS.etiquetaLegenda}
        valor={legenda}
        aoMudar={setLegenda}
        ajuda={TEXTOS.ajudaLegenda}
        parado={aEnviar}
        {...(erroDaLegenda !== null ? { erro: erroDaLegenda } : {})}
      />

      {aPreparar && (
        <div role="status" className="flex flex-col gap-1 text-nota text-texto-suave">
          <p>{TEXTOS.aPreparar}</p>
          {demora && <p>{TEXTOS.demoraUmPouco}</p>}
        </div>
      )}
      {erroGeral !== null && (
        <p role="status" className="text-nota text-erro">
          {erroGeral}
        </p>
      )}

      <Botao
        ref={botaoDeEnviar}
        larguraTotal
        variante="principal"
        // Sem foto escolhida o botão **não** fica inerte: diz o que falta (F3-05 6.4).
        desativado={aPreparar || aEnviar || reducao === "falhou"}
        aTrabalhar={aEnviar}
        textoATrabalhar={TEXTOS.aEnviar}
        onClick={() => {
          void enviar();
        }}
      >
        {TEXTOS.enviar}
      </Botao>
      <Botao larguraTotal desativado={aEnviar} onClick={fecharComPergunta}>
        {TEXTOS.cancelar}
      </Botao>
    </>
  );
}
