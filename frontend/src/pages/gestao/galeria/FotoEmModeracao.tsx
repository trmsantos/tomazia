import type { ReactElement } from "react";
import { useId } from "react";

import { Botao } from "../../../components/ui/Botao";
import { enderecoDaImagem, type FotoPendente } from "../../../lib/api/gestao-fotos";
import { quandoFoiEnviada } from "./quando-foi-enviada";
import { TEXTOS, altDaFoto } from "./textos";

/**
 * Como está a imagem da foto atual (spec 9.5):
 *  - `ok`: à vista;
 *  - `verificando`: o `<img>` falhou e a fila está a ser consultada (o `onError` não decide);
 *  - `sem-ligacao`: a verificação não teve resposta;
 *  - `repetir`: a fila ainda lista a foto, e a imagem foi pedida uma vez mais;
 *  - `nao-se-mostra`: a segunda tentativa falhou também (D3: só se pode rejeitar).
 */
export type FaseDaImagem = "ok" | "verificando" | "sem-ligacao" | "repetir" | "nao-se-mostra";

/** A linha de estado por baixo dos botões: o que aconteceu à foto, ou à foto anterior. */
export type LinhaDeEstado = { texto: string; erro: boolean };

/**
 * A foto à vista (F4-04, spec 4): a caixa quadrada com a imagem inteira, os dois botões
 * imediatamente por baixo (nunca mudam de sítio entre fotos), a linha de estado e, por baixo
 * de tudo, o que se sabe da foto.
 *
 * Monta **dois `<img>` com `key`**: a atual e a seguinte (`hidden`, `alt=""`, `loading="eager"`).
 * Ao avançar, o React mantém o mesmo nó da seguinte e só lhe tira o `hidden`: a imagem é
 * `no-store`, por isso um `new Image()` não garantia que o `<img>` seguinte a reutilizasse.
 *
 * Só desenha: quem decide o que está inerte e o que se diz é o `GaleriaGestao`.
 */
export function FotoEmModeracao({
  foto,
  seguinte,
  agora,
  fase,
  chave,
  rejeitarInerte,
  aprovarInerte,
  aAprovar,
  linha,
  aoVerificarOutraVez,
  aoCarregarImagem,
  aoFalharImagem,
  aoTentarImagemOutraVez,
  aoRejeitar,
  aoAprovar,
}: {
  foto: FotoPendente;
  seguinte: FotoPendente | null;
  agora: Date;
  fase: FaseDaImagem;
  /** A `key` da imagem atual: muda para a remontar (o `no-store` faz o pedido de novo). */
  chave: number;
  rejeitarInerte: boolean;
  aprovarInerte: boolean;
  aAprovar: boolean;
  linha: LinhaDeEstado | null;
  /** Só com a verificação falhada: repete a verificação, nunca o `POST`. */
  aoVerificarOutraVez: (() => void) | null;
  aoCarregarImagem: (id: number, chave: number) => void;
  /** `visivel`: a imagem da foto atual (a pré-carregada que falha só se regista). */
  aoFalharImagem: (id: number, visivel: boolean) => void;
  aoTentarImagemOutraVez: () => void;
  aoRejeitar: () => void;
  aoAprovar: () => void;
}): ReactElement {
  const idDaLinhaDaFoto = useId();
  const imagemVisivel = fase === "ok" || fase === "repetir";
  const quando = quandoFoiEnviada(foto.criada_em, agora);

  return (
    <div className="flex flex-col gap-3 lg:w-3/5">
      <div className="flex aspect-foto w-full items-center justify-center overflow-hidden rounded-cartao border border-fio-interno bg-fundo">
        {fase === "sem-ligacao" && (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <p className="text-corpo text-texto">{TEXTOS.fotoSemLigacao}</p>
            <Botao onClick={aoTentarImagemOutraVez}>{TEXTOS.tentarOutraVez}</Botao>
          </div>
        )}
        {fase === "nao-se-mostra" && (
          <p className="p-4 text-center text-corpo text-texto">{TEXTOS.fotoNaoSeMostra}</p>
        )}
        {imagemVisivel && (
          <img
            key={`${String(foto.id)}-${String(chave)}`}
            src={enderecoDaImagem(foto.id)}
            alt={altDaFoto(foto, agora)}
            loading="eager"
            className="h-full w-full object-contain"
            onLoad={() => {
              aoCarregarImagem(foto.id, chave);
            }}
            onError={() => {
              aoFalharImagem(foto.id, true);
            }}
          />
        )}
        {seguinte !== null && (
          <img
            key={`${String(seguinte.id)}-0`}
            src={enderecoDaImagem(seguinte.id)}
            alt=""
            hidden
            loading="eager"
            className="h-full w-full object-contain"
            onLoad={() => {
              aoCarregarImagem(seguinte.id, 0);
            }}
            onError={() => {
              aoFalharImagem(seguinte.id, false);
            }}
          />
        )}
      </div>

      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-2 [&>button]:min-h-grande">
          <Botao
            larguraTotal
            descritoPor={idDaLinhaDaFoto}
            desativado={rejeitarInerte}
            onClick={aoRejeitar}
          >
            {TEXTOS.rejeitar}
          </Botao>
        </div>
        <div className="col-span-3 [&>button]:min-h-grande">
          <Botao
            larguraTotal
            variante="principal"
            descritoPor={idDaLinhaDaFoto}
            desativado={aprovarInerte}
            aTrabalhar={aAprovar}
            textoATrabalhar={TEXTOS.aAprovar}
            onClick={aoAprovar}
          >
            {TEXTOS.aprovar}
          </Botao>
        </div>
      </div>

      {linha !== null && (
        <p role="status" className={linha.erro ? "text-nota text-erro" : "text-nota text-texto"}>
          {linha.texto}
        </p>
      )}
      {aoVerificarOutraVez !== null && (
        <div>
          <Botao onClick={aoVerificarOutraVez}>{TEXTOS.verificarOutraVez}</Botao>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p id={idDaLinhaDaFoto} className="text-nota text-texto-suave">
          {TEXTOS.enviadaEm(quando)}
          {foto.enviada_por !== null && TEXTOS.porNome(foto.enviada_por)}
        </p>
        {foto.descricao !== null && (
          <>
            <p className="text-nota text-texto-suave">{TEXTOS.legendaNoSite}</p>
            <p className="break-words text-corpo text-texto">{foto.descricao}</p>
          </>
        )}
      </div>
    </div>
  );
}
