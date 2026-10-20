#!/usr/bin/env bash
# PostToolUse (Edit|Write): formata o ficheiro acabado de alterar. Nunca bloqueia.
f=$(jq -r '.tool_input.file_path // empty')
[[ -z "$f" || ! -f "$f" ]] && exit 0
raiz="${CLAUDE_PROJECT_DIR:-.}"

case "$f" in
  "$raiz"/backend/*.py)
    (cd "$raiz/backend" && uv run ruff format "$f" && uv run ruff check --fix "$f") >/dev/null 2>&1 ;;
  "$raiz"/frontend/*.ts|"$raiz"/frontend/*.tsx|"$raiz"/frontend/*.css|"$raiz"/frontend/*.json)
    (cd "$raiz/frontend" && npx --no-install prettier --write "$f") >/dev/null 2>&1 ;;
esac
exit 0
