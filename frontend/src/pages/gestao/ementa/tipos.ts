import type { CategoriaGestao, ProdutoGestao } from "../../../lib/api/gestao-ementa";

export type { CategoriaGestao, ProdutoGestao };

/** Como um ecrã regista os nós a que o foco pode ter de voltar (por chave). */
export type Registar = (chave: string) => (no: HTMLElement | null) => void;

/** O que a edição do preço devolve a quem a abriu. */
export type ResultadoDoPreco = { tipo: "ok" } | { tipo: "erro"; texto: string };

export type CampoDaFolha = "nome" | "descricao" | "preco" | "categoria";

export type ResultadoDaFolha =
  { tipo: "fechou" } | { tipo: "erro"; campo?: CampoDaFolha; texto: string };

export type ModoDaFolha =
  { tipo: "adicionar"; categoriaId: number | null } | { tipo: "editar"; produto: ProdutoGestao };

export type OrdemEmCurso = {
  categoriaId: number;
  /** Os ids pela ordem local, ainda por gravar. */
  ids: number[];
  aGuardar: boolean;
};
