---
name: pronto-para-merge
description: Revê o branch atual ou um PR com os agentes revisores e diz se está pronto para merge. Também corre no GitHub em cada PR.
argument-hint: "[número do PR, opcional]"
allowed-tools: Bash(git diff *) Bash(git log *) Bash(gh pr diff *) Bash(gh pr view *) Bash(gh pr comment *)
---

1. Obtém o diff. Com um número de PR em `$ARGUMENTS`, usa `gh pr diff $ARGUMENTS` e `gh pr view $ARGUMENTS`; sem número, `git diff main...HEAD`. Identifica a tarefa pelo ID no título ou no nome do branch.
2. Fora do GitHub Actions (`GITHUB_ACTIONS` diferente de `true`), corre `/verificar`. No GitHub Actions salta este passo, porque o CI já corre.
3. Pede revisão, em paralelo:
   - **revisor-codigo**: sempre.
   - **revisor-seguranca**: quando o diff toca em `backend/`, `deploy/`, `.github/` ou `frontend/src/lib/api`.
   - **ui-ux**: quando toca em `frontend/src/` ou em texto visível.
   - **dominio-bar**: quando muda texto, categorias, eventos ou fluxos do dono.
4. Junta os resultados:

```markdown
## Veredito: PRONTO PARA MERGE | PRECISA DE ALTERAÇÕES

| Revisor | Veredito | Bloqueantes |
| --- | --- | --- |

### Bloqueantes
- `ficheiro:linha` — problema — correção (revisor)

### Sugestões
- no máximo cinco, as mais úteis
```

O veredito só é PRONTO PARA MERGE quando todos os revisores chamados dão APROVADO.

5. No GitHub Actions, publica o resumo no PR com `gh pr comment $ARGUMENTS --body-file -`. Quando um bloqueante aponta para uma linha do diff, publica-o também como comentário nessa linha.

Esta revisão é consultiva. Quem faz merge é o Tomás.
