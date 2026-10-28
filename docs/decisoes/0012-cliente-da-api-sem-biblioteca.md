# 0012. Cliente da API sem biblioteca, com base relativa e cabeçalhos sempre

- Data: 2026-10-28
- Estado: aceite

## Contexto

A F2-09 põe todos os pedidos do frontend a sair de um sítio só. A especificação diz o que o cliente tem de enviar (`X-Tomazia: 1`, `credentials: "include"`) mas não diz como é construído, e o espaço que ela não cobre é onde as decisões caras se tomam por omissão.

Três factos condicionam a escolha, e todos foram medidos:

- O orçamento Q-02 é 100 KB comprimidos e o React já gasta 68. Sobram ~32 KB para a ementa, os eventos, a galeria, a pesquisa e os sete componentes base.
- A CSP de produção tem `connect-src 'self'` (`deploy/htaccess.exemplo`). Uma origem absoluta seria bloqueada **só no servidor** — o modo de falha que o ADR 0008 já castigou uma vez.
- O backend declara as rotas **sem** o prefixo `/api`; é o Passenger que o acrescenta por `SCRIPT_NAME`. Em desenvolvimento não há Passenger.

## Decisão

**Sem biblioteca.** `fetch` nativo, numa função `pedir()`, e mais nada. Custo em runtime: os tipos gerados são 0 bytes (só `interface` e `type`, apagados na compilação) e o cliente ronda meio KB. Medido no fim da tarefa: o pacote construído é byte a byte igual ao do início, com o mesmo hash no nome, porque nada o importa ainda.

**Base relativa, `/api`, sempre.** Sem variável de ambiente e sem origem absoluta, por causa da CSP. Em desenvolvimento, o Vite serve de proxy — e com `rewrite`, não só com `target`: sem ele, o `GET /api/ementa` chegaria ao uvicorn tal e qual e daria 404 em tudo. Essa ligação entre o `vite.config.ts` e o caminho base do cliente está presa por teste; é a única coisa escrita em dois sítios.

**`X-Tomazia: 1` e `credentials: "include"` incondicionais.** Hoje só existem quatro GET públicos, e nenhum precisa dos dois. Põem-se à mesma porque o que esta tarefa fixa é o **sítio**, não a mutação: no dia em que a F2-05 acrescentar o primeiro `POST`, o cabeçalho está lá por construção em vez de alguém se lembrar dele. Um cabeçalho condicional seria um ramo que hoje ninguém consegue exercitar, e os ramos por exercitar são onde o S-06 vai falhar. Custa zero: mesma origem, logo nunca há preflight.

**Três falhas distinguíveis**, que é a regra 10 dentro do cliente: *não houve resposta* (rede, `estado` a `null`), *o servidor disse que não* (não-2xx, com o código do envelope quando existir) e *fui eu que cancelei* (o `AbortError` propaga-se tal como veio). Sem a terceira, um `useEffect` a desmontar aparece ao utilizador como erro. Um corpo que não é JSON — a página de erro do Apache num 503 — chega legível, nunca como `SyntaxError`.

## Consequências

- **O verificador de tipos apanha a deriva e não apanha a degenerescência.** Medido: um OpenAPI válido mas **vazio** faz o `openapi-typescript` sair 0 e emitir `Record<string, never>`; e o `tsc --strict` aceita tanto um caminho inventado (`keyof Record<string, never>` é `string`) como um nome de esquema inventado (indexar `never` dá `never`). Por isso a rede está no gerador, que recusa um `paths` vazio, e num teste que lê o ficheiro gerado do disco.
- Há uma regra de lint a proibir `fetch` fora de `src/lib/api`, com uma varredura do código em disco por cima — um `eslint-disable` desliga a regra e não desliga a varredura.
- `src/lib/api` deixa de ser "tudo gerado": só `gerado/` o é. A regra do `frontend/CLAUDE.md` foi alterada em conformidade, no mesmo commit.
- O `openapi-typescript` é dependência de desenvolvimento. Uma subida do Dependabot que mude a saída do gerador põe o job `contrato` vermelho até alguém regenerar — tal como já acontece com o `requirements.txt`. É o comportamento pretendido.
- **Um `overrides` no `package.json`**, e tem data de validade: o `openapi-typescript` 7.13.0 declara `peerDependencies.typescript: "^5"` e este projeto está no TypeScript 6, o que fazia o `npm ci` recusar com `ERESOLVE`. O intervalo deles é que está por atualizar — o gerador corre sem queixa sobre a API de compilação do TS 6, e os testes provam-no em cada corrida. **Sai no dia em que eles abrirem o intervalo.** A alternativa era `--legacy-peer-deps` no `.npmrc`, que desligava a verificação de peers para a árvore inteira — trocar um problema nomeado por um silêncio geral.

## Alternativas consideradas

Todas medidas em KB comprimidos, e todas recusadas pela mesma razão: resolvem um problema que ainda não temos, com peso que já não temos.

- **`openapi-fetch`** (~2 KB) — dependência de runtime para poupar vinte linhas.
- **`zod`** (~13 KB) ou **`valibot`** (~1,5 KB) a validar respostas — duplicam o contrato que o Pydantic já garante do outro lado, e o que falha não é a forma, é a rede.
- **TanStack Query** (~13 KB) ou **SWR** (~5 KB) — cache e revalidação são decisão da F3-02, onde há ecrãs para as justificar.
- **`axios`** (~13 KB) — o `fetch` faz o que precisamos e está no browser.
- **Escrever já as funções das rotas que a especificação prevê** (`/auth/*`, `/gestao/*`, `POST /fotos`): seria um cliente contra uma API que não existe, não verificável por teste nenhum. As funções nascem com as rotas.
