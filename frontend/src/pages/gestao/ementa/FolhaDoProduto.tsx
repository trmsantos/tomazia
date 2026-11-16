import type { FormEvent, ReactElement } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { Campo } from "../../../components/ui/Campo";
import { Folha } from "../../../components/ui/Folha";
import { Interruptor } from "../../../components/ui/Interruptor";
import type { AlteracaoDeProduto, NovoProduto } from "../../../lib/api/gestao-ementa";
import { lerPreco, precoParaCampo } from "../../../lib/formato/ler-preco";
import { CampoDaGestao } from "./CampoDaGestao";
import { Selecao } from "./Selecao";
import { TEXTO_DO_ERRO_DE_PRECO, TEXTOS } from "./textos";
import type { CampoDaFolha, ModoDaFolha, ProdutoGestao, ResultadoDaFolha } from "./tipos";

/**
 * A folha de adicionar e de editar um produto (F4-02, 7, decisão D1): a mesma
 * `Folha` (`<dialog>` nativo) para as duas tarefas.
 *
 *  - **Adicionar**: nome, descrição, preço, categoria e «Disponível» (ligado).
 *    Sem resposta não se reenvia (duplicava o produto): quem grava recarrega a
 *    lista por baixo e a folha diz que não conseguiu.
 *  - **Editar**: os mesmos campos, **sem** «Disponível» (fica na linha),
 *    pré-preenchidos. O `PATCH` leva **só** o que mudou em relação ao produto
 *    **aberto**; nada mudou, fecha sem pedido; descrição apagada → `null`.
 *
 * Validação local antes de qualquer pedido, com o foco no primeiro campo inválido
 * (pela ordem do ecrã). A `mensagem` do backend nunca aparece: um 422 com `campo`
 * vira a frase do campo, e sem `campo` a frase geral.
 *
 * A folha fecha com dados escritos sem perguntar (`Esc`, cortina, «Cancelar»).
 */
const LIMITE_DO_NOME = 120;
const LIMITE_DA_DESCRICAO = 280;

type Erros = Partial<Record<CampoDaFolha, string>> & { geral?: string };

type OpcaoDeCategoria = { id: number; nome: string };

export function FolhaDoProduto({
  modo,
  categorias,
  aoFechar,
  aoAdicionar,
  aoEditar,
}: {
  /** `null` = fechada. */
  modo: ModoDaFolha | null;
  categorias: readonly OpcaoDeCategoria[];
  aoFechar: () => void;
  aoAdicionar: (novo: NovoProduto) => Promise<ResultadoDaFolha>;
  aoEditar: (produto: ProdutoGestao, alteracao: AlteracaoDeProduto) => Promise<ResultadoDaFolha>;
}): ReactElement {
  const titulo = modo?.tipo === "editar" ? TEXTOS.tituloEditar : TEXTOS.tituloAdicionar;
  return (
    <Folha aberta={modo !== null} titulo={titulo} aoFechar={aoFechar}>
      {modo !== null && (
        <Formulario
          // Cada abertura é um formulário novo: nada do que se escreveu antes volta.
          key={modo.tipo === "editar" ? `editar-${String(modo.produto.id)}` : "adicionar"}
          modo={modo}
          categorias={categorias}
          aoFechar={aoFechar}
          aoAdicionar={aoAdicionar}
          aoEditar={aoEditar}
        />
      )}
    </Folha>
  );
}

function Formulario({
  modo,
  categorias,
  aoFechar,
  aoAdicionar,
  aoEditar,
}: {
  modo: ModoDaFolha;
  categorias: readonly OpcaoDeCategoria[];
  aoFechar: () => void;
  aoAdicionar: (novo: NovoProduto) => Promise<ResultadoDaFolha>;
  aoEditar: (produto: ProdutoGestao, alteracao: AlteracaoDeProduto) => Promise<ResultadoDaFolha>;
}): ReactElement {
  const base = useId();
  const ids: Record<CampoDaFolha, string> = {
    nome: `${base}-nome`,
    descricao: `${base}-descricao`,
    preco: `${base}-preco`,
    categoria: `${base}-categoria`,
  };
  const editar = modo.tipo === "editar" ? modo.produto : null;

  const [nome, setNome] = useState(editar?.nome ?? "");
  const [descricao, setDescricao] = useState(editar?.descricao ?? "");
  const [preco, setPreco] = useState(editar !== null ? precoParaCampo(editar.preco_cent) : "");
  const [categoriaId, setCategoriaId] = useState(
    editar !== null
      ? String(editar.categoria_id)
      : modo.tipo === "adicionar" && modo.categoriaId !== null
        ? String(modo.categoriaId)
        : "",
  );
  const [disponivel, setDisponivel] = useState(true);
  const [erros, setErros] = useState<Erros>({});
  const [aGuardar, setAGuardar] = useState(false);
  // Um objeto novo a cada pedido de foco: o mesmo campo duas vezes seguidas volta a recebê-lo.
  const [foco, setFoco] = useState<{ campo: CampoDaFolha | "geral" } | null>(null);
  const geral = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (foco === null) return;
    if (foco.campo === "geral") geral.current?.focus();
    else document.getElementById(ids[foco.campo])?.focus();
    // `ids` deriva de `base`, que não muda; só o pedido de foco dispara isto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);

  function mostrar(novos: Erros, primeiro: CampoDaFolha | "geral"): void {
    setErros(novos);
    setFoco({ campo: primeiro });
  }

  function validar(): { erros: Erros; precoCent: number | null } {
    const novos: Erros = {};
    const nomeAparado = nome.trim();
    if (nomeAparado === "") novos.nome = TEXTOS.erroNomeVazio;
    else if (nomeAparado.length > LIMITE_DO_NOME) novos.nome = TEXTOS.erroNomeLongo;

    if (descricao.trim().length > LIMITE_DA_DESCRICAO) novos.descricao = TEXTOS.erroDescricaoLonga;

    const leitura = lerPreco(preco);
    if (!leitura.ok) novos.preco = TEXTO_DO_ERRO_DE_PRECO[leitura.motivo];

    if (categoriaId === "") novos.categoria = TEXTOS.erroCategoriaEmFalta;

    return { erros: novos, precoCent: leitura.ok ? leitura.precoCent : null };
  }

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (aGuardar) return;

    const { erros: novos, precoCent } = validar();
    const primeiro = (["nome", "descricao", "preco", "categoria"] as const).find(
      (campo) => novos[campo] !== undefined,
    );
    if (primeiro !== undefined || precoCent === null) {
      mostrar(novos, primeiro ?? "preco");
      return;
    }

    const nomeAparado = nome.trim();
    const descricaoAparada = descricao.trim();
    const categoria = Number(categoriaId);

    let pedido: Promise<ResultadoDaFolha>;
    if (editar !== null) {
      // Só o que mudou, comparado com o produto **aberto**.
      const alteracao: AlteracaoDeProduto = {};
      if (nomeAparado !== editar.nome) alteracao.nome = nomeAparado;
      if (descricaoAparada !== (editar.descricao ?? "")) {
        alteracao.descricao = descricaoAparada === "" ? null : descricaoAparada;
      }
      if (precoCent !== editar.preco_cent) alteracao.preco_cent = precoCent;
      if (categoria !== editar.categoria_id) alteracao.categoria_id = categoria;

      if (Object.keys(alteracao).length === 0) {
        aoFechar();
        return;
      }
      pedido = aoEditar(editar, alteracao);
    } else {
      pedido = aoAdicionar({
        categoria_id: categoria,
        nome: nomeAparado,
        ...(descricaoAparada !== "" ? { descricao: descricaoAparada } : {}),
        preco_cent: precoCent,
        disponivel,
      });
    }

    setErros({});
    setAGuardar(true);
    const resultado = await pedido;
    if (resultado.tipo === "erro") {
      setAGuardar(false);
      if (resultado.campo !== undefined) {
        mostrar({ [resultado.campo]: resultado.texto }, resultado.campo);
      } else {
        mostrar({ geral: resultado.texto }, "geral");
      }
    }
  }

  const opcoes = [
    ...(editar === null ? [{ valor: "", texto: TEXTOS.escolheACategoria }] : []),
    ...categorias.map((categoria) => ({ valor: String(categoria.id), texto: categoria.nome })),
  ];

  return (
    <form
      noValidate
      onSubmit={(evento) => {
        void aoSubmeter(evento);
      }}
      className="flex flex-col gap-4"
    >
      <Campo
        id={ids.nome}
        etiqueta={TEXTOS.etiquetaNome}
        valor={nome}
        erro={erros.nome}
        aoMudar={(valor) => {
          setNome(valor);
          setErros((antes) => ({ ...antes, nome: undefined }));
        }}
      />
      <Campo
        id={ids.descricao}
        etiqueta={TEXTOS.etiquetaDescricao}
        multilinha
        valor={descricao}
        erro={erros.descricao}
        aoMudar={(valor) => {
          setDescricao(valor);
          setErros((antes) => ({ ...antes, descricao: undefined }));
        }}
      />
      <CampoDaGestao
        id={ids.preco}
        decimal
        etiqueta={TEXTOS.etiquetaPrecoDaFolha}
        valor={preco}
        erro={erros.preco}
        aoMudar={(valor) => {
          setPreco(valor);
          setErros((antes) => ({ ...antes, preco: undefined }));
        }}
      />
      <Selecao
        id={ids.categoria}
        etiqueta={TEXTOS.etiquetaCategoria}
        valor={categoriaId}
        opcoes={opcoes}
        erro={erros.categoria}
        aoMudar={(valor) => {
          setCategoriaId(valor);
          setErros((antes) => ({ ...antes, categoria: undefined }));
        }}
      />
      {editar === null && (
        <Interruptor
          etiqueta={TEXTOS.etiquetaDisponivel}
          ligado={disponivel}
          aoMudar={setDisponivel}
        />
      )}

      {erros.geral !== undefined && (
        <div ref={geral} tabIndex={-1} className="text-corpo text-erro">
          {erros.geral}
        </div>
      )}

      <Botao
        variante="principal"
        tipo="submit"
        larguraTotal
        desativado={aGuardar}
        aTrabalhar={aGuardar}
        textoATrabalhar={TEXTOS.aGuardar}
      >
        {editar === null ? TEXTOS.guardarProduto : TEXTOS.guardarAlteracoes}
      </Botao>
      <Botao variante="discreto" larguraTotal onClick={aoFechar}>
        {TEXTOS.cancelar}
      </Botao>
    </form>
  );
}
