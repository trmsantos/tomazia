import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import { enderecoDaMiniatura, type FotoAprovada } from "../../../lib/api/gestao-fotos";
import { TEXTOS_APROVADAS as T, quandoFoiAprovada, temTexto } from "./textos";

/**
 * A folha «Tem a certeza?» de eliminar uma foto aprovada (F4-04b, spec 7). Eliminar não tem volta
 * (o backend apaga o ficheiro e a linha, ADR 0022), por isso custa dois toques: o «Eliminar» do
 * item abre esta folha **sem pedido nenhum**.
 *
 *  - mostra a foto **inteira** (`object-contain`, a mesma URL da miniatura: vem da cache), a data,
 *    o nome e a legenda **inteira**: é o último sítio onde o dono confirma que é a foto certa;
 *  - sem imagem, no lugar dela vai a frase de que a foto não se consegue mostrar, e o «Eliminar»
 *    **continua ativo** (é a saída para uma linha sem ficheiro);
 *  - o foco **começa em «Cancelar»**, a ação segura; o «Eliminar» é `perigo` e a folha não tem
 *    dourado;
 *  - a meio do pedido, nem «Cancelar», `Esc`, «×» nem a cortina fecham.
 */
export function FolhaEliminarFoto({
  foto,
  agora,
  aEliminar,
  falhou,
  aoConfirmar,
  aoFechar,
}: {
  /** `null` = fechada. */
  foto: FotoAprovada | null;
  agora: Date;
  aEliminar: boolean;
  /** O servidor respondeu com um erro: fica dentro da folha, que se mantém aberta. */
  falhou: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}): ReactElement {
  const cancelar = useRef<HTMLButtonElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const aberta = foto !== null;

  // Corre depois do efeito da `Folha` (filha daqui): o `showModal` dela já pôs o foco no primeiro
  // controlo, e é aqui que se dá à ação segura.
  useEffect(() => {
    if (aberta) cancelar.current?.focus();
  }, [aberta]);

  // O «×» é da `Folha` partilhada, que ainda não tem como o pôr inerte (spec 7.2: «Cancelar» e o
  // «×» ficam `aria-disabled` a meio do pedido). O fecho já está travado por `aoFechar`; isto diz
  // o mesmo a quem lê o ecrã. Fica por conta daqui até a `Folha` ganhar uma propriedade para isso.
  useEffect(() => {
    const fechar = corpo.current?.closest("dialog")?.querySelector('button[aria-label="Fechar"]');
    if (fechar === null || fechar === undefined) return;
    if (aEliminar) fechar.setAttribute("aria-disabled", "true");
    return () => {
      fechar.removeAttribute("aria-disabled");
    };
  }, [aEliminar, aberta]);

  const quando = foto === null ? null : quandoFoiAprovada(foto, agora);
  // Uma fotografia sem data de aprovação diz só «Aprovada».
  const linhaDaData = T.aprovadaEm(quando);

  return (
    <Folha
      aberta={aberta}
      // Fechada, a Folha não leva texto no DOM.
      titulo={aberta ? T.tituloDaFolha : ""}
      aoFechar={() => {
        if (aEliminar) return;
        aoFechar();
      }}
    >
      {foto !== null && (
        <>
          <div ref={corpo} className="flex gap-3">
            <ImagemDaFolha ficheiro={foto.ficheiro} />
            <div className="flex flex-col gap-1">
              <p className="text-nota text-texto-suave">{linhaDaData}</p>
              {temTexto(foto.enviada_por) && (
                <p className="break-words text-nota text-texto-suave">
                  {T.enviadaPor(foto.enviada_por)}
                </p>
              )}
            </div>
          </div>

          {temTexto(foto.descricao) && (
            <p className="break-words text-corpo text-texto">{foto.descricao}</p>
          )}

          <p className="text-corpo text-texto">{T.avisoDaFolha}</p>

          {falhou && (
            <p role="status" className="text-nota text-erro">
              {T.erroNaFolha}
            </p>
          )}

          <Botao
            larguraTotal
            variante="perigo"
            desativado={aEliminar}
            aTrabalhar={aEliminar}
            textoATrabalhar={T.aEliminar}
            onClick={aoConfirmar}
          >
            {T.eliminar}
          </Botao>
          <Botao ref={cancelar} larguraTotal desativado={aEliminar} onClick={aoFechar}>
            {T.cancelar}
          </Botao>
        </>
      )}
    </Folha>
  );
}

/** A foto inteira; se não carregar, a frase. Monta-se de novo a cada abertura (recomeça a tentar). */
function ImagemDaFolha({ ficheiro }: { ficheiro: string }): ReactElement {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <p className="text-corpo text-texto">{T.naoSeMostra}</p>;
  return (
    <div className="aspect-foto w-1/3 shrink-0 overflow-hidden rounded-pequeno border border-fio-interno bg-fundo">
      <img
        src={enderecoDaMiniatura(ficheiro)}
        alt=""
        className="h-full w-full object-contain"
        onError={() => {
          setFalhou(true);
        }}
      />
    </div>
  );
}
