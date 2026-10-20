#!/usr/bin/env bash
# PreToolUse (Bash): bloqueia comandos que saem do repositório ou mexem em produção.
# Sai com 2 para bloquear; a mensagem em stderr volta para o Claude.
set -uo pipefail

cmd=$(jq -r '.tool_input.command // empty')
[[ -z "$cmd" ]] && exit 0

bloquear() { echo "Bloqueado pelo hook do projeto: $1" >&2; exit 2; }

# Servidor e API do cPanel: só o deploy.yml fala com eles, depois do merge.
if grep -qE '(curl|wget|http[[:space:]]|httpie|python[0-9.]* .*requests)' <<<"$cmd" \
   && grep -qiE '(:2083|dnscpanel|/execute/[A-Za-z]+|cpsess)' <<<"$cmd"; then
  bloquear "pedidos à API do cPanel. O deploy só acontece no deploy.yml."
fi

# Push: nunca para main ou deploy, nunca forçado.
if grep -qE '(^|[;&|[:space:]])git[[:space:]]+push' <<<"$cmd"; then
  grep -qE -- '(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))' <<<"$cmd" && bloquear "force push."
  grep -qE '([[:space:]:/+])(main|deploy)([[:space:]]|$)' <<<"$cmd" && bloquear "push para main ou deploy."
  ramo=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  [[ "$ramo" == "main" || "$ramo" == "deploy" ]] && bloquear "push a partir de $ramo. Cria um branch tarefa/<ID>."
fi

# Merge de PRs: só o Tomás.
grep -qE 'gh[[:space:]]+pr[[:space:]]+merge' <<<"$cmd" && bloquear "merge de PRs. Só o Tomás faz merge."

# Segredos e dados reais.
grep -qE '(^|[[:space:]/=<>])\.env([[:space:]]|$|[<>|;&])' <<<"$cmd" && bloquear "ficheiros .env."
grep -qE '(bd_teste\.db|tomazia_data)' <<<"$cmd" && bloquear "a base de dados real."

exit 0
