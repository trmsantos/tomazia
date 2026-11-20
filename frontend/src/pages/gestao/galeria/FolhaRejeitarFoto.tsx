import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Folha } from "../../../components/ui/Folha";
import { enderecoDaImagem, type FotoPendente } from "../../../lib/api/gestao-fotos";
import { quandoFoiEnviada } from "./quando-foi-enviada";
import { TEXTOS } from "./textos";

/**
 * A folha «Tem a certeza?» (F4-04, D2 e spec 6). Rejeitar apaga os bytes e não tem volta, por
 * isso custa dois toques: o «Rejeitar» da página abre esta folha **sem pedido nenhum**.
 *
 *  - a miniatura serve para confirmar que é a foto certa (a página por baixo está tapada pela
 *    cortina). É a mesma URL da imagem: o `no-store` faz um pedido a mais por rejeição, aceite;
 *  - sem imagem (D3), no lugar da miniatura vai a frase de que a foto não se consegue mostrar;
 *  - o foco **começa em «Cancelar»**, a ação segura; o «Rejeitar» é `perigo` e a folha não tem
 *    dourado;
 *  - a meio do pedido, nem «Cancelar», `Esc` nem a cortina fecham: fechar a folha deixava o ecrã
 *    sem saber o que aconteceu.
 */
export function FolhaRejeitarFoto({
  foto,
  agora,
  semImagem,
  aRejeitar,
  falhou,
  aoConfirmar,
  aoFechar,
}: {
  /** `null` = fechada. */
  foto: FotoPendente | null;
  agora: Date;
  /** D3: a imagem não se consegue mostrar. */
  semImagem: boolean;
  aRejeitar: boolean;
  /** Um 5xx ou 403: o erro fica dentro da folha, que se mantém aberta. */
  falhou: boolean;
  aoConfirmar: () => void;
  aoFechar: () => void;
}): ReactElement {
  const cancelar = useRef<HTMLButtonElement>(null);
  const aberta = foto !== null;

  // Corre depois do efeito da `Folha` (que é filha daqui): o `showModal` dela já abriu o
  // diálogo e já pôs o foco no primeiro controlo, e é aqui que se dá à ação segura.
  useEffect(() => {
    if (aberta) cancelar.current?.focus();
  }, [aberta]);

  return (
    <Folha
      aberta={aberta}
      // Fechada, a Folha não leva texto no DOM.
      titulo={aberta ? TEXTOS.tituloRejeitar : ""}
      aoFechar={() => {
        if (aRejeitar) return;
        aoFechar();
      }}
    >
      {foto !== null && (
        <>
          <div className="flex gap-3">
            {semImagem ? (
              <p className="text-corpo text-texto">{TEXTOS.fotoNaoSeMostraNaFolha}</p>
            ) : (
              <div className="aspect-foto w-1/3 shrink-0 overflow-hidden rounded-pequeno border border-fio-interno bg-fundo">
                <img
                  src={enderecoDaImagem(foto.id)}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>
            )}
            <p className="text-nota text-texto-suave">
              {TEXTOS.enviadaEm(quandoFoiEnviada(foto.criada_em, agora))}
              {foto.enviada_por !== null && TEXTOS.porNome(foto.enviada_por)}
            </p>
          </div>

          <p className="text-corpo text-texto">{TEXTOS.rejeitarAviso}</p>

          {falhou && (
            <p role="status" className="text-nota text-erro">
              {TEXTOS.rejeitarServidor}
            </p>
          )}

          <Botao
            larguraTotal
            variante="perigo"
            desativado={aRejeitar}
            aTrabalhar={aRejeitar}
            textoATrabalhar={TEXTOS.aRejeitar}
            onClick={aoConfirmar}
          >
            {TEXTOS.rejeitar}
          </Botao>
          <Botao ref={cancelar} larguraTotal desativado={aRejeitar} onClick={aoFechar}>
            {TEXTOS.cancelar}
          </Botao>
        </>
      )}
    </Folha>
  );
}
