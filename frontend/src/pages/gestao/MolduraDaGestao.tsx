import type { ReactElement, ReactNode } from "react";

import { juntar } from "../../components/ui/juntar";
import { DESTINOS, eCliqueSimples, estaAtivo, estaExatamente, navegarComGuarda } from "./navegacao";

/**
 * A moldura da gestão (F4-01, secções 5 e 6): a navegação e o `<main>`.
 *
 * **Um só HTML, duas peles.** Abaixo de 1024 px a `<nav>` é uma barra fixa em
 * baixo com cinco colunas; a partir de 1024 é a coluna lateral de 240 px. Muda o
 * CSS, não a lista nem o `aria-label`.
 *
 * O `<nav>` vem **antes** do `<main>` nas duas larguras: quem tabula está em
 * desktop, onde o menu está à esquerda e à frente do conteúdo, e a ordem do DOM
 * é a ordem visual para quem usa teclado (5.4).
 *
 * Na coluna lateral o ativo desce um degrau abaixo do painel, e fá-lo pelo
 * âmbito (`ativo-na-coluna-da-gestao`) e não por um nome da paleta: um componente só
 * escreve papéis (`cores-so-nos-tokens.test.ts`).
 *
 * O ativo distingue-se sem cor — peso, barra de 2 px por cima e `aria-current` —
 * e **nunca é dourado**: o dourado tem três usos (ação principal, chip ativo,
 * foco) e «onde estou» não é nenhum deles.
 *
 * O `<main>` é o mesmo nó em todos os destinos; só o conteúdo muda. Não escreve
 * o `<h1>`: é cada destino que o faz.
 */
const TEXTOS = { saltar: "Saltar para o conteúdo", navegacao: "Gestão" } as const;

export function MolduraDaGestao({
  caminho,
  children,
}: {
  caminho: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      {/*
       * Mesma receita do «Saltar para a ementa» (F3-03): fixa, uma altura acima
       * do topo, e desce com `:focus`. Fora da grelha, para não ocupar uma
       * célula dela.
       */}
      <a
        href="#conteudo"
        className={
          "superficie-painel fixed left-4 top-0 z-30 -translate-y-full inline-flex min-h-toque " +
          "items-center rounded-pequeno px-6 font-corpo font-forte text-corpo text-texto " +
          "focus:translate-y-2"
        }
      >
        {TEXTOS.saltar}
      </a>

      <div className="lg:grid lg:grid-cols-gestao">
        <nav
          aria-label={TEXTOS.navegacao}
          className={juntar(
            "superficie-painel fixed inset-x-0 bottom-0 z-20 h-barra-gestao border-t border-contorno-superficie",
            "lg:sticky lg:inset-x-auto lg:bottom-auto lg:top-0 lg:z-auto lg:h-screen lg:border-r lg:border-t-0 lg:p-4",
          )}
        >
          <p className="hidden pb-4 pl-3 font-titulo text-titulo text-texto lg:block">
            Bar da Tomazia
          </p>
          <ul className="grid h-full grid-cols-5 lg:flex lg:h-auto lg:flex-col lg:gap-1">
            {DESTINOS.map((destino) => {
              const ativo = estaAtivo(destino, caminho);
              // Numa subrota (`/gestao/mais/definicoes`) o destino continua ativo,
              // mas tocar nele volta ao pai.
              const exato = estaExatamente(destino, caminho);
              return (
                <li key={destino.caminho} className="lg:w-full">
                  <a
                    href={destino.caminho}
                    aria-current={ativo ? "page" : undefined}
                    onClick={(evento) => {
                      if (!eCliqueSimples(evento)) return;
                      evento.preventDefault();
                      // Tocar no destino exato outra vez não faz nada: nem entrada
                      // nova no histórico, nem recarregar, nem deslocar. Numa
                      // subrota, volta ao pai. Passa pela guarda de saída: com
                      // alterações por guardar, pergunta.
                      if (!exato) navegarComGuarda(destino.caminho);
                    }}
                    className={juntar(
                      "flex h-full flex-col items-center justify-center gap-1 border-t-marca text-nota",
                      "transition-transform duration-curta ease-curva active:translate-y-premido",
                      "lg:h-auto lg:min-h-toque lg:flex-row lg:justify-start lg:gap-3 lg:rounded-pequeno lg:border-t-0 lg:px-3 lg:text-corpo",
                      ativo
                        ? "border-texto font-forte text-texto ativo-na-coluna-da-gestao"
                        : "border-transparent text-texto-suave",
                    )}
                  >
                    {destino.icone}
                    {destino.rotulo}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <main
          id="conteudo"
          tabIndex={-1}
          className="folga-da-barra-da-gestao mx-auto w-full max-w-coluna px-4 lg:px-8 lg:pb-8"
        >
          {children}
        </main>
      </div>
    </>
  );
}
