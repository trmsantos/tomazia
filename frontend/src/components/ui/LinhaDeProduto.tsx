import type { ReactElement } from "react";

import { formatarPreco } from "../../lib/formato/preco";

/**
 * Linha de produto (secção 6 de `docs/ecras/F3-02.md`).
 *
 * Nome à esquerda, pontilhado, preço à direita, descrição por baixo quando
 * existe. É o oitavo componente da lista da especificação e nasce aqui.
 *
 * **Nada nela é clicável**, e isso é uma decisão de desenho e de teclado ao
 * mesmo tempo: 140 produtos clicáveis seriam 140 paragens de tabulação antes
 * da secção seguinte. Os únicos controlos da ementa são os chips e a lupa.
 *
 * Três decisões que a tabela de 6.3 fixa, e que se vêem nas classes:
 *
 *  - o **nome** ocupa o que precisa e encolhe quando é preciso (`min-w-0`:
 *    sem ele, um item de flex recusa-se a encolher abaixo do seu conteúdo e um
 *    nome longo empurra o preço para fora do cartão);
 *  - o **fio** fica com o que sobrar e nunca desaparece (`min-w-fio`);
 *  - o **preço** nunca encolhe nem parte.
 *
 * E `items-baseline`, que é o que responde à pergunta do nome longo: o preço
 * alinha pela **primeira** linha do nome, como numa carta impressa. A
 * alternativa — o fio a correr até ao fim da última linha — só se consegue com
 * texto gerado por CSS, que vários leitores de ecrã anunciam: a linha passaria
 * a ler-se «Sandes de pernil, ponto ponto ponto ponto, seis euros e
 * cinquenta», vezes 140.
 *
 * As cores são papéis e nunca nomes da paleta. É isso que impede o preço e o
 * pontilhado dourados dentro do cartão creme, onde o dourado dá 1,72 e
 * desaparece. A descrição não usa `text-texto-suave` de propósito: no creme
 * esse papel resolve para a cor da marca, que é a do preço, e o texto menos
 * importante do cartão ficaria com a cor mais carregada. Recua por tamanho e
 * por peso.
 */
export type PropriedadesDaLinhaDeProduto = {
  nome: string;
  /** Inteiro em cêntimos. Um valor impossível deixa a linha só com o nome. */
  precoCent: number;
  descricao?: string | null;
};

export function LinhaDeProduto({
  nome,
  precoCent,
  descricao,
}: PropriedadesDaLinhaDeProduto): ReactElement {
  const preco = formatarPreco(precoCent);
  const temDescricao = descricao !== undefined && descricao !== null && descricao !== "";

  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-initial text-corpo font-forte text-texto">{nome}</span>
        {preco !== "" && (
          <>
            {/* Um `<span>` vazio: o fio é desenho, não texto, e um
                pontilhado que ninguém lê é precisamente o objetivo. Sem
                preço não há fio nenhum — um pontilhado que não liga nada a
                nada é um defeito visível. */}
            <span
              aria-hidden="true"
              className="min-w-fio flex-auto border-b border-dotted border-pontilhado"
            />
            <span className="flex-none whitespace-nowrap text-corpo font-preco tabular-nums text-texto-marca">
              {preco}
            </span>
          </>
        )}
      </div>
      {temDescricao && <p className="mt-1 text-nota text-texto">{descricao}</p>}
    </li>
  );
}
