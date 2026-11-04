import { useEffect, useState } from "react";
import type { ReactElement } from "react";

import { obterInfo } from "./lib/api/publico";
import { Cabecalho } from "./pages/publico/Cabecalho";
import type { EstadoDoInfo } from "./pages/publico/Cabecalho";
import { Ementa } from "./pages/publico/Ementa";
import { Eventos } from "./pages/publico/Eventos";

/**
 * A página pública (F3-02, secção 2; F3-03, secção 2).
 *
 * A ementa é o conteúdo principal e aparece **sem um toque**: não há ecrã
 * intermédio nem categoria por escolher. Quem abre o código da mesa quer saber
 * o que há e quanto custa — e o WiFi, que é a outra coisa, está a um toque no
 * cabeçalho.
 *
 * A hierarquia é `h1` → `h2` → `h3`, sem saltos: o `h1` é o nome do bar, que
 * desde a F3-03 vive dentro do cabeçalho fixo, o `h2` é o título da ementa e
 * os `h3` são os das categorias.
 */

/**
 * O `/info` pede-se **aqui, uma vez, ao montar** (F3-03, secção 2).
 *
 * Três razões, e nenhuma é de arrumação: o `/info` é `no-store` de propósito,
 * por isso dois componentes a pedir o mesmo são dois pedidos numa ligação de
 * dados móveis; a F3-06 precisa do **mesmo** payload, que traz morada,
 * telefone, Instagram, `maps_url` e horário; e quem pede fica responsável por
 * distinguir "nunca configurado" de "não consegui perguntar".
 *
 * Os três estados são **três**, e o falhado não carrega payload nenhum. A
 * forma proibida está escrita no `Cabecalho.tsx`, ao lado do tipo.
 */
function App(): ReactElement {
  const [info, setInfo] = useState<EstadoDoInfo>({ estado: "a-carregar" });

  useEffect(() => {
    /*
     * O pedido é cancelado ao desmontar, e isso não é higiene abstrata: em
     * `React.StrictMode` os efeitos correm duas vezes em desenvolvimento, e
     * sem isto ficavam dois `/info` no ar — numa rota que é `no-store` de
     * propósito e numa ligação de dados móveis. É o mesmo que a `Ementa` faz.
     */
    const cancelamento = new AbortController();
    let montado = true;

    async function perguntar(): Promise<void> {
      try {
        const resposta = await obterInfo({ sinal: cancelamento.signal });
        if (montado) setInfo({ estado: "pronto", info: resposta });
      } catch {
        // "Não consegui perguntar" fica a ser isso mesmo. Reescrevê-lo como
        // `{ wifi: { rede: null … } }` seria o site a **afirmar** que não há
        // WiFi, morada, telefone nem horário — e a F3-06 herda estes estados
        // (F3-03, 6.5).
        //
        // O `montado` é o que impede o cancelamento de passar por falha: um
        // pedido que **nós** abortámos não é uma resposta que não chegou.
        if (montado) setInfo({ estado: "falhou" });
      }
    }

    void perguntar();

    return () => {
      montado = false;
      cancelamento.abort();
    };
  }, []);

  return (
    <>
      <Cabecalho info={info} />
      {/*
       * `pt-cabecalho` e não uma margem: um elemento fixo sai do fluxo e não
       * ocupa lugar nenhum, por isso sem esta folga o `<h2> Ementa` nasce por
       * baixo do cabeçalho. **Nenhum teste de âncoras apanha isto**, porque
       * todos eles deslizam a página antes de medir seja o que for — o sintoma
       * é a primeira pintura, e é só lá que se vê (F3-03, secção 2 e 4.4).
       *
       * Entrega às tarefas seguintes: o `<main>` já desconta o cabeçalho.
       * Nenhuma secção nova volta a descontá-lo, ou desconta-o duas vezes.
       */}
      <main className="pt-cabecalho">
        <Ementa />
        {/*
         * Os eventos entram **depois** da ementa (F3-04, 2.1), e é isso que
         * deixa a ligação "Saltar para a ementa" do cabeçalho a aterrar onde
         * aterrava: não há nada entre o cabeçalho e a ementa. Postos antes,
         * o salto passava por cima de três cartões de evento e a correção
         * era uma segunda ligação de salto — mais uma paragem de `Tab` para
         * toda a gente.
         *
         * A secção não volta a descontar o cabeçalho: isso é do `<main>`.
         * E pode não existir de todo — sem eventos marcados não há título,
         * não há espaço e não há secção (F3-04, 8).
         */}
        <Eventos />
      </main>
    </>
  );
}

export default App;
