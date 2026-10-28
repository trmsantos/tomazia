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
 *
 * Nota sobre `.jsx`: o bloco S-13 em baixo também inclui ficheiros `.jsx`
 * no seu `files`, mas nenhum bloco desta config dá a um ficheiro `.jsx` um
 * parser com JSX ligado — por isso JSX a sério num `.jsx` dá erro fatal de
 * análise (parse error), não um lint normal. Não é um buraco de segurança
 * (falha fechada: o ficheiro não passa de qualquer forma), só não confies
 * neste ficheiro para lint de `.jsx` como se fosse `.tsx`.
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

/**
 * F3-01: nenhum atributo `style` em JSX.
 *
 * A CSP de produção (`deploy/htaccess.exemplo`) serve `style-src 'self'` sem
 * `'unsafe-inline'`, e um `style-src` assim também bloqueia atributos de
 * estilo. O modo de falha é o pior que há neste projeto: o servidor de
 * desenvolvimento do Vite não aplica CSP nenhuma, por isso um `style={{ … }}`
 * funciona na máquina de quem o escreve e parte no servidor, onde ninguém
 * está a olhar. É o mesmo raciocínio do ADR 0008.
 *
 * São três redes independentes, e esta regra é a primeira delas — a mesma
 * contagem que `src/styles/sem-estilo-inline.test.ts` faz:
 *
 *  1. esta regra, que apanha o `style` em JSX enquanto se escreve;
 *  2. a varredura do código em disco, que nenhum `eslint-disable` desliga;
 *  3. a verificação de CSP em `e2e/componentes.spec.ts`, que olha para o
 *     resultado num browser e não para a forma do código.
 *
 * As três existem por causa do buraco conhecido e aceite do seletor: um
 * objeto `{ style }` montado fora do JSX e espalhado com
 * `{...propriedades}`. Alargar o seletor a `Property[key.name='style']`
 * acusaria qualquer objeto com uma chave `style`.
 */
const MENSAGEM_SEM_ESTILO_INLINE =
  "A CSP `style-src 'self'` bloqueia `style` inline em produção. Usa uma classe.";

/**
 * F2-09: `fetch` só dentro de `src/lib/api`.
 *
 * O cliente de `src/lib/api/cliente.ts` é que põe `X-Tomazia: 1`,
 * `credentials: "include"` e a base relativa `/api` em todos os pedidos. Um
 * `fetch` escrito à mão num componente não leva nada disso — e as três
 * consequências aparecem em sítios diferentes e tarde: a mutação é recusada
 * com 403 (S-06), a sessão não vai, e uma origem absoluta é bloqueada pela
 * CSP `connect-src 'self'` **só no servidor** (ADR 0008).
 *
 * São duas regras, de propósito, e não uma:
 *  - `no-restricted-globals` apanha a chamada direta (`fetch(...)`);
 *  - `no-restricted-properties` apanha `window.fetch`, `globalThis.fetch` e
 *    `self.fetch`, que são `MemberExpression` e passam ao lado da primeira.
 *
 * E não é só `fetch`: `XMLHttpRequest` e `navigator.sendBeacon` fazem
 * pedidos HTTP na mesma, sem nenhum dos cabeçalhos do cliente. Não há
 * nenhum no projeto hoje, e as consequências de um estão cobertas por
 * outras camadas (a CSP, o S-06, o cookie de mesma origem) — mas são uma
 * linha cada, e uma regra que só proibisse a forma moderna convidava à
 * antiga.
 *
 * Nenhuma delas é `no-restricted-syntax`: essa já carrega os seletores do
 * S-13 e do estilo inline, e desligá-la dentro de `src/lib/api` (como é
 * preciso fazer com estas) desligava o S-13 lá dentro por arrasto.
 *
 * A terceira rede é a varredura do código em disco, em
 * `src/lib/api/fetch-so-no-cliente.test.ts`, porque um `eslint-disable`
 * desliga estas duas regras e não desliga uma procura de texto.
 */
const MENSAGEM_FETCH_SO_NO_CLIENTE =
  'Pedidos HTTP só dentro de `src/lib/api`. Usa o cliente (`pedir`), que leva `X-Tomazia`, `credentials: "include"` e a base relativa `/api`.';

export default tseslint.config(
  {
    // `src/lib/api/gerado/` é escrito pelo `npm run gerar-api` e não se
    // edita: lintá-lo era acusar o openapi-typescript de não escrever como
    // nós. O resto de `src/lib/api` é código nosso, escrito à mão, e é
    // lintado como qualquer outro — a regra antiga ignorava a pasta inteira
    // e deixou de poder fazê-lo quando o cliente passou a viver lá.
    ignores: ["dist", "coverage", "src/lib/api/gerado"],
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
      //  2. `no-restricted-syntax`, no bloco em baixo, apanha as outras
      //     formas de escrever a mesma chave (fora de JSX).
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
    // esta regra, só ela, cobre as oito extensões que o TypeScript compila
    // e o Vite consome (`.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`,
    // `.mts`, `.tsx`), enquanto o resto da configuração acima fica só em
    // `.ts`/`.tsx`. As extensões de módulo explícitas (`.mts`, `.cts`,
    // `.mjs`, `.cjs`) ficavam de fora do glob original
    // (`**/*.{js,jsx,ts,tsx}`) e passavam pelo bloco sem ser lintadas pela
    // regra S-13 — ver histórico do PR para o caso de teste que provou o
    // buraco. `.d.ts`, `.d.mts` e `.d.cts` ficam cobertos por arrasto, por
    // corresponderem ao glob `*.ts`/`*.mts`/`*.cts`.
    //
    // Nota sobre `.cjs`: antes desta correção, um `.cjs` com
    // `dangerouslySetInnerHTML` já não passava — mas só por acidente, por
    // um erro fatal de análise (o parser por omissão não aceita a sintaxe
    // de alguns ficheiros CommonJS sem `sourceType: "commonjs"` explícito),
    // não porque a regra `no-restricted-syntax` o apanhasse. Se algum bloco
    // futuro desta configuração definir `languageOptions.sourceType:
    // "commonjs"` para `.cjs`, o erro de análise desaparece e, sem este
    // glob incluir `.cjs` explicitamente, o ficheiro voltaria a passar sem
    // ser lintado pela regra S-13. Não contes com o erro de análise como
    // proteção — é o glob alargado abaixo que fecha o buraco a sério.
    files: ["**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"],
    rules: {
      // Cobre cinco formas de escrever a mesma chave:
      //  1. Atributo JSX (`<div dangerouslySetInnerHTML={...} />`).
      //  2. Chave de objeto como identificador
      //     (`{ dangerouslySetInnerHTML: ... }`).
      //  3. Chave de objeto como literal de string
      //     (`{ "dangerouslySetInnerHTML": ... }`).
      //  4. Atribuição por acesso com ponto (`props.dangerouslySetInnerHTML
      //     = ...`) — um `MemberExpression`, não uma `Property` de objeto,
      //     por isso os seletores 2 e 3 não o apanham.
      //  5. Atribuição por acesso com parênteses retos
      //     (`props["dangerouslySetInnerHTML"] = ...`) — também um
      //     `MemberExpression`, mas `computed` (a propriedade é uma
      //     expressão, não um identificador), por isso tem um seletor à
      //     parte do 4.
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
        {
          // Atribuição por acesso com ponto fora de um literal de objeto
          // (`props.dangerouslySetInnerHTML = { __html: ... }`). No AST é
          // um `MemberExpression`, não uma `Property` — os dois seletores
          // acima só olham para dentro de literais de objeto e deixavam
          // passar isto.
          selector: "MemberExpression[property.name='dangerouslySetInnerHTML']",
          message: MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML,
        },
        {
          // Mesma atribuição por `MemberExpression`, mas com acesso
          // computado por parênteses retos e a chave como literal de
          // string (`props["dangerouslySetInnerHTML"] = ...`). Aqui a
          // propriedade é um `Literal` (com `.value`), não um
          // `Identifier` (com `.name`) — o seletor acima não o apanha.
          selector: "MemberExpression[computed=true][property.value='dangerouslySetInnerHTML']",
          message: MENSAGEM_SEM_DANGEROUSLY_SET_INNER_HTML,
        },
        {
          // F3-01: `<div style={{ … }} />`. Ver a nota no topo do ficheiro
          // para o porquê e para o buraco conhecido do seletor.
          selector: "JSXAttribute[name.name='style']",
          message: MENSAGEM_SEM_ESTILO_INLINE,
        },
      ],
    },
  },
  {
    // F2-09: `fetch` fora de `src/lib/api` é erro. Ver
    // `MENSAGEM_FETCH_SO_NO_CLIENTE`, acima, para o porquê das duas regras.
    // O glob é o mesmo das oito extensões do bloco S-13, e pela mesma razão:
    // um `.mjs` ou um `.cts` chamam `fetch` tão bem como um `.tsx`.
    files: ["**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
        { name: "XMLHttpRequest", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "fetch", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
        { object: "globalThis", property: "fetch", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
        { object: "self", property: "fetch", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
        // Estas duas vão sem `object`, o que as proíbe venha de onde vier:
        // apanham `navigator.sendBeacon` e `window.navigator.sendBeacon` de
        // uma vez (no segundo, o objeto é um `MemberExpression`, e um par
        // `object`/`property` não lhe chegaria). Dá para as escrever assim
        // porque nenhuma delas tem outro significado — ao contrário de
        // `fetch`, que como nome de método de um objeto nosso é inocente e
        // por isso fica preso só aos três objetos globais, acima.
        { property: "XMLHttpRequest", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
        { property: "sendBeacon", message: MENSAGEM_FETCH_SO_NO_CLIENTE },
      ],
    },
  },
  {
    // O cliente é o único sítio onde `fetch` é permitido — é essa a regra, e
    // esta exceção é o que a torna uma regra de sítio e não uma proibição.
    // `src/lib/api/gerado/` nem chega aqui (está nos `ignores`).
    files: ["src/lib/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
  {
    // `ferramentas/*.mjs` corre no Node, não no browser: sem os globais do
    // Node, o `no-undef` do `js.configs.recommended` acusava `process`,
    // `console` e companhia. Fica fora do bloco de `.ts`/`.tsx` de propósito
    // — não quer o `typescript-eslint` nem as regras do React.
    files: ["ferramentas/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  // Por último, para desligar as regras de formatação do ESLint que
  // conflituariam com o Prettier (que trata da formatação a sério).
  eslintConfigPrettier,
);
