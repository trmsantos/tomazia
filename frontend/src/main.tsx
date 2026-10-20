import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles/global.css";

const elementoRaiz = document.getElementById("root");

if (!elementoRaiz) {
  throw new Error("Elemento #root não encontrado em index.html.");
}

ReactDOM.createRoot(elementoRaiz).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
