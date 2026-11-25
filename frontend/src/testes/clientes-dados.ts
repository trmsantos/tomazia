/**
 * Dados falsos da F4-05b (Início e Clientes), sem React nem Playwright: servem os testes de
 * componente, os e2e e os unitários da API. **Tudo é falso**: `@exemplo.test`, números de
 * `9123456xx`. Só para testes; nada em produção o importa.
 */
import type { components } from "../lib/api/gerado/esquema";
import { eventoDeTeste, type EventoGestao } from "./gestao";

export type ClienteGestao = components["schemas"]["ClienteGestao"];
export type RespostaClientes = components["schemas"]["RespostaClientes"];
export type RespostaResumo = components["schemas"]["RespostaResumo"];

export const EMAIL_DE_120 = `${"a".repeat(110)}@exemplo.test`;
export const EMAIL_DE_80 = `${"m".repeat(68)}@exemplo.test`;
export const NOME_LONGO =
  "Maria Antónia de Albuquerque e Menezes Vasconcelos de Sá Pereira Coutinho";

/** Um cliente falso; só o `id` é obrigatório. Com telemóvel, consentido a 14/11/2026 (Lisboa). */
export function clienteDeTeste(
  parcial: Partial<ClienteGestao> & Pick<ClienteGestao, "id">,
): ClienteGestao {
  const n = String(parcial.id);
  return {
    nome: `Cliente ${n}`,
    email: `cliente${n}@exemplo.test`,
    telemovel: `9123456${n.slice(-2).padStart(2, "0")}`,
    consentimento_em: "2026-11-14T10:30:00Z",
    versao_termos: "2026-01",
    criado_em: "2026-11-14T10:30:05Z",
    ...parcial,
  };
}

/**
 * Os quatro clientes das capturas, do mais recente para o mais antigo (como o servidor):
 *  - 101 «Ana Exemplo», com telemóvel, 14 de novembro de 2026;
 *  - 102 «Rui Teste», **sem telemóvel**, 2 de março de 2025 (o ano de outro ano tem de aparecer);
 *  - 103 nome longo e consentimento às 23:30Z de 14/7/2026: em Lisboa já é **15 de julho** (verão);
 *  - 104 email de 80 letras sem espaços.
 */
export function clientesDeTeste(): ClienteGestao[] {
  return [
    clienteDeTeste({
      id: 101,
      nome: "Ana Exemplo",
      email: "ana@exemplo.test",
      telemovel: "912345678",
    }),
    clienteDeTeste({
      id: 102,
      nome: "Rui Teste",
      email: "rui@exemplo.test",
      telemovel: null,
      consentimento_em: "2025-03-02T09:00:00Z",
    }),
    clienteDeTeste({
      id: 103,
      nome: NOME_LONGO,
      email: "maria.longa@exemplo.test",
      telemovel: "912345603",
      consentimento_em: "2026-07-14T23:30:00Z",
    }),
    clienteDeTeste({ id: 104, nome: "Rita Comprida", email: EMAIL_DE_80, telemovel: "912345604" }),
  ];
}

/** Duas «Anas» com o mesmo nome: o email é o que as distingue (spec 7.1). */
export function duasAnas(): ClienteGestao[] {
  return [
    clienteDeTeste({ id: 201, nome: "Ana Exemplo", email: "ana.um@exemplo.test" }),
    clienteDeTeste({ id: 202, nome: "Ana Exemplo", email: "ana.dois@exemplo.test" }),
  ];
}

/** `n` clientes com ids `n … 1` (o mais recente primeiro), nomes `Cliente k`. */
export function muitosClientes(n: number): ClienteGestao[] {
  return Array.from({ length: n }, (_, i) => clienteDeTeste({ id: n - i }));
}

/** Os três eventos do Início das capturas (publicados, daqui para a frente de 2/11/2026). */
export function eventosDoResumo(n = 3): EventoGestao[] {
  return [
    eventoDeTeste({ id: 11, titulo: "Fado ao vivo", inicio: "2026-11-05T22:00:00Z" }),
    eventoDeTeste({ id: 12, titulo: "Karaoke de teste", inicio: "2026-11-06T00:30:00Z" }),
    eventoDeTeste({ id: 13, titulo: "Sessão de jazz", inicio: "2026-11-12T22:00:00Z" }),
  ].slice(0, n);
}

export function resumoDeTeste(parcial: Partial<RespostaResumo> = {}): RespostaResumo {
  return {
    fotos_pendentes: 3,
    proximos_eventos: eventosDoResumo(3),
    novos_registos: 2,
    ...parcial,
  };
}

export function resumoVazio(): RespostaResumo {
  return { fotos_pendentes: 0, proximos_eventos: [], novos_registos: 0 };
}

const BOM = [0xef, 0xbb, 0xbf];

/** Um CSV como o do servidor: BOM, `;`, CRLF e acentos (UTF-8 de vários bytes). */
export function csvDeTeste(): Uint8Array {
  const texto =
    "id;nome;email;telemovel;consentimento_em;versao_termos;criado_em\r\n" +
    "101;José Ânimo;jose@exemplo.test;912345678;2026-11-14T10:30:00Z;2026-01;2026-11-14T10:30:05Z\r\n" +
    "102;Conceição Ñandú;conceicao@exemplo.test;;2025-03-02T09:00:00Z;2025-01;2025-03-02T09:00:04Z\r\n";
  return Uint8Array.from([...BOM, ...new TextEncoder().encode(texto)]);
}

/** BOM e depois **todos** os 256 valores de byte (UTF-8 inválido incluído): nada pode ser «descodificado». */
export function csvBinario(): Uint8Array {
  return Uint8Array.from([...BOM, ...Array.from({ length: 256 }, (_, i) => i)]);
}

/** Um CSV grande (um `String.fromCharCode(...bytes)` ingénuo rebenta a pilha por volta dos 125 000). */
export function csvGrande(bytes = 300_000): Uint8Array {
  const corpo = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 1) corpo[i] = 0x41 + (i % 26);
  corpo.set(BOM, 0);
  return corpo;
}

export function base64De(bytes: Uint8Array): string {
  let texto = "";
  for (const b of bytes) texto += String.fromCharCode(b);
  return btoa(texto);
}

export function bytesDeBase64(base64: string): Uint8Array {
  const texto = atob(base64);
  return Uint8Array.from(texto, (c) => c.charCodeAt(0));
}

/** Os bytes de um `data:text/csv;charset=utf-8;base64,…` (lança se o endereço não for esse). */
export function bytesDoEnderecoData(href: string): Uint8Array {
  const m = /^data:text\/csv;charset=utf-8;base64,([A-Za-z0-9+/]*={0,2})$/.exec(href);
  if (m?.[1] === undefined) {
    throw new Error(`o endereço não é um data:text/csv;charset=utf-8;base64: ${href.slice(0, 60)}`);
  }
  return bytesDeBase64(m[1]);
}
