// @ts-check

/**
 * Configuração ESLint (flat config, ESLint 9).
 *
 * Decisão D-8 (arquiteto): `typescript-eslint` corre em modo `recommended`
 * simples — NUNCA `recommendedTypeChecked`/`strictTypeChecked` — e este
 * ficheiro não define `parserOptions.project` nem `projectService`. Isto é
 * deliberado, não um esquecimento.
 *
 * Motivo: o teste de segurança `src/lib/seguranca/s13.test.ts` chama
 * `ESLint#lintText` com um `filePath` virtual (ex.: `src/exemplo-s13-jsx.tsx`)
 * que não existe no disco, só para a config se aplicar ao conteúdo lintado.
 * Regras "type-aware" precisam de resolver um `tsconfig.json` real a partir
 * desse `filePath` e rebentariam com um caminho inexistente. A verificação
 * de tipos a sério já é feita por `tsc --noEmit` (script `typecheck`), que
 * não tem este problema porque só olha para ficheiros reais.
 *
 * Se um dia esta config precisar de regras type-aware, primeiro converte o
 * S-13 para um ficheiro-fixture real em disco (deixa de poder usar
 * `lintText` com um `filePath` virtual).
 */
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML =
  "Não é permitido `dangerouslySetInnerHTML` (critério S-13).";

export default tseslint.config(
  {
    ignores: ["dist", "coverage", "src/lib/api"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      ...tseslint.configs.recommended,
      reactPlugin.configs.flat.recommended,
      // `jsx: "react-jsx"` no tsconfig.json (novo transform do React) não
      // precisa de `import React` em ficheiros com JSX; sem isto, o
      // `recommended` acima acusa `react/react-in-jsx-scope` em todo o lado.
      reactPlugin.configs.flat["jsx-runtime"],
      jsxA11yPlugin.flatConfigs.recommended,
      // `eslint-plugin-react-hooks` 7.x moveu a config flat para
      // `configs.flat["recommended-latest"]` — `configs["recommended-latest"]`
      // sozinho (usado até à v5) ficou no formato antigo (`plugins` como
      // array de strings), que a flat config do ESLint 9/10 rejeita.
      reactHooksPlugin.configs.flat["recommended-latest"],
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // S-13: proíbe `dangerouslySetInnerHTML` por dois mecanismos
      // independentes — ver `src/lib/seguranca/s13.test.ts`.
      //  1. `react/no-danger` apanha o atributo JSX.
      //  2. `no-restricted-syntax`, no bloco em baixo, apanha o atributo
      //     JSX e a chave de objeto fora de JSX.
      "react/no-danger": "error",
    },
  },
  {
    // S-13 fica num bloco à parte, com `files` mais largo que o bloco
    // principal (acima): o ataque (XSS armazenado via
    // `dangerouslySetInnerHTML`) não precisa de TypeScript nem de JSX — um
    // `.js`/`.jsx` plano também pode construir
    // `{ dangerouslySetInnerHTML: { __html } }` e passá-lo adiante. Alargar
    // o `files` do bloco principal para incluir `.js`/`.jsx` arrastaria
    // consigo o `typescript-eslint recommended` e as regras do React para
    // ficheiros que não os querem — nomeadamente `eslint.config.js`,
    // `postcss.config.js` e `tailwind.config.ts`, na raiz do projeto, que
    // rebentariam com regras pensadas para código de aplicação. Por isso
    // esta regra, só ela, cobre `.js`, `.jsx`, `.ts` e `.tsx`, enquanto o
    // resto da configuração acima fica só em `.ts`/`.tsx`.
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML,
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML,
        },
        {
          // Mesma chave, mas escrita como literal de string
          // (`{ "dangerouslySetInnerHTML": ... }`) em vez de identificador:
          // no AST o `key` passa a ser um `Literal` (com `.value`), não um
          // `Identifier` (com `.name`) — o seletor acima não o apanha.
          selector: "Property[key.type='Literal'][key.value='dangerouslySetInnerHTML']",
          message: MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML,
        },
      ],
    },
  },
  // Por último, para desligar as regras de formatação do ESLint que
  // conflituariam com o Prettier (que trata da formatação a sério).
  eslintConfigPrettier,
);
