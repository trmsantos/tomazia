/**
 * O que os testes da gestão (F4-01) partilham: o texto literal da
 * `docs/ecras/F4-01.md`, secção 9, e os apoios de histórico.
 *
 * O texto está escrito por extenso, não composto, pela mesma razão que
 * `TEXTOS_DA_GALERIA`: o dominio-bar validou esta tabela, e um teste que a
 * reescrevesse por concatenação deixava de ser o que ele validou. As duas frases
 * do backend (400 e 429) estão aqui só para os testes as devolverem em fingimentos
 * — o frontend **não** as escreve.
 *
 * Só para testes; nada em produção o importa.
 */
import { ErroDaApi } from "../lib/api/cliente";

export const TEXTOS_DA_GESTAO = {
  nomeDoBar: "Bar da Tomazia",
  tituloDoLogin: "Entrar na gestão",
  etiquetaUtilizador: "Utilizador (obrigatório)",
  etiquetaPassword: "Password (obrigatória)",
  erroUtilizadorVazio: "Escreve o utilizador.",
  erroPasswordVazia: "Escreve a password.",
  botaoEntrar: "Entrar",
  botaoAEntrar: "A entrar…",
  semResposta: "Não consegui entrar. Verifica a ligação e tenta outra vez.",
  servidor:
    "Não consegui entrar. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",

  aAbrir: "A abrir a gestão…",
  erroDaGuardaTitulo: "Não consegui abrir a gestão.",
  erroDaGuardaSemResposta: "Verifica a ligação e tenta outra vez.",
  erroDaGuardaServidor: "O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
  tentarOutraVez: "Tentar outra vez",
  aTentar: "A tentar…",

  saltar: "Saltar para o conteúdo",
  navegacao: "Gestão",

  vazioTitulo: "Ainda não há nada aqui.",
  vazioInicio: "Esta página não tem conteúdo nesta versão.",
  vazioEmenta: "A gestão da ementa não está disponível nesta versão.",
  vazioEventos: "A gestão dos eventos não está disponível nesta versão.",
  vazioGaleria: "A moderação das fotos não está disponível nesta versão.",

  sair: "Sair",
  aSair: "A sair…",
  saiuSemResposta:
    "Não consegui sair, por isso a sessão continua aberta. Verifica a ligação e tenta outra vez.",
  saiuServidor:
    "Não consegui sair, por isso a sessão continua aberta. O problema é nosso, não da tua ligação. Tenta outra vez daqui a pouco.",
} as const;

/** As duas frases que vêm do backend, verbatim (`app/services/auth.py`). */
export const FRASE_400 = "Utilizador ou password inválidos. Confirma os dois e tenta novamente.";
export const FRASE_429 = "A conta está bloqueada por causa de várias tentativas falhadas.";

/** Os cinco destinos, por ordem, com a rota (secção 5.1). */
export const DESTINOS_ESPERADOS = [
  { rotulo: "Início", caminho: "/gestao" },
  { rotulo: "Ementa", caminho: "/gestao/ementa" },
  { rotulo: "Eventos", caminho: "/gestao/eventos" },
  { rotulo: "Galeria", caminho: "/gestao/galeria" },
  { rotulo: "Mais", caminho: "/gestao/mais" },
] as const;

export const SESSAO_DE_TESTE = { id: 1, utilizador: "dono" } as const;

/** O erro de um 400 do `POST /auth/login`. */
export function erro400(): ErroDaApi {
  return new ErroDaApi(FRASE_400, { estado: 400, codigo: "credenciais_invalidas" });
}

/** O erro de um 429; `extra` e `cabecalhos` à vontade de quem testa. */
export function erro429(
  extra: Record<string, unknown>,
  cabecalhos: Record<string, string> = {},
): ErroDaApi {
  return new ErroDaApi(FRASE_429, { estado: 429, codigo: "conta_bloqueada", extra, cabecalhos });
}

/** O erro de um 401 do `GET /auth/eu`. */
export function erro401(): ErroDaApi {
  return new ErroDaApi("Precisas de entrar.", { estado: 401, codigo: "sessao_em_falta" });
}

/** Sem resposta nenhuma (rede, DNS, prazo). A mensagem é a do cliente, que nenhum ecrã mostra. */
export function erroSemResposta(): ErroDaApi {
  return new ErroDaApi("Não consegui falar com o servidor. (mensagem do cliente)", {
    estado: null,
    codigo: null,
  });
}

/** O servidor respondeu com um código que não é 400 nem 429. */
export function erroDoServidor(estado: number): ErroDaApi {
  return new ErroDaApi("O servidor teve um problema. (mensagem do cliente)", {
    estado,
    codigo: null,
  });
}

/** Põe o endereço onde o teste quer começar, sem acrescentar uma entrada ao histórico. */
export function abrirEm(caminho: string): void {
  window.history.replaceState(null, "", caminho);
}
