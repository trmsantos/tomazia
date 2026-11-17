// @vitest-environment node
/**
 * F4-05a, plano 3.3 e 5.1 + decisão D4 do Tomás — a validação local dos seis
 * textos, espelho do backend (`backend/app/schemas/gestao.py`).
 *
 * Contrato (`src/pages/gestao/definicoes/validar-campos.ts`):
 *
 * ```ts
 * export type CampoDeLink = "instagram" | "maps_url";
 * export function contarPontosDeCodigo(texto: string): number;          // [...texto].length, nunca .length
 * export function validarTexto(valor: string): string | undefined;      // rede, password, morada, telefone → o erro, ou undefined
 * export function normalizarLink(valor: string): string;                // D4, ver abaixo
 * export function validarLink(valor: string, campo: CampoDeLink): string | undefined;  // valida o texto TAL COMO ESTÁ
 * ```
 *
 * **`normalizarLink` (D4, só nos dois links; no WiFi nunca):** apara as pontas;
 * `""` fica `""`; um texto que **já tem esquema** (`/^[a-z][a-z0-9+.-]*:/i`) fica
 * como está, **exceto** `http://` (qualquer capitalização), que passa a `https://`;
 * um texto que começa por `@` ou `/` fica como está (o erro vem da validação);
 * qualquer outro texto leva `https://` à frente. O ecrã faz `validarLink(normalizarLink(x))`
 * e envia `normalizarLink(x)`.
 *
 * **`validarLink` não normaliza**: é o que o backend vê. Ordem dos erros: `@nome` →
 * `erroLinkArroba`; carácter ≤ U+0020 ou U+007F em qualquer sítio → `erroLinkEspacos`;
 * não começa por `https://` (sem distinguir maiúsculas) → `erroLinkEsquema`; sem
 * anfitrião, ou com `utilizador@` → `erroLinkIncompleto`; Instagram com anfitrião
 * (com porta, em minúsculas) que não é `instagram.com` nem `www.instagram.com` →
 * `erroLinkInstagram`; mais de 500 pontos de código → `erroLinkLongo`.
 *
 * **Segurança (a regra 5 é do backend; o PR diz porquê):** só `https://` sai daqui.
 * Nenhum `javascript:`/`data:` chega a ser aceite — nem depois de normalizar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FICHEIRO_DE_ORIGEM_DOS_LINKS,
  INSTAGRAM_ACEITES_PELO_BACKEND,
  INSTAGRAM_RECUSADOS_PELO_BACKEND,
  PERIGOSOS_DO_BACKEND,
} from "../../../testes/links-do-backend";
import { RAIZ_FRONTEND } from "../../../testes/percorrer-arvore";
import {
  contarPontosDeCodigo,
  normalizarLink,
  validarLink,
  validarTexto,
  type CampoDeLink,
} from "./validar-campos";
import { TEXTOS } from "./textos";

const CAMPOS: readonly CampoDeLink[] = ["instagram", "maps_url"];

describe("contarPontosDeCodigo", () => {
  it("um emoji conta um, como no `len` do Python", () => {
    expect(contarPontosDeCodigo("😀")).toBe(1);
    expect(contarPontosDeCodigo("😀".repeat(200))).toBe(200);
    expect(contarPontosDeCodigo("abc")).toBe(3);
    expect(contarPontosDeCodigo("")).toBe(0);
  });
});

describe("validarTexto: rede, password, morada, telefone", () => {
  it("200 pontos de código passam, 201 não", () => {
    expect(validarTexto("a".repeat(200))).toBeUndefined();
    expect(validarTexto("a".repeat(201))).toBe(TEXTOS.erroTextoLongo);
  });

  it("200 emojis passam (são 400 unidades UTF-16) e 201 não", () => {
    expect("😀".repeat(200).length).toBe(400);
    expect(validarTexto("😀".repeat(200))).toBeUndefined();
    expect(validarTexto("😀".repeat(201))).toBe(TEXTOS.erroTextoLongo);
  });

  it.each([
    ["\\n no meio", "a\nb"],
    ["\\r no meio", "a\rb"],
    ["\\r\\n", "a\r\nb"],
    ["\\n no fim", "abc\n"],
  ])("quebra de linha (%s) é recusada", (_nome, valor) => {
    expect(validarTexto(valor)).toBe(TEXTOS.erroTextoQuebra);
  });

  it("vazio é aceite (nenhum destes campos é obrigatório)", () => {
    expect(validarTexto("")).toBeUndefined();
  });

  it("espaços nas pontas são aceites (a rede e a password guardam-se tal e qual)", () => {
    expect(validarTexto(" rede ")).toBeUndefined();
    expect(validarTexto("   ")).toBeUndefined();
    expect(validarTexto("abc ")).toBeUndefined();
  });

  it("texto livre: o telefone não tem formato", () => {
    expect(validarTexto("912 345 678 (depois das 17h)")).toBeUndefined();
  });
});

describe("a tabela copiada do backend (sentinela de deriva)", () => {
  it("o ficheiro do backend ainda tem as mesmas 24 entradas em PERIGOSOS", () => {
    const origem = readFileSync(join(RAIZ_FRONTEND, "..", FICHEIRO_DE_ORIGEM_DOS_LINKS), "utf-8");
    const bloco = /PERIGOSOS = \[\n([\s\S]*?)\n\]/.exec(origem);
    expect(bloco, "não encontrei PERIGOSOS no ficheiro do backend").not.toBeNull();
    const entradas = (bloco?.[1] ?? "").split("\n").filter((linha) => /^\s+"/.test(linha));
    expect(entradas).toHaveLength(PERIGOSOS_DO_BACKEND.length);
    expect(PERIGOSOS_DO_BACKEND.length).toBe(24);
  });
});

describe.each(CAMPOS)("validarLink (%s): paridade com o backend", (campo) => {
  it.each(PERIGOSOS_DO_BACKEND.map((v) => [JSON.stringify(v).slice(0, 44), v] as const))(
    "PERIGOSOS %s é recusado",
    (_nome, valor) => {
      const erro = validarLink(valor, campo);
      expect(erro, "o backend responde 422 a este valor").toBeDefined();
      expect(erro).not.toBe("");
    },
  );

  it("vazio é aceite (apaga o campo)", () => {
    expect(validarLink("", campo)).toBeUndefined();
  });

  it("https:// e o esquema em maiúsculas são aceites", () => {
    expect(validarLink("https://www.instagram.com/x", campo)).toBeUndefined();
    expect(validarLink("HTTPS://www.instagram.com/exemplo", campo)).toBeUndefined();
    expect(validarLink("HTTPS://INSTAGRAM.COM/x", campo)).toBeUndefined();
  });

  it("500 pontos de código passam, 501 não", () => {
    const base = "https://www.instagram.com/";
    expect(validarLink(base + "a".repeat(500 - base.length), campo)).toBeUndefined();
    expect(validarLink(base + "a".repeat(501 - base.length), campo)).toBe(TEXTOS.erroLinkLongo);
  });

  it("os 500 contam-se em pontos de código, não em unidades UTF-16", () => {
    const base = "https://www.instagram.com/";
    const quinhentos = base + "😀".repeat(500 - base.length);
    expect(contarPontosDeCodigo(quinhentos)).toBe(500);
    expect(quinhentos.length).toBeGreaterThan(500);
    expect(validarLink(quinhentos, campo)).toBeUndefined();
    expect(validarLink(quinhentos + "😀", campo)).toBe(TEXTOS.erroLinkLongo);
  });
});

describe("validarLink: cada linha da tabela de erros, na ordem", () => {
  it.each(CAMPOS)("%s: espaço, tabulação ou controlo no meio → «não pode ter espaços»", (campo) => {
    expect(validarLink("https://www.instagram.com/a b", campo)).toBe(TEXTOS.erroLinkEspacos);
    expect(validarLink("https://www.instagram.com/a\tb", campo)).toBe(TEXTOS.erroLinkEspacos);
    expect(validarLink("https://www.instagram.com/a\u0000b", campo)).toBe(TEXTOS.erroLinkEspacos);
    expect(validarLink("https://www.instagram.com/a\u007fb", campo)).toBe(TEXTOS.erroLinkEspacos);
    expect(validarLink(" https://www.instagram.com/x", campo)).toBe(TEXTOS.erroLinkEspacos);
  });

  it.each(CAMPOS)(
    "%s: http://, javascript:, data:, ftp: → «tem de começar por https://»",
    (campo) => {
      for (const valor of [
        "http://www.instagram.com/x",
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        "data:text/html,x",
        "ftp://exemplo.test/x",
        "instagram.com/x",
      ]) {
        expect(validarLink(valor, campo), valor).toBe(TEXTOS.erroLinkEsquema);
      }
    },
  );

  it.each(CAMPOS)("%s: «@nome» → o erro com a instrução de colar o endereço completo", (campo) => {
    expect(validarLink("@bardatomazia", campo)).toBe(TEXTOS.erroLinkArroba);
  });

  it.each(CAMPOS)(
    "%s: https:// sem anfitrião, ou com utilizador@ → «não está completo»",
    (campo) => {
      for (const valor of [
        "https://",
        "https:///caminho",
        "https://utilizador@instagram.com/x",
        "https://www.instagram.com@evil.example.test/tomazia",
      ]) {
        expect(validarLink(valor, campo), valor).toBe(TEXTOS.erroLinkIncompleto);
      }
    },
  );

  it("instagram: só instagram.com e www.instagram.com — a porta falha, como no backend", () => {
    expect(validarLink("https://instagram.com/x", "instagram")).toBeUndefined();
    expect(validarLink("https://www.instagram.com/x", "instagram")).toBeUndefined();
    expect(validarLink("https://instagram.com:443/x", "instagram")).toBe(TEXTOS.erroLinkInstagram);
    expect(validarLink("https://example.com/x", "instagram")).toBe(TEXTOS.erroLinkInstagram);
    expect(validarLink("https://m.instagram.com/x", "instagram")).toBe(TEXTOS.erroLinkInstagram);
    expect(validarLink("https://instagram.com.evil.example/x", "instagram")).toBe(
      TEXTOS.erroLinkInstagram,
    );
  });

  it("maps_url: qualquer anfitrião https (também os links curtos da aplicação do Google)", () => {
    for (const valor of [
      "https://example.com/x",
      "https://maps.app.goo.gl/exemplo123",
      "https://www.google.com/maps/place/Estarreja",
      "https://m.instagram.com/x",
    ]) {
      expect(validarLink(valor, "maps_url"), valor).toBeUndefined();
    }
  });

  it("instagram: aceita e recusa o mesmo que o backend (os anfitriões)", () => {
    for (const valor of INSTAGRAM_ACEITES_PELO_BACKEND) {
      expect(validarLink(valor, "instagram"), valor).toBeUndefined();
    }
    for (const valor of INSTAGRAM_RECUSADOS_PELO_BACKEND) {
      expect(validarLink(valor, "instagram"), valor).toBeDefined();
    }
  });
});

describe("normalizarLink (D4: aparar as pontas, https:// quando não há esquema)", () => {
  it.each<[string, string, string]>([
    ["apara as pontas", "  https://www.instagram.com/x  ", "https://www.instagram.com/x"],
    [
      "apara tabulação e quebra de linha das pontas",
      "\thttps://www.instagram.com/x\n",
      "https://www.instagram.com/x",
    ],
    [
      "sem esquema: acrescenta https://",
      "instagram.com/bardatomazia",
      "https://instagram.com/bardatomazia",
    ],
    ["com www", "www.instagram.com/x", "https://www.instagram.com/x"],
    ["link curto do Google", "maps.app.goo.gl/abc123", "https://maps.app.goo.gl/abc123"],
    ["apara e acrescenta", "  instagram.com/x ", "https://instagram.com/x"],
    ["http:// passa a https://", "http://www.instagram.com/x", "https://www.instagram.com/x"],
    ["HTTP:// em maiúsculas também", "HTTP://www.instagram.com/x", "https://www.instagram.com/x"],
    ["https:// fica como está", "https://exemplo.test/mapa", "https://exemplo.test/mapa"],
    [
      "a capitalização do resto não se mexe",
      "HTTPS://WWW.INSTAGRAM.COM/X",
      "HTTPS://WWW.INSTAGRAM.COM/X",
    ],
    ["javascript: não leva https:// à frente", "javascript:alert(1)", "javascript:alert(1)"],
    ["data: também não", "data:text/html,x", "data:text/html,x"],
    ["ftp: também não", "ftp://exemplo.test/x", "ftp://exemplo.test/x"],
    ["@nome não se converte", "@bardatomazia", "@bardatomazia"],
    ["@nome apara as pontas e nada mais", "  @bardatomazia ", "@bardatomazia"],
    ["um caminho absoluto não se converte", "/place/tomazia", "/place/tomazia"],
    ["vazio fica vazio", "", ""],
    ["só espaços ficam vazios (apaga o campo)", "   ", ""],
  ])("%s", (_nome, entrada, esperado) => {
    expect(normalizarLink(entrada)).toBe(esperado);
  });

  it("não apara espaços do meio: o erro é dito, o texto não se mexe", () => {
    expect(normalizarLink("https://www.instagram.com/a b")).toBe("https://www.instagram.com/a b");
  });
});

describe("normalizar e depois validar: o que o ecrã faz de verdade", () => {
  function validaDepoisDeNormalizar(valor: string, campo: CampoDeLink): string | undefined {
    return validarLink(normalizarLink(valor), campo);
  }

  it.each<[string, CampoDeLink]>([
    ["instagram.com/bardatomazia", "instagram"],
    ["www.instagram.com/bardatomazia", "instagram"],
    ["http://instagram.com/bardatomazia", "instagram"],
    ["  https://www.instagram.com/x  ", "instagram"],
    ["HTTPS://www.instagram.com/x", "instagram"],
    ["maps.app.goo.gl/abc123", "maps_url"],
    ["  https://maps.example.test/tomazia ", "maps_url"],
    ["", "instagram"],
    ["   ", "maps_url"],
  ])("«%s» (%s) fica aceite", (valor, campo) => {
    expect(validaDepoisDeNormalizar(valor, campo)).toBeUndefined();
  });

  it("«@bardatomazia» continua a ser um erro, com a instrução", () => {
    expect(validaDepoisDeNormalizar("@bardatomazia", "instagram")).toBe(TEXTOS.erroLinkArroba);
    expect(validaDepoisDeNormalizar(" @bardatomazia ", "instagram")).toBe(TEXTOS.erroLinkArroba);
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "\tjavascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "DATA:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://exemplo.test/x",
    "//maps.example.test/x",
    "/place/tomazia",
    "https:maps.example.test",
    "https://",
    "https:///caminho",
  ])("%j nunca chega a ser aceite, nem depois de normalizar (segurança)", (valor) => {
    for (const campo of CAMPOS) {
      expect(validaDepoisDeNormalizar(valor, campo)).toBeDefined();
    }
  });

  it("instagram: um anfitrião de fora continua recusado depois de levar https://", () => {
    expect(validaDepoisDeNormalizar("example.com/x", "instagram")).toBe(TEXTOS.erroLinkInstagram);
    expect(validaDepoisDeNormalizar("instagram.com.evil.example/x", "instagram")).toBe(
      TEXTOS.erroLinkInstagram,
    );
    expect(validaDepoisDeNormalizar("m.instagram.com/x", "instagram")).toBe(
      TEXTOS.erroLinkInstagram,
    );
  });

  it("propriedade: tudo o que for aceite depois de normalizar começa por https:// (sem distinguir maiúsculas)", () => {
    const entradas = [
      ...PERIGOSOS_DO_BACKEND,
      ...INSTAGRAM_ACEITES_PELO_BACKEND,
      "instagram.com/x",
    ];
    for (const valor of entradas) {
      for (const campo of CAMPOS) {
        const normalizado = normalizarLink(valor);
        if (validarLink(normalizado, campo) === undefined && normalizado !== "") {
          expect(normalizado.slice(0, 8).toLowerCase(), valor).toBe("https://");
        }
      }
    }
  });
});
