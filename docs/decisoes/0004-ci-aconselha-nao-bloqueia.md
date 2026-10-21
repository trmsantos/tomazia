# 0004. O CI aconselha, não bloqueia

- Data: 2026-10-21
- Estado: aceite

## Contexto

O repositório é privado numa conta pessoal. As regras de proteção de branch exigem GitHub Pro: a API devolve 403 a qualquer tentativa de as ler ou criar. Sem elas, nenhum check pode impedir um merge — os três primeiros PRs do projeto foram fundidos sem verificação automática nenhuma, porque até à F1-03 não havia CI.

A `docs/TAREFAS.md` já põe as regras de proteção no "Feito quando" da F1-05, portanto o Pro está no caminho crítico do projeto. A questão é quando, não se.

## Decisão

O `ci.yml` corre em `pull_request` e em `push` para a `main`, e termina num job `resumo` que agrega os outros quatro. O nome `resumo` é contrato estável: será o único check marcado como obrigatório no dia em que houver Pro.

Até lá, o portão real continua a ser local — `/verificar` e `/pronto-para-merge` antes de abrir o PR. O CI é a rede por baixo do "na minha máquina passa": versões de Node e de Python diferentes, cache suja, ficheiro por versionar.

## Consequências

- O `push` para a `main` não é redundante com o `pull_request`: é o que apanha um merge feito por cima de checks vermelhos, e é a precondição do `deploy.yml` da F1-04.
- Acrescentar ou dividir jobs nunca obriga a mexer na lista de checks exigidos, porque essa lista terá um nome só.
- O `resumo` não se renomeia.
- A partir da F1-04, um merge vermelho passa a ser um **deploy** vermelho. Isso data a compra do Pro: antes do merge da F1-04.
- Enquanto o CI for consultivo, saltar o `/pronto-para-merge` não é uma pressa, é tirar a única verificação que existe.

## Alternativas consideradas

- **Esperar pelo Pro para escrever o CI**: deixaria o projeto mais tempo sem verificação nenhuma, que é o estado que esta tarefa existe para acabar.
- **Marcar os cinco jobs como obrigatórios quando houver Pro**: cada job novo ou renomeado passaria a exigir uma edição das regras do repositório, num sítio que não está no controlo de versões.
- **Um job único em vez de cinco**: pouparia uns minutos faturados, mas serializa o relógio e esconde metade da informação — uma falha de lint impediria de ver que o typecheck também está partido, e paga-se outro ciclo de PR por cada.
