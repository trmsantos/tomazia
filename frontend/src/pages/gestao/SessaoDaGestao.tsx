import { createContext, useContext } from "react";

/**
 * O que a gestão deixa a quem desenha lá dentro (F4-01).
 *
 * `aoPerderSessao()` é para as F4-02 a F4-05 usarem quando um pedido da gestão
 * devolve 401 a meio: apaga o resultado da guarda e leva ao login, a substituir,
 * exatamente como o 401 da própria guarda. «Sair» usa-o também, depois do 204.
 *
 * `aoConfirmarSessao()` é do login: depois de um 200 diz à guarda que a sessão
 * já está confirmada, para ela não repetir o `GET /auth/eu` (nem mostrar «A abrir
 * a gestão…» por cima de um login que acabou de dar certo).
 */
export type SessaoDaGestao = {
  aoPerderSessao: () => void;
  aoConfirmarSessao: () => void;
};

export const ContextoDaSessao = createContext<SessaoDaGestao | null>(null);

/** Para o que só existe dentro da guarda. Falhar alto: sem a guarda não há sessão a perder. */
export function useSessaoDaGestao(): SessaoDaGestao {
  const sessao = useContext(ContextoDaSessao);
  if (sessao === null) {
    throw new Error("useSessaoDaGestao fora do AppGestao: não há guarda a que avisar.");
  }
  return sessao;
}

/** Para o login, que também se desenha sozinho (sem guarda): `null` quando não há. */
export function useSessaoOpcional(): SessaoDaGestao | null {
  return useContext(ContextoDaSessao);
}
