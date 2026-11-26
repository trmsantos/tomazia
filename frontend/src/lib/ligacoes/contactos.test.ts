// @vitest-environment node
/**
 * F3-06a, 6.2 a 6.4 e critério 5 — o que é uma ligação e o que é só texto.
 *
 * Contrato (`src/lib/ligacoes/contactos.ts`):
 *
 * ```ts
 * export function ligacaoDoMaps(url: string | null): string | null;                  // o `href`, tal e qual
 * export function ligacaoDoInstagram(url: string | null): { href: string; rotulo: string } | null;
 * export function ligacaoDoTelefone(texto: string | null): string | null;            // o `href`, «tel:…»
 * ```
 *
 * `null` quer dizer «isto não é uma ligação»: o bloco desaparece (4.4) ou, no
 * telefone, fica só texto. Nunca se corrige o que o dono escreveu — uma
 * ligação que só passa depois de a «arranjar» é uma ligação que o dono não
 * escreveu — e **o `href` é a cadeia original, byte a byte**.
 *
 * É a fronteira de segurança do que chega a um `href` (S-13: nada de
 * `javascript:`), por isso cada recusa tem um caso. Cada recusa é distinta de
 * «não consegui procurar»: o guarda de baixo prova que a função aceita o
 * caso feliz antes de se confiar nas recusas.
 *
 * **O que deixa passar:** o que o `href` faz no browser; isso é o e2e.
 */
import { describe, expect, it } from "vitest";

import { ligacaoDoInstagram, ligacaoDoMaps, ligacaoDoTelefone } from "./contactos";

describe("Google Maps: qualquer https válido, tal e qual", () => {
  it.each([
    "https://maps.app.goo.gl/x",
    "https://maps.app.goo.gl/AbC123?g_st=ic",
    "https://www.google.com/maps/place/Bar+da+Tomazia/@40.7,-8.5,17z/data=!4m6",
    "https://www.google.com/maps/@40.7,-8.5,17z",
    "https://exemplo.test/mapa",
    "https://qualquer-anfitriao.pt/x?y=1#z",
    "https://maps.example.test:8443/tomazia",
  ])("aceita %s e devolve-o sem mexer", (url) => {
    expect(ligacaoDoMaps(url)).toBe(url);
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["javascript em maiúsculas", "JAVASCRIPT:alert(1)"],
    ["data", "data:text/html,<b>x</b>"],
    ["http", "http://exemplo.test/x"],
    ["ftp", "ftp://exemplo.test/x"],
    ["tel", "tel:+351912345678"],
    ["espaço à frente", " https://exemplo.test/x"],
    ["espaço atrás", "https://exemplo.test/x "],
    ["espaço dentro do anfitrião", "https://exemplo .test/x"],
    ["quebra de linha no meio (o URL() apaga-a)", "https://exemplo.test/x\ny"],
    ["tabulação no meio", "https://exemplo.test/\tx"],
    ["utilizador@anfitrião", "https://user@exemplo.test/x"],
    ["utilizador:password@anfitrião", "https://user:pw@exemplo.test/x"],
    ["https sem anfitrião (o URL() aceita-o)", "https:///x"],
    ["só o esquema", "https://"],
    ["esquema sem barras", "https:exemplo.test/x"],
    ["sem esquema", "maps.app.goo.gl/x"],
    ["relativo ao protocolo", "//exemplo.test/x"],
    ["vazio", ""],
    ["só espaços", "   "],
    ["texto que não é endereço", "não sei"],
    ["null", null],
  ])("recusa %s", (_nome, url) => {
    expect(ligacaoDoMaps(url)).toBeNull();
  });
});

describe("Instagram: só instagram.com e www.instagram.com, por https", () => {
  it.each([
    ["https://www.instagram.com/bar_tomazia/", "@bar_tomazia"],
    ["https://instagram.com/bar.tomazia", "@bar.tomazia"],
    ["https://instagram.com/Bar_Tomazia?igsh=abc123", "@Bar_Tomazia"],
    ["https://INSTAGRAM.COM/bar_tomazia", "@bar_tomazia"],
    ["https://www.instagram.com/a", "@a"],
    [`https://instagram.com/${"a".repeat(30)}`, `@${"a".repeat(30)}`],
  ])("%s → rótulo %s, com o href tal e qual", (url, rotulo) => {
    expect(ligacaoDoInstagram(url)).toEqual({ href: url, rotulo });
  });

  it.each([
    ["https://instagram.com/p/xyz", "um post"],
    ["https://instagram.com/reel/xyz", "um reel"],
    ["https://instagram.com/reels/xyz", "os reels"],
    ["https://instagram.com/explore/", "o explorar"],
    ["https://instagram.com/stories/bar/123", "as stories"],
    ["https://instagram.com/tv/xyz", "a tv"],
    ["https://instagram.com/", "só a raiz"],
    ["https://www.instagram.com", "a raiz sem barra"],
    ["https://instagram.com/nome-com-hifen", "um hífen não é caractere de nome"],
    [`https://instagram.com/${"a".repeat(31)}`, "31 caracteres"],
    ["https://instagram.com/nome%20com%20espaco", "um segmento com escape"],
  ])("%s → «Ver no Instagram» (%s)", (url) => {
    expect(ligacaoDoInstagram(url)).toEqual({ href: url, rotulo: "Ver no Instagram" });
  });

  it.each([
    ["anfitrião a começar por instagram.com", "https://instagram.com.evil.pt/x"],
    ["instagram.com no caminho", "https://evil.pt/instagram.com"],
    ["instagram.com na pesquisa", "https://evil.pt/?u=instagram.com/x"],
    ["o instagram.com só depois do @", "https://instagram.com@evil.pt/bar"],
    ["outro anfitrião", "https://evil.com/bar"],
    ["terminação parecida", "https://notinstagram.com/x"],
    ["subdomínio que a regra não lista", "https://m.instagram.com/x"],
    ["http", "http://instagram.com/bar"],
    ["javascript", "javascript:alert(1)"],
    ["utilizador@anfitrião", "https://user@instagram.com/bar"],
    ["com porta (a regra da gestão também a recusa)", "https://instagram.com:8080/bar"],
    ["https sem anfitrião", "https:///instagram.com/x"],
    ["@nome", "@bar_tomazia"],
    ["só o nome", "bar_tomazia"],
    ["espaço à frente", " https://instagram.com/bar"],
    ["quebra de linha no meio", "https://instagram.com/b\nar"],
    ["vazio", ""],
    ["só espaços", "  "],
    ["null", null],
  ])("recusa %s", (_nome, url) => {
    expect(ligacaoDoInstagram(url)).toBeNull();
  });
});

describe("telefone: só é ligação se for um número (6.3)", () => {
  it.each([
    ["912 345 678", "tel:912345678"],
    ["234 123 456", "tel:234123456"],
    ["912345678", "tel:912345678"],
    ["+351 234 000 000", "tel:+351234000000"],
    ["+351912345678", "tel:+351912345678"],
    ["00351 234 123 456", "tel:+351234123456"],
    ["(234) 123-456", "tel:234123456"],
    ["234.123.456", "tel:234123456"],
    ["  912 345 678  ", "tel:912345678"],
    ["+351234123456789", "tel:+351234123456789"],
  ])("«%s» → %s", (texto, href) => {
    expect(ligacaoDoTelefone(texto)).toBe(href);
  });

  it.each([
    ["liga-nos"],
    ["Pergunta no balcão"],
    ["234 123 456 (chamada para a rede fixa)"],
    ["12345678"],
    ["1234567890123456"],
    ["+3512341234567890"],
    ["912 345 678 / 912 345 679"],
    ["tel:912345678"],
    ["+351 abc 123 456"],
    ["++351234123456"],
    ["9123-45678x"],
    ["+"],
    ["<script>alert(1)</script>"],
    ["javascript:alert(1)"],
    [""],
    ["   "],
    [null],
  ])("«%s» não é um número: sem ligação", (texto) => {
    expect(ligacaoDoTelefone(texto)).toBeNull();
  });
});
