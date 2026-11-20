import type { ReactElement } from "react";

import { formatarDataDoEvento } from "../../../lib/formato/data-do-evento";
import { TEXTOS } from "./textos";

/**
 * «Assim aparece no site» (F4-03, spec 7.5): o cartão do evento como o site público o desenha,
 * com a data escrita pela **mesma função** (`formatarDataDoEvento`), para as duas nunca
 * discordarem, e a descrição **inteira**, com as quebras de linha que o dono escreveu.
 *
 * É um bloco **de leitura**: sem foco, sem ligações, sem `aria-live` (não se anuncia a cada
 * tecla). **Sem cartaz** — a imagem só se lê na gestão e carregar megabytes por dados móveis
 * para uma pré-visualização é desperdício; se o evento tem cartaz, uma linha di-lo.
 *
 * O markup do cartão repete o de `pages/publico/Eventos.tsx` de propósito: a única alteração
 * da F4-03 ao pacote público é a classe das quebras de linha, e importar o cartão de lá
 * punha a gestão a depender do desenho do público.
 */
export function PreVisualizacao({
  titulo,
  descricao,
  inicio,
  agora,
  publicado,
  temCartaz,
}: {
  titulo: string;
  descricao: string;
  /** O instante já validado, ou `null` (sem data válida o cartão não se desenha). */
  inicio: string | null;
  agora: Date;
  publicado: boolean;
  temCartaz: boolean;
}): ReactElement | null {
  const comCartao = inicio !== null && titulo.trim() !== "";
  if (!comCartao && !temCartaz) return null;

  const data = comCartao ? formatarDataDoEvento(inicio, agora) : null;
  const texto = descricao.trim();

  return (
    <div className="flex flex-col gap-2">
      {data !== null && (
        <>
          <h3 className="text-corpo font-forte text-texto">{TEXTOS.assimApareceTitulo}</h3>
          <p className="text-nota text-texto-suave">
            {publicado ? TEXTOS.legendaPublicado : TEXTOS.legendaRascunho}
          </p>
          <div className="superficie-painel rounded-cartao border border-fio-interno p-4">
            <h3>
              <span className="block font-titulo text-destaque text-texto">{data.grande}</span>{" "}
              <span className="mt-1 block text-nota text-texto-suave">{data.pequena}</span>{" "}
              <span className="mt-2 block text-seccao font-forte text-texto">{titulo.trim()}</span>
            </h3>
            {texto !== "" && (
              <p className="mt-2 whitespace-pre-line text-corpo text-texto-suave">{texto}</p>
            )}
          </div>
        </>
      )}
      {temCartaz && <p className="text-nota text-texto-suave">{TEXTOS.temCartaz}</p>}
    </div>
  );
}
