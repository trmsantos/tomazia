import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SETE_FOTOS } from "../src/testes/galeria";
import {
  botaoDeEnviarFoto,
  botaoEnviarUmaFoto,
  campoDeFoto,
  dialogoAberto,
  fingirAGaleria,
  fingirOEnvioDeFotos,
  gerarImagemNaPagina,
} from "./apoio/galeria";

/**
 * A pré-visualização da foto sob a CSP **de produção**.
 *
 * O servidor de desenvolvimento não aplica CSP, por isso um `blob:` em
 * `<img src>` funcionava aqui e era bloqueado em produção
 * (`img-src 'self' data:`, ADR 0008). Este teste serve o pacote construído
 * (porta 8076, ver `playwright.config.ts`) com o cabeçalho **lido de
 * `deploy/htaccess.exemplo`**, e por isso acompanha a CSP se ela mudar.
 */
const BASE = "http://localhost:8076";

function cspDoHtaccess(): string {
  const texto = readFileSync(
    join(import.meta.dirname, "..", "..", "deploy", "htaccess.exemplo"),
    "utf8",
  );
  const linhas = texto
    .split("\n")
    .filter((linha) => /^\s*Header always set Content-Security-Policy\s+"/.test(linha));
  // Uma e só uma: se houver zero ou duas, não sabemos qual é a verdadeira.
  expect(linhas, "tem de haver exatamente uma linha de CSP no htaccess.exemplo").toHaveLength(1);
  const valor = /"([^"]+)"/.exec(linhas[0] ?? "")?.[1];
  expect(valor, "o valor da CSP tem de se conseguir ler").toBeDefined();
  return valor ?? "";
}

async function aplicarACsp(pagina: Page, csp: string): Promise<void> {
  await pagina.route(`${BASE}/`, async (rota) => {
    const resposta = await rota.fetch();
    await rota.fulfill({
      response: resposta,
      headers: { ...resposta.headers(), "content-security-policy": csp },
    });
  });
}

test("com a CSP de produção, a pré-visualização da foto carrega e não há violações", async ({
  page,
}) => {
  const csp = cspDoHtaccess();
  const violacoes: string[] = [];
  page.on("console", (mensagem) => {
    if (/content security policy/i.test(mensagem.text())) violacoes.push(mensagem.text());
  });
  page.on("pageerror", (erro) => {
    violacoes.push(`pageerror: ${erro.message}`);
  });

  await aplicarACsp(page, csp);
  await fingirAGaleria(page, SETE_FOTOS);
  await fingirOEnvioDeFotos(page);
  const resposta = await page.goto(`${BASE}/`);
  expect(
    resposta?.headers()["content-security-policy"],
    "o cabeçalho da CSP tem de ter chegado com o documento",
  ).toBe(csp);

  // O arranque da página não pode ter violações: só depois vem o controlo.
  expect(violacoes, "o arranque da página não pode violar a CSP").toEqual([]);

  // Controlo positivo (regra 10): "sem violações" e "a CSP não foi
  // aplicada" dariam o mesmo verde. Um blob: tem de ser mesmo bloqueado.
  const blobBloqueado = await page.evaluate(
    () =>
      new Promise<boolean>((resolver) => {
        const url = URL.createObjectURL(new Blob(["x"], { type: "image/gif" }));
        const img = new Image();
        img.onerror = () => {
          resolver(img.naturalWidth === 0);
        };
        img.onload = () => {
          resolver(false);
        };
        img.src = url;
      }),
  );
  expect(blobBloqueado, "a CSP não foi aplicada: um blob: em <img> devia ser bloqueado").toBe(true);
  // A violação deste controlo é esperada; só contam as que vêm a seguir.
  await expect
    .poll(() => violacoes.some((v) => v.includes("blob:")), {
      message: "a violação do controlo (blob:) tem de aparecer na consola",
    })
    .toBe(true);
  violacoes.length = 0;

  await botaoEnviarUmaFoto(page).click();
  await expect(dialogoAberto(page)).toBeVisible();

  const imagem = await gerarImagemNaPagina(page, { largura: 3000, altura: 2000 });
  await campoDeFoto(page).setInputFiles({
    name: "foto.jpg",
    mimeType: "image/jpeg",
    buffer: imagem,
  });
  await expect(botaoDeEnviarFoto(page)).not.toHaveAttribute("aria-disabled", "true", {
    timeout: 15_000,
  });

  const previa = dialogoAberto(page).locator("img");
  await expect(previa).toBeVisible();
  await expect(previa).toHaveAttribute("src", /^data:/);
  await expect
    .poll(() => previa.evaluate((el: HTMLImageElement) => el.naturalWidth), {
      message: "a pré-visualização tem de carregar (naturalWidth > 0)",
    })
    .toBeGreaterThan(0);

  expect(violacoes, "nenhuma violação da CSP na consola").toEqual([]);
});
