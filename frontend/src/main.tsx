import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { CarregadorDaGestao } from "./pages/AberturaDaGestao";
import "./styles/global.css";

const elementoRaiz = document.getElementById("root");

if (!elementoRaiz) {
  throw new Error("Elemento #root não encontrado em index.html.");
}

/**
 * Decide uma vez, ao arrancar, o que abrir (F4-01, Q-02).
 *
 * `/gestao` e tudo o que começa por `/gestao/` abre a gestão, carregada **à
 * parte** por um `import()` dinâmico: o público nunca descarrega o JavaScript
 * dela. Todo o resto — `/`, `/gestaoX`, `/qualquer` — é o `App` público,
 * importado estaticamente como sempre. `/gestaoX` é público de propósito: só o
 * segmento inteiro `gestao` conta.
 *
 * O `import()` tem de estar escrito aqui, com este caminho literal, e não
 * dentro de um componente da gestão nem atrás de uma variável: é o que o Vite
 * precisa de ver para pôr a gestão num ficheiro à parte, e é o que o
 * `src/build-de-producao.test.ts` procura.
 */
const caminho = window.location.pathname;
const abreAGestao = caminho === "/gestao" || caminho.startsWith("/gestao/");

const carregarAGestao = () => import("./pages/gestao/AppGestao");

ReactDOM.createRoot(elementoRaiz).render(
  <React.StrictMode>
    {abreAGestao ? <CarregadorDaGestao carregar={carregarAGestao} /> : <App />}
  </React.StrictMode>,
);
