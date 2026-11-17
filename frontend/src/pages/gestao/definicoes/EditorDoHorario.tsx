import type { ReactElement } from "react";
import { useEffect, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import { Interruptor } from "../../../components/ui/Interruptor";
import { juntar } from "../../../components/ui/juntar";
import { CampoDeHora } from "./CampoDeHora";
import {
  type DiaDaSemana,
  type DiaNoFormulario,
  type ErrosDoHorario,
  MAXIMO_DE_PERIODOS,
  type PeriodoNoFormulario,
  fechaDepoisDaMeiaNoite,
  novaChave,
  periodoVazio,
} from "./horario-do-formulario";
import {
  AJUDA_DO_PRIMEIRO_PERIODO,
  TEXTOS,
  copiadoPara,
  explicacaoDeCopiar,
  fechaNoDiaSeguinte,
  legendaDoDia,
  nomeDeAbre,
  nomeDeFecha,
  nomeDeRemoverPeriodo,
  nomeDoDia,
  rotuloDoPeriodo,
  textoDeRemoverPeriodo,
  tituloDeCopiar,
} from "./textos";

/**
 * Os sete dias do horário (F4-05a, 6.2 a 6.4): controlado — quem o usa guarda os
 * `dias` e recebe cada mudança em `aoMudar`.
 *
 * Cada dia é um `<fieldset>` com a sua `<legend>` só para leitores de ecrã; o nome
 * do dia é a etiqueta do `Interruptor` (ligado = aberto). **Desligar não perde o
 * que estava escrito**: os períodos ficam em memória e ligar outra vez repõe-nos;
 * um dia ligado sem períodos cria **um** com as horas vazias (não se inventa uma
 * hora). O editor nunca reordena enquanto se escreve.
 *
 * «Copiar para outros dias» abre uma `Folha`; depois de copiar, uma linha com
 * «Desfazer» fica por baixo do botão do dia de origem — e **não** um aviso
 * temporário, que assentaria por cima da barra de guardar. A linha desaparece na
 * próxima alteração (aqui, ou vinda de fora): deixa de se poder desfazer com segurança.
 */
export type PropriedadesDoEditorDoHorario = {
  dias: DiaNoFormulario[];
  erros: ErrosDoHorario;
  /** A guardar: tudo `aria-disabled`, nada muda. */
  parado?: boolean;
  aoMudar: (dias: DiaNoFormulario[]) => void;
};

type Copia = { origem: DiaDaSemana; para: DiaDaSemana[] };
type Copiado = {
  origem: DiaDaSemana;
  quantos: number;
  antes: DiaNoFormulario[];
  depois: DiaNoFormulario[];
};

export function idDoDia(dia: DiaDaSemana): string {
  return `dia-${dia}`;
}

export function idDaHora(chave: string, qual: "abre" | "fecha"): string {
  return `hora-${chave}-${qual}`;
}

export function EditorDoHorario({
  dias,
  erros,
  parado = false,
  aoMudar,
}: PropriedadesDoEditorDoHorario): ReactElement {
  const [foco, setFoco] = useState<{ id: string } | null>(null);
  const [copia, setCopia] = useState<Copia | null>(null);
  const [copiado, setCopiado] = useState<Copiado | null>(null);

  // O nó novo só existe depois do render: o foco pede-se por um `id` e cumpre-se aqui.
  useEffect(() => {
    if (foco !== null) document.getElementById(foco.id)?.focus();
  }, [foco]);

  function mudarDia(dia: DiaDaSemana, mudar: (d: DiaNoFormulario) => DiaNoFormulario): void {
    aoMudar(dias.map((d) => (d.dia === dia ? mudar(d) : d)));
  }

  function ligarOuDesligar(dia: DiaDaSemana, ligado: boolean): void {
    if (parado) return;
    mudarDia(dia, (d) =>
      ligado
        ? {
            ...d,
            estado: "aberto",
            periodos: d.periodos.length === 0 ? [periodoVazio()] : d.periodos,
          }
        : { ...d, estado: "fechado" },
    );
  }

  function mudarPeriodo(
    dia: DiaDaSemana,
    chave: string,
    mudar: (p: PeriodoNoFormulario) => PeriodoNoFormulario,
  ): void {
    if (parado) return;
    mudarDia(dia, (d) => ({
      ...d,
      periodos: d.periodos.map((p) => (p.chave === chave ? mudar(p) : p)),
    }));
  }

  function acrescentar(dia: DiaDaSemana): void {
    if (parado) return;
    const novo = periodoVazio();
    mudarDia(dia, (d) => ({ ...d, periodos: [...d.periodos, novo] }));
    setFoco({ id: idDaHora(novo.chave, "abre") });
  }

  function remover(dia: DiaDaSemana, chave: string): void {
    if (parado) return;
    const periodos = dias.find((d) => d.dia === dia)?.periodos ?? [];
    const indice = periodos.findIndex((p) => p.chave === chave);
    const anterior = periodos[indice - 1];
    mudarDia(dia, (d) => ({ ...d, periodos: d.periodos.filter((p) => p.chave !== chave) }));
    // O período 1 não se remove: há sempre um anterior onde pôr o foco.
    if (anterior !== undefined) setFoco({ id: idDaHora(anterior.chave, "abre") });
  }

  function abrirACopia(origem: DiaDaSemana): void {
    if (parado) return;
    setCopia({ origem, para: dias.map((d) => d.dia).filter((d) => d !== origem) });
  }

  function copiar(): void {
    if (copia === null || copia.para.length === 0) return;
    const origem = dias.find((d) => d.dia === copia.origem);
    if (origem === undefined) return;
    const depois = dias.map((d) =>
      copia.para.includes(d.dia)
        ? {
            ...d,
            estado: "aberto" as const,
            periodos: origem.periodos.map((p) => ({ ...p, chave: novaChave() })),
          }
        : d,
    );
    setCopiado({ origem: copia.origem, quantos: copia.para.length, antes: dias, depois });
    setCopia(null);
    aoMudar(depois);
  }

  function desfazerACopia(): void {
    if (copiado === null) return;
    aoMudar(copiado.antes);
    setCopiado(null);
  }

  const outrosDias = copia === null ? [] : dias.map((d) => d.dia).filter((d) => d !== copia.origem);

  return (
    <div className="flex flex-col">
      {dias.map((d, indiceDoDia) => {
        const erroDoDia = erros.porDia[d.dia];
        const idDoErroDoDia = `erro-${idDoDia(d.dia)}`;
        const total = d.periodos.length;
        // A linha «Copiado para…» só vale enquanto os dias forem os que a cópia deixou.
        const linhaDaCopia =
          copiado !== null && copiado.depois === dias && copiado.origem === d.dia;

        return (
          <fieldset
            key={d.dia}
            id={idDoDia(d.dia)}
            tabIndex={-1}
            aria-describedby={erroDoDia !== undefined ? idDoErroDoDia : undefined}
            className={juntar(
              "flex min-w-0 flex-col gap-2 py-2",
              indiceDoDia > 0 && "border-t border-fio-interno",
            )}
          >
            <legend className="sr-only">{legendaDoDia(d.dia)}</legend>

            <Interruptor
              etiqueta={nomeDoDia(d.dia)}
              ligado={d.estado === "aberto"}
              desativado={parado}
              aoMudar={(ligado) => {
                ligarOuDesligar(d.dia, ligado);
              }}
            />

            {d.estado === "fechado" && (
              <p className="text-nota text-texto-suave">{TEXTOS.fechado}</p>
            )}
            {d.estado === "por_preencher" && (
              <div className="flex flex-wrap items-center gap-0">
                <p className="text-nota text-texto-suave">{TEXTOS.diaPorDecidir}</p>
                <div className="-ml-2">
                  <Botao
                    variante="discreto"
                    desativado={parado}
                    onClick={() => {
                      ligarOuDesligar(d.dia, false);
                      // O botão deixa de existir: o foco vai para o dia, nunca para o body.
                      setFoco({ id: idDoDia(d.dia) });
                    }}
                  >
                    {TEXTOS.marcarComoFechado}
                  </Botao>
                </div>
              </div>
            )}

            {d.estado === "aberto" && (
              <>
                {d.periodos.map((p, i) => {
                  const n = i + 1;
                  const erroDoPeriodo = erros.porPeriodo[p.chave];
                  const fechaDepois = fechaDepoisDaMeiaNoite(p.abre, p.fecha);
                  const idDaNota = `nota-${p.chave}`;
                  return (
                    <div key={p.chave} className="flex flex-col gap-2">
                      {n >= 2 && (
                        <p className="text-nota font-forte text-texto">{rotuloDoPeriodo(n)}</p>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <CampoDeHora
                          id={idDaHora(p.chave, "abre")}
                          etiqueta={TEXTOS.abre}
                          nome={nomeDeAbre(d.dia, n, total)}
                          valor={p.abre}
                          parado={parado}
                          {...(erroDoPeriodo?.abre !== undefined
                            ? { erro: erroDoPeriodo.abre }
                            : {})}
                          aoMudar={(valor, incompleto) => {
                            mudarPeriodo(d.dia, p.chave, (x) => ({
                              ...x,
                              abre: valor,
                              abreIncompleto: incompleto,
                            }));
                          }}
                        />
                        <CampoDeHora
                          id={idDaHora(p.chave, "fecha")}
                          etiqueta={TEXTOS.fecha}
                          nome={nomeDeFecha(d.dia, n, total)}
                          valor={p.fecha}
                          parado={parado}
                          {...(fechaDepois ? { idDaNota } : {})}
                          {...(erroDoPeriodo?.fecha !== undefined
                            ? { erro: erroDoPeriodo.fecha }
                            : {})}
                          aoMudar={(valor, incompleto) => {
                            mudarPeriodo(d.dia, p.chave, (x) => ({
                              ...x,
                              fecha: valor,
                              fechaIncompleto: incompleto,
                            }));
                          }}
                        />
                      </div>
                      {fechaDepois && (
                        <p id={idDaNota} className="text-nota text-texto-suave">
                          {fechaNoDiaSeguinte(d.dia, p.fecha)}
                        </p>
                      )}
                      {n >= 2 && (
                        <div>
                          <Botao
                            rotulo={nomeDeRemoverPeriodo(d.dia, n)}
                            desativado={parado}
                            onClick={() => {
                              remover(d.dia, p.chave);
                            }}
                          >
                            {textoDeRemoverPeriodo(n)}
                          </Botao>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center gap-2">
                  {total < MAXIMO_DE_PERIODOS ? (
                    <Botao
                      desativado={parado}
                      onClick={() => {
                        acrescentar(d.dia);
                      }}
                    >
                      {TEXTOS.adicionarPeriodo}
                    </Botao>
                  ) : (
                    <p className="text-nota text-texto">{TEXTOS.limiteDePeriodos}</p>
                  )}
                  <Botao
                    desativado={parado}
                    onClick={() => {
                      abrirACopia(d.dia);
                    }}
                  >
                    {TEXTOS.copiarParaOutrosDias}
                  </Botao>
                </div>

                {total === 1 && (
                  <p className="text-nota text-texto-suave">{AJUDA_DO_PRIMEIRO_PERIODO}</p>
                )}

                {linhaDaCopia && (
                  <div
                    role="status"
                    className="flex flex-wrap items-center gap-0 text-nota text-texto"
                  >
                    <p>{copiadoPara(copiado.quantos)}</p>
                    <div className="-ml-2">
                      <Botao variante="discreto" onClick={desfazerACopia}>
                        {TEXTOS.desfazer}
                      </Botao>
                    </div>
                  </div>
                )}
              </>
            )}

            {erroDoDia !== undefined && (
              <p id={idDoErroDoDia} className="text-nota text-erro">
                {erroDoDia}
              </p>
            )}
          </fieldset>
        );
      })}

      <Folha
        aberta={copia !== null}
        titulo={copia !== null ? tituloDeCopiar(copia.origem) : ""}
        aoFechar={() => {
          setCopia(null);
        }}
      >
        {copia !== null && (
          <>
            <p>{explicacaoDeCopiar(copia.origem)}</p>
            <div className="flex flex-col">
              {outrosDias.map((dia) => (
                <Interruptor
                  key={dia}
                  etiqueta={nomeDoDia(dia)}
                  ligado={copia.para.includes(dia)}
                  aoMudar={(ligado) => {
                    setCopia({
                      ...copia,
                      para: outrosDias.filter((x) => (x === dia ? ligado : copia.para.includes(x))),
                    });
                  }}
                />
              ))}
            </div>
            <div>
              <Botao
                onClick={() => {
                  setCopia({ ...copia, para: copia.para.length > 0 ? [] : outrosDias });
                }}
              >
                {copia.para.length > 0 ? TEXTOS.copiarNenhum : TEXTOS.copiarTodos}
              </Botao>
            </div>
            <div className="flex flex-wrap gap-3">
              <Botao
                onClick={() => {
                  setCopia(null);
                }}
              >
                {TEXTOS.cancelar}
              </Botao>
              <Botao variante="principal" desativado={copia.para.length === 0} onClick={copiar}>
                {TEXTOS.copiar}
              </Botao>
            </div>
          </>
        )}
      </Folha>
    </div>
  );
}
