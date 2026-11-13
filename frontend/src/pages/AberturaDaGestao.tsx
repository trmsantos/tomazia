import type { ComponentType, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { Botao } from "../components/ui/Botao";
import { EstadoVazio } from "../components/ui/EstadoVazio";

/**
 * Os ecrãs de «a abrir a gestão» e de «não consegui abrir» (F4-01, secção 4).
 *
 * **Vivem fora de `src/pages/gestao/` de propósito.** São usados em dois sítios:
 * pelo `main.tsx`, enquanto o ficheiro da gestão vem (e se não vier), e pela
 * guarda do `AppGestao`, enquanto o `GET /auth/eu` responde. O texto e a
 * posição são os mesmos nas duas esperas — nunca um estado e depois outro. O
 * público nunca importa nada de `src/pages/gestao` (Q-02); isto é o pouco que o
 * `main.tsx` precisa e custa umas centenas de bytes.
 */
const TEXTOS = {
  nomeDoBar: "Bar da Tomazia",
  aAbrir: "A abrir a gestão…",
  erroTitulo: "Não consegui abrir a gestão.",
  erroSemResposta: "Verifica a ligação e tenta outra vez.",
  erroServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",
} as const;

/**
 * «A abrir a gestão…» (4.1): sem moldura (a barra só aparece com sessão
 * confirmada), sem botões, sem animação.
 */
export function AAbrirAGestao(): ReactElement {
  return (
    <main
      role="status"
      className="mx-auto flex max-w-vazio flex-col items-center gap-3 px-4 pt-12 text-center"
    >
      <p className="font-titulo text-titulo text-texto">{TEXTOS.nomeDoBar}</p>
      <p className="text-corpo text-texto-suave">{TEXTOS.aAbrir}</p>
    </main>
  );
}

/**
 * «Não consegui abrir a gestão.» (4.2), sem moldura e **nunca** com um «Entrar»:
 * não conseguir perguntar não é não ter sessão (regra 10).
 *
 * O foco só vai para o botão **depois** de uma nova tentativa falhar outra vez —
 * quem navega por teclado ouve que o erro continua. Na primeira chegada não se
 * move.
 */
export function ErroAoAbrirAGestao({
  semResposta,
  aTentar,
  aoTentar,
}: {
  semResposta: boolean;
  aTentar: boolean;
  aoTentar: () => void;
}): ReactElement {
  const botao = useRef<HTMLButtonElement>(null);
  const jaTentou = useRef(false);

  useEffect(() => {
    if (!aTentar && jaTentou.current) botao.current?.focus();
  }, [aTentar]);

  return (
    <main className="px-4 pt-12">
      <EstadoVazio
        tom="erro"
        titulo={TEXTOS.erroTitulo}
        linha={semResposta ? TEXTOS.erroSemResposta : TEXTOS.erroServidor}
      >
        <Botao
          ref={botao}
          aTrabalhar={aTentar}
          textoATrabalhar={TEXTOS.aTentar}
          onClick={() => {
            jaTentou.current = true;
            aoTentar();
          }}
        >
          {TEXTOS.tentarOutraVez}
        </Botao>
      </EstadoVazio>
    </main>
  );
}

type Resultado = { tipo: "pronto"; Gestao: ComponentType } | { tipo: "falhou" };

function iniciar(carregar: () => Promise<{ default: ComponentType }>): Promise<Resultado> {
  return carregar().then(
    (modulo): Resultado => ({ tipo: "pronto", Gestao: modulo.default }),
    (): Resultado => ({ tipo: "falhou" }),
  );
}

type Estado = { tipo: "a-abrir" } | { tipo: "a-tentar" } | Resultado;

/**
 * Carrega a gestão à parte (F4-01, «Rotas e carregamento»).
 *
 * `carregar` é o `import()` dinâmico, que o `main.tsx` escreve por extenso (é o
 * que o Vite precisa de ver para pôr a gestão num ficheiro à parte). Não é
 * `React.lazy`: o `lazy` guarda a promessa rejeitada, e «Tentar outra vez» tem
 * de refazer o `import()` — depois de a rede voltar, um toque basta, sem
 * recarregar a página.
 *
 * O primeiro pedido fica numa referência e não num efeito solto: em
 * `React.StrictMode` os efeitos correm duas vezes em desenvolvimento, e sem isto
 * pedia-se o ficheiro duas vezes. O pedido **nunca rejeita** — a falha passa a
 * valor —, para não haver uma rejeição sem ninguém à escuta enquanto o React
 * ainda não montou o efeito.
 */
export function CarregadorDaGestao({
  carregar,
}: {
  carregar: () => Promise<{ default: ComponentType }>;
}): ReactElement {
  const [estado, setEstado] = useState<Estado>({ tipo: "a-abrir" });
  const pedido = useRef<Promise<Resultado> | null>(null);
  const montado = useRef(false);

  useEffect(() => {
    montado.current = true;
    pedido.current ??= iniciar(carregar);
    void pedido.current.then((resultado) => {
      if (montado.current) setEstado(resultado);
    });
    return () => {
      montado.current = false;
    };
  }, [carregar]);

  if (estado.tipo === "pronto") return <estado.Gestao />;
  if (estado.tipo === "a-abrir") return <AAbrirAGestao />;

  return (
    <ErroAoAbrirAGestao
      // O ficheiro que não chegou é «sem resposta»: a falha é de rede.
      semResposta
      aTentar={estado.tipo === "a-tentar"}
      aoTentar={() => {
        setEstado({ tipo: "a-tentar" });
        pedido.current = iniciar(carregar);
        void pedido.current.then((resultado) => {
          if (montado.current) setEstado(resultado);
        });
      }}
    />
  );
}
