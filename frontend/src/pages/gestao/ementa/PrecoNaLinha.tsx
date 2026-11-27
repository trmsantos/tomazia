import type { FormEvent, KeyboardEvent, ReactElement, Ref } from "react";
import { useEffect, useRef, useState } from "react";

import { Botao } from "../../../components/ui/Botao";
import { formatarPreco } from "../../../lib/formato/preco";
import { lerPreco, precoParaCampo } from "../../../lib/formato/ler-preco";
import { CampoDaGestao } from "./CampoDaGestao";
import { nomeDoBotaoDoPreco, TEXTO_DO_ERRO_DE_PRECO, TEXTOS } from "./textos";
import type { ProdutoGestao, ResultadoDoPreco } from "./tipos";

/**
 * O preço na linha da ementa de gestão (F4-02, 4): um botão que, ao toque, vira
 * um campo no lugar — **dois toques** para mudar um preço (abrir, «Guardar»;
 * escrever os algarismos não é um toque, e o teclado que abre é o decimal).
 *
 * Duas peças, porque na linha ficam em sítios diferentes: o botão à direita do
 * nome, e a zona de edição por baixo.
 */

/** O botão do preço. «—» quando o preço não se sabe escrever: a linha diz que há ali algo a arranjar. */
export function BotaoDoPreco({
  produto,
  aoAbrir,
  ref,
}: {
  produto: ProdutoGestao;
  aoAbrir: () => void;
  ref?: Ref<HTMLButtonElement>;
}): ReactElement {
  const texto = formatarPreco(produto.preco_cent);
  return (
    <button
      ref={ref}
      type="button"
      aria-label={nomeDoBotaoDoPreco(produto.nome, produto.preco_cent)}
      aria-expanded="false"
      onClick={aoAbrir}
      className={
        "min-h-toque min-w-preco-gestao shrink-0 rounded-pequeno border border-contorno px-3 " +
        "text-corpo font-preco tabular-nums text-texto"
      }
    >
      {texto === "" ? "—" : texto}
    </button>
  );
}

/**
 * A zona de edição: campo, «Cancelar» e «Guardar» (o único Botão principal do
 * ecrã enquanto existir). `Enter` submete; `Esc` cancela; **não há «guardar ao
 * sair do campo»**: um toque distraído ao lado não pode gravar um preço.
 *
 * O campo **não** fica `disabled` enquanto guarda (o foco não cai): quem trava um
 * segundo envio é o `aGuardar`. Num erro a edição não fecha e o valor escrito
 * não se perde; o foco volta ao campo.
 */
export function EdicaoDoPreco({
  produto,
  aoGuardar,
  aoCancelar,
}: {
  produto: ProdutoGestao;
  aoGuardar: (precoCent: number) => Promise<ResultadoDoPreco>;
  aoCancelar: () => void;
}): ReactElement {
  const [texto, setTexto] = useState(() => precoParaCampo(produto.preco_cent));
  // Um objeto novo a cada erro: a mesma frase duas vezes seguidas volta a pôr o foco no campo.
  const [erro, setErro] = useState<{ texto: string } | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  // Ao abrir: o foco no campo e o valor selecionado, para o primeiro algarismo
  // substituir o preço antigo.
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);

  useEffect(() => {
    if (erro !== null) campo.current?.focus();
  }, [erro]);

  async function aoSubmeter(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    if (aGuardar) return;

    const leitura = lerPreco(texto);
    if (!leitura.ok) {
      setErro({ texto: TEXTO_DO_ERRO_DE_PRECO[leitura.motivo] });
      return;
    }
    // O mesmo preço fecha como «Cancelar»: sem pedido e sem aviso.
    if (leitura.precoCent === produto.preco_cent) {
      aoCancelar();
      return;
    }

    setErro(null);
    setAGuardar(true);
    const resultado = await aoGuardar(leitura.precoCent);
    if (resultado.tipo === "erro") {
      setAGuardar(false);
      setErro({ texto: resultado.texto });
    }
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === "Escape") {
      evento.preventDefault();
      aoCancelar();
    }
  }

  return (
    <form
      noValidate
      onSubmit={(evento) => {
        void aoSubmeter(evento);
      }}
      className="flex flex-col gap-3"
    >
      <CampoDaGestao
        ref={campo}
        decimal
        etiqueta={TEXTOS.etiquetaDoPreco}
        valor={texto}
        aoTeclar={aoTeclar}
        erro={erro?.texto}
        aoMudar={(valor) => {
          setTexto(valor);
          setErro(null);
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <Botao variante="discreto" onClick={aoCancelar}>
          {TEXTOS.cancelar}
        </Botao>
        <Botao
          variante="principal"
          tipo="submit"
          desativado={aGuardar}
          aTrabalhar={aGuardar}
          textoATrabalhar={TEXTOS.aGuardar}
        >
          {TEXTOS.guardar}
        </Botao>
      </div>
    </form>
  );
}
