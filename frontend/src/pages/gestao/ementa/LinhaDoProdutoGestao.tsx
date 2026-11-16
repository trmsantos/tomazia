import type { ReactElement } from "react";

import { Interruptor } from "../../../components/ui/Interruptor";
import { BotaoDoPreco, EdicaoDoPreco } from "./PrecoNaLinha";
import { TEXTOS } from "./textos";
import type { ProdutoGestao, Registar, ResultadoDoPreco } from "./tipos";

/**
 * Uma linha da ementa na gestão (F4-02, 4): o nome (abre a folha de editar), o
 * preço (vira campo no lugar) e o interruptor «Disponível».
 *
 * Ordem de tabulação: nome, preço, interruptor. O nome deixa de ser um botão
 * enquanto o preço está em edição (a zona de edição é a única coisa a fazer ali).
 *
 * O lápis é um SVG de 20 px, `aria-hidden`: o nome acessível do botão é só o
 * nome do produto. A descrição e «Não aparece na ementa.» vêm por baixo, sem corte.
 */
function Lapis(): ReactElement {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-texto-suave"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

export function LinhaDoProdutoGestao({
  produto,
  aEditarPreco,
  aoAbrirPreco,
  aoCancelarPreco,
  aoGuardarPreco,
  aoAbrirFolha,
  aoMudarDisponivel,
  pendente,
  registar,
}: {
  produto: ProdutoGestao;
  aEditarPreco: boolean;
  aoAbrirPreco: () => void;
  aoCancelarPreco: () => void;
  aoGuardarPreco: (precoCent: number) => Promise<ResultadoDoPreco>;
  aoAbrirFolha: () => void;
  aoMudarDisponivel: (ligado: boolean) => void;
  pendente: boolean;
  registar: Registar;
}): ReactElement {
  return (
    <li className="flex flex-col gap-2 border-t border-fio-interno py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        {aEditarPreco ? (
          <span className="min-w-0 flex-1 break-words py-2 text-corpo font-forte text-texto">
            {produto.nome}
          </span>
        ) : (
          <button
            ref={registar(`nome-${String(produto.id)}`)}
            type="button"
            onClick={aoAbrirFolha}
            className={
              "flex min-h-toque min-w-0 flex-1 items-center gap-2 py-2 text-left " +
              "text-corpo font-forte text-texto"
            }
          >
            <span className="min-w-0 break-words">{produto.nome}</span>
            <Lapis />
          </button>
        )}
        {!aEditarPreco && (
          <BotaoDoPreco
            ref={registar(`preco-${String(produto.id)}`)}
            produto={produto}
            aoAbrir={aoAbrirPreco}
          />
        )}
      </div>

      {aEditarPreco && (
        <EdicaoDoPreco produto={produto} aoGuardar={aoGuardarPreco} aoCancelar={aoCancelarPreco} />
      )}

      {produto.descricao !== null && produto.descricao !== "" && (
        <p className="break-words text-nota text-texto-suave">{produto.descricao}</p>
      )}
      {!produto.disponivel && (
        <p className="text-nota text-texto-suave">{TEXTOS.produtoIndisponivel}</p>
      )}

      <Interruptor
        etiqueta={TEXTOS.etiquetaDisponivel}
        ligado={produto.disponivel}
        desativado={pendente}
        aoMudar={aoMudarDisponivel}
      />
    </li>
  );
}
