---
name: adr
description: Regista uma decisão de arquitetura em docs/decisoes/.
argument-hint: "[título da decisão]"
disable-model-invocation: true
---

Cria `docs/decisoes/NNNN-<slug>.md`, em que NNNN é o número seguinte ao último ficheiro da pasta, para a decisão: **$ARGUMENTS**.

Estrutura, numa página no máximo:

```markdown
# NNNN. Título

- Data: AAAA-MM-DD
- Estado: proposta | aceite | substituída por NNNN

## Contexto
O problema e as restrições, em factos.

## Decisão
O que se decidiu, numa ou duas frases.

## Consequências
O que fica mais fácil, o que fica mais difícil, o que passa a ser obrigatório.

## Alternativas consideradas
Cada uma com a razão por que não foi escolhida.
```

O estado fica "proposta" até o Tomás o aceitar no PR. Se a decisão substitui outra, atualiza o estado da antiga.
