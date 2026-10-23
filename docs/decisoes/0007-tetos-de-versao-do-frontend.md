# 0007. Tetos de versão em quatro dependências do frontend

- Data: 2026-10-23
- Estado: aceite

## Contexto

O Dependabot abriu o PR #6 com quatro subidas agrupadas: `@eslint/js` e `eslint` de 9 para 10, `@types/node` de 22 para 26, e `tailwindcss` de 3.4 para 4.3.

O CI ficou vermelho, mas a falha era enganadora. O `npm ci` rebentava com `ERESOLVE` por causa de uma só das quatro — o `eslint-plugin-jsx-a11y@6.10.2` declara `peer eslint@"^3 || … || ^9"` e não resolve com o eslint 10. Essa falha escondia que outras duas também não deviam entrar, e que nenhuma delas tinha nada a ver com a primeira. Um grupo que falha por um motivo faz com que os outros motivos não cheguem a ser vistos.

Nenhuma das três decisões estava escrita em lado nenhum. A do Tailwind tinha sido tomada em conversa, e a única pista no repositório era a existência de `tailwind.config.ts`, que é uma consequência da decisão e não a decisão.

## Decisão

Quatro `ignore` de major em `.github/dependabot.yml`, no ecossistema npm, cada um com a sua razão e o seu critério de levantamento.

**`tailwindcss`, fica na 3.4.** A v4 não é uma atualização, é outra ferramenta: a configuração passa a ser em CSS e o `tailwind.config.ts` deixa de ser lido. Como os tokens de design do projeto vivem lá (ver `frontend/CLAUDE.md`), subir era reescrever a camada de estilos inteira, não atualizar uma dependência. **Levanta-se** quando houver uma tarefa própria para a migração, com o `tokens.css` e o `tailwind.config.ts` portados e revistos pelo ui-ux — nunca por um PR automático.

**`@types/node`, acompanha o `.nvmrc`.** O ficheiro diz 22; tipos de Node 26 descrevem uma biblioteca padrão que não corremos, e o `tsc` passaria a aceitar código que rebenta em execução. **Levanta-se** no mesmo PR em que o `.nvmrc` subir, nunca antes nem depois.

**`eslint` e `@eslint/js`, ficam no 9.** O `eslint-plugin-jsx-a11y` ainda não declara suporte para o 10, e sem ele o projeto perde as regras de acessibilidade — que são critério Q-03 da especificação, não conforto. **Levanta-se** quando o `eslint-plugin-jsx-a11y` publicar uma versão com `peer eslint` a incluir o 10.

## Consequências

- O PR #6 deixa de ser rebasável e o Dependabot fecha-o sozinho na corrida seguinte. As subidas de minor e patch destes quatro pacotes continuam a chegar normalmente.
- Os tetos são de major, nunca `dependency-name` inteiro: uma correção de segurança num minor continua a passar.
- Três decisões que viviam só na memória de uma conversa passam a estar no repositório, onde um PR automático não as pode desfazer em silêncio. Era isso que faltava: o Dependabot não fez nada de errado, propôs o que a configuração lhe permitia propor.
- Um teste prende o major do `@types/node` ao `.nvmrc`. Dos três tetos é o único cuja violação é silenciosa — o do Tailwind parte o build e o do eslint parte o `npm ci`, mas tipos de Node errados compilam e só falham em execução.

## Alternativas consideradas

- **Desagrupar as dependências de desenvolvimento**, para cada uma vir no seu PR: resolve o sintoma de uma falha esconder as outras, mas enche a fila de PRs todas as semanas e continua a propor as subidas que já sabemos que não queremos.
- **Fixar as versões exatas** em vez de `^`: tira também os patches de segurança, que é o que mais interessa receber automaticamente.
- **`--legacy-peer-deps` no `npm ci`**: fazia o PR #6 ficar verde instalando uma árvore que o próprio npm diz estar errada, e o `eslint-plugin-jsx-a11y` passaria a correr contra um eslint que não suporta. Verde por desligar a verificação é pior do que vermelho.
