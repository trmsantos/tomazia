import type { ReactElement } from "react";

import { Ementa } from "./pages/publico/Ementa";

/**
 * A página pública (F3-02, secção 2).
 *
 * O `<h1>` vive aqui até a F3-03 o levar para o cabeçalho fixo: sem ele a
 * página fica sem nome e o axe acusa. A hierarquia é `h1` → `h2` → `h3`, sem
 * saltos — o `h2` é o título da ementa e os `h3` são os das categorias.
 *
 * A ementa é o conteúdo principal e aparece **sem um toque**: não há ecrã
 * intermédio nem categoria por escolher. Quem abre o código da mesa quer saber
 * o que há e quanto custa.
 */
function App(): ReactElement {
  return (
    <>
      <header className="mx-auto max-w-coluna px-4 pt-8">
        <h1 className="font-titulo text-destaque text-texto">Bar da Tomazia</h1>
      </header>
      <main>
        <Ementa />
      </main>
    </>
  );
}

export default App;
