// A entrada "/vitest" (em vez de "@testing-library/jest-dom" simples) liga
// os matchers ao `expect` do Vitest sem depender de globais ao estilo Jest.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { instalarAdaptadorDeDialogo } from "./testes/dialogo-jsdom";

/**
 * Desmontar o que ficou montado, entre testes.
 *
 * A Testing Library só regista esta limpeza sozinha quando o Vitest corre
 * com `globals: true`, e este projeto não os liga (os testes importam
 * `describe`/`it`/`expect` de "vitest" à mão). Sem esta linha, o `render`
 * do teste anterior fica no `document.body` e o `getByRole` do teste
 * seguinte rebenta com "Found multiple elements" — ou, pior, encontra o
 * elemento do teste anterior e passa a afirmar coisas sobre o DOM errado.
 *
 * Isto não se via até agora porque só havia um teste com `render` em todo
 * o frontend (`src/App.test.tsx`).
 */
afterEach(() => {
  cleanup();
});

// O jsdom 30 traz o elemento `<dialog>` mas não os métodos `show()`,
// `showModal()` e `close()`. A Folha é um `<dialog>` nativo (ADR 0008),
// por isso sem este adaptador nenhum teste dela chegava a renderizar.
// Ver `src/testes/dialogo-jsdom.ts` para o que ele faz e, sobretudo, para
// o que não faz.
instalarAdaptadorDeDialogo();
