import type { ReactElement } from "react";
import { useId, useMemo } from "react";

import { Botao } from "../../../components/ui/Botao";
import { ListaOrdenavel } from "./ListaOrdenavel";
import { LinhaDoProdutoGestao } from "./LinhaDoProdutoGestao";
import { aOrdenar, TEXTOS } from "./textos";
import type {
  CategoriaGestao,
  OrdemEmCurso,
  ProdutoGestao,
  Registar,
  ResultadoDoPreco,
} from "./tipos";

/**
 * Uma categoria da ementa na gestão (F4-02, 3 e 6): o cabeçalho, a linha que diz
 * o que o público faz com ela (3.2), e as linhas — ou, no modo «Ordenar», a lista
 * ordenável com a barra colada ao topo.
 *
 * A linha de aviso **lê-se do estado local** (muda no momento em que o último
 * produto fica indisponível) e reflete `publico.py`: a junção é interna, por isso
 * uma categoria escondida, vazia ou toda indisponível não chega ao público. Com
 * pesquisa o painel mostra só uma parte da categoria, e a linha não se desenha.
 */
function linhaDeAviso(categoria: CategoriaGestao): string | null {
  if (!categoria.visivel) return TEXTOS.categoriaEscondida;
  if (categoria.produtos.length === 0) return TEXTOS.categoriaSemProdutos;
  if (categoria.produtos.every((produto) => !produto.disponivel)) {
    return TEXTOS.categoriaTodaIndisponivel;
  }
  return null;
}

export function CartaoDaCategoria({
  categoria,
  comPesquisa,
  ordem,
  ordenarDesativado,
  precoAberto,
  produtosPendentes,
  aoOrdenar,
  aoMudarOrdem,
  aoGuardarOrdem,
  aoCancelarOrdem,
  aoAbrirPreco,
  aoCancelarPreco,
  aoGuardarPreco,
  aoAbrirFolha,
  aoMudarDisponivel,
  registar,
}: {
  categoria: CategoriaGestao;
  comPesquisa: boolean;
  /** O modo «Ordenar» desta categoria, se estiver aberto. */
  ordem: OrdemEmCurso | null;
  /** Há outro modo aberto, ou a lista pode estar desatualizada (9.5). */
  ordenarDesativado: boolean;
  precoAberto: number | null;
  produtosPendentes: ReadonlySet<number>;
  aoOrdenar: () => void;
  aoMudarOrdem: (ids: number[]) => void;
  aoGuardarOrdem: () => void;
  aoCancelarOrdem: () => void;
  aoAbrirPreco: (produto: ProdutoGestao) => void;
  aoCancelarPreco: () => void;
  aoGuardarPreco: (produto: ProdutoGestao, precoCent: number) => Promise<ResultadoDoPreco>;
  aoAbrirFolha: (produto: ProdutoGestao) => void;
  aoMudarDisponivel: (produto: ProdutoGestao, ligado: boolean) => void;
  registar: Registar;
}): ReactElement {
  const idDoTitulo = useId();
  const aviso = comPesquisa ? null : linhaDeAviso(categoria);
  const emOrdem = ordem !== null;

  const itensDaOrdem = useMemo(() => {
    if (ordem === null) return [];
    const porId = new Map(categoria.produtos.map((produto) => [produto.id, produto]));
    return ordem.ids.flatMap((id) => {
      const produto = porId.get(id);
      return produto === undefined ? [] : [{ id, nome: produto.nome }];
    });
  }, [ordem, categoria.produtos]);

  return (
    <section
      aria-labelledby={idDoTitulo}
      className="superficie-painel flex flex-col gap-3 rounded-cartao border border-contorno-superficie p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={idDoTitulo}
          ref={registar("titulo")}
          tabIndex={-1}
          className="min-w-0 break-words font-titulo text-titulo text-texto"
        >
          {categoria.nome}
        </h2>
        {!comPesquisa && !emOrdem && categoria.produtos.length >= 2 && (
          <Botao ref={registar("ordenar")} desativado={ordenarDesativado} onClick={aoOrdenar}>
            {TEXTOS.ordenar}
          </Botao>
        )}
      </div>

      {aviso !== null && <p className="text-nota text-texto-suave">{aviso}</p>}

      {emOrdem ? (
        <>
          <div
            className={
              "sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b border-fio-interno bg-fundo " +
              "px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
            }
          >
            <p className="text-nota text-texto-suave">{aOrdenar(categoria.nome)}</p>
            <div className="grid grid-cols-1 gap-2 lg:flex">
              <Botao desativado={ordem.aGuardar} onClick={aoCancelarOrdem}>
                {TEXTOS.cancelar}
              </Botao>
              <Botao
                variante="principal"
                desativado={ordem.aGuardar}
                aTrabalhar={ordem.aGuardar}
                textoATrabalhar={TEXTOS.aGuardar}
                onClick={aoGuardarOrdem}
              >
                {TEXTOS.guardarOrdem}
              </Botao>
            </div>
          </div>
          <ListaOrdenavel
            itens={itensDaOrdem}
            bloqueado={ordem.aGuardar}
            aoMudarOrdem={aoMudarOrdem}
          />
        </>
      ) : (
        categoria.produtos.length > 0 && (
          <ul className="flex flex-col">
            {categoria.produtos.map((produto) => (
              <LinhaDoProdutoGestao
                key={produto.id}
                produto={produto}
                aEditarPreco={precoAberto === produto.id}
                aoAbrirPreco={() => {
                  aoAbrirPreco(produto);
                }}
                aoCancelarPreco={aoCancelarPreco}
                aoGuardarPreco={(precoCent) => aoGuardarPreco(produto, precoCent)}
                aoAbrirFolha={() => {
                  aoAbrirFolha(produto);
                }}
                aoMudarDisponivel={(ligado) => {
                  aoMudarDisponivel(produto, ligado);
                }}
                pendente={produtosPendentes.has(produto.id)}
                registar={registar}
              />
            ))}
          </ul>
        )
      )}
    </section>
  );
}
