import { ErroDaApi } from "../../../lib/api/cliente";
import { armarPrazo } from "../prazo";

/**
 * O que correu mal num pedido da ementa, já classificado (regra 10: «sem
 * resposta» e «o servidor disse que não» não se leem iguais).
 *
 * `sem-resposta` numa **mutação** quer dizer «não sei se gravou»: quem chama
 * recarrega a lista e nunca repete o pedido sozinho.
 */
export type Falha =
  | { tipo: "sessao" }
  | { tipo: "sem-resposta" }
  | { tipo: "nao-existe" }
  | { tipo: "conflito" }
  | { tipo: "invalido"; campo: string | null; codigo: string | null }
  | { tipo: "servidor" };

export type Resultado<T> = { ok: true; valor: T } | { ok: false; falha: Falha };

export function classificar(erro: unknown): Falha {
  if (!(erro instanceof ErroDaApi)) return { tipo: "servidor" };
  if (erro.estado === 401) return { tipo: "sessao" };
  if (erro.estado === null) return { tipo: "sem-resposta" };
  if (erro.estado === 404) return { tipo: "nao-existe" };
  if (erro.estado === 409) return { tipo: "conflito" };
  if (erro.estado === 422) {
    const campo = erro.extra["campo"];
    return {
      tipo: "invalido",
      campo: typeof campo === "string" ? campo : null,
      codigo: erro.codigo,
    };
  }
  return { tipo: "servidor" };
}

/**
 * Faz uma mutação com o prazo de 10 s. **Não se aborta ao desmontar**: um pedido
 * que já partiu pode ter gravado, e largá-lo a meio só tirava a resposta a quem
 * a podia usar (as leituras é que abortam).
 */
export async function executar<T>(
  chamada: (opcoes: { sinal: AbortSignal }) => Promise<T>,
): Promise<Resultado<T>> {
  const controlador = new AbortController();
  const desarmar = armarPrazo(controlador);
  try {
    return { ok: true, valor: await chamada({ sinal: controlador.signal }) };
  } catch (erro) {
    return { ok: false, falha: classificar(erro) };
  } finally {
    desarmar();
  }
}
