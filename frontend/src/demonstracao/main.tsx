import React from "react";
import ReactDOM from "react-dom/client";

import "../styles/global.css";
import { PaginaDemonstracao } from "./PaginaDemonstracao";

/**
 * Monta a página de demonstração dos componentes.
 *
 * Vive dentro de `src/` (e não ao lado do HTML) para ser abrangida pelo
 * `tsc --noEmit`, pelo ESLint e pelo Prettier: uma demonstração que não
 * compila é pior do que não ter demonstração. Não entra no build — ver o
 * comentário em `demonstracao.html`.
 */
const elementoRaiz = document.getElementById("root");

if (!elementoRaiz) {
  throw new Error("Elemento #root não encontrado em demonstracao.html.");
}

ReactDOM.createRoot(elementoRaiz).render(
  <React.StrictMode>
    <PaginaDemonstracao />
  </React.StrictMode>,
);
