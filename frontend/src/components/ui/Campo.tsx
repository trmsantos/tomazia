import type { ReactElement } from "react";
import { useId } from "react";

import { juntar } from "./juntar";

/**
 * Campo (secção 7.2 de `docs/ecras/F3-01.md`).
 *
 * De cima para baixo: etiqueta sempre visível, ajuda, campo, erro. Nunca um
 * placeholder a fazer de etiqueta — o placeholder, quando existe, é um
 * exemplo ("6,50") e desaparece assim que se escreve.
 *
 * O `aria-describedby` junta ajuda e erro por essa ordem, que é a ordem por
 * que o leitor de ecrã as lê e a ordem em que fazem sentido: o que se espera
 * primeiro, o que correu mal depois. Nada de `aria-live` aqui: o erro já é
 * lido ao focar o campo, e uma região viva lê-o uma segunda vez.
 *
 * O contorno não muda no foco. Duas coisas a mudar ao mesmo tempo fazem o
 * campo "saltar", e o anel da camada base já diz tudo o que é preciso.
 */
export type PropriedadesDoCampo = {
  /** Sempre visível. A obrigatoriedade escreve-se aqui: "Nome (obrigatório)". */
  etiqueta: string;
  id?: string;
  ajuda?: string;
  erro?: string;
  /** Vira `placeholder`: é um exemplo, não uma etiqueta. */
  exemplo?: string;
  obrigatorio?: boolean;
  /** Aqui é mesmo `disabled`, ao contrário do Botão: um campo desligado não se preenche. */
  desativado?: boolean;
  soLeitura?: boolean;
  multilinha?: boolean;
  valor?: string;
  aoMudar?: (valor: string) => void;
};

export function Campo({
  etiqueta,
  id,
  ajuda,
  erro,
  exemplo,
  obrigatorio = false,
  desativado = false,
  soLeitura = false,
  multilinha = false,
  valor,
  aoMudar,
}: PropriedadesDoCampo): ReactElement {
  const gerado = useId();
  const identificador = id ?? gerado;
  const idDaAjuda = `${identificador}-ajuda`;
  const idDoErro = `${identificador}-erro`;

  const descritores = juntar(ajuda !== undefined && idDaAjuda, erro !== undefined && idDoErro);

  const classes = juntar(
    "min-h-toque w-full px-3 py-2 rounded-pequeno",
    "border bg-transparent text-texto text-corpo placeholder:text-texto-suave",
    // O campo define-se pelo contorno, nunca pelo preenchimento: no escuro,
    // bordô sobre bordô dá 1,13 e a caixa desaparecia.
    //
    // Desativado não mexe na cor do contorno nem na do texto: nos dois âmbitos
    // `contorno` e `texto-suave` são a cor que um campo normal já usa, por
    // isso trocá-las não desenhava estado nenhum (secção 6). O sinal é a
    // opacidade; a fronteira fica onde estava.
    desativado ? "opacity-desativado cursor-not-allowed" : "",
    // Só de leitura não é desativado: o valor é para ser lido e copiado, por
    // isso fica com a opacidade normal e só perde a fronteira.
    soLeitura ? "border-transparent" : "",
    erro !== undefined && !soLeitura ? "border-erro" : "",
    erro === undefined && !soLeitura ? "border-contorno" : "",
  );

  const comuns = {
    id: identificador,
    className: classes,
    placeholder: exemplo,
    required: obrigatorio,
    disabled: desativado,
    readOnly: soLeitura,
    value: valor,
    "aria-invalid": erro !== undefined ? ("true" as const) : undefined,
    "aria-describedby": descritores.length > 0 ? descritores : undefined,
    onChange: (evento: { target: { value: string } }): void => {
      aoMudar?.(evento.target.value);
    },
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={identificador} className="text-nota font-forte text-texto">
        {etiqueta}
      </label>

      {ajuda !== undefined && (
        <p id={idDaAjuda} className="text-nota text-texto-suave">
          {ajuda}
        </p>
      )}

      {multilinha ? <textarea rows={3} {...comuns} /> : <input type="text" {...comuns} />}

      {erro !== undefined && (
        <p id={idDoErro} className="text-nota text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
