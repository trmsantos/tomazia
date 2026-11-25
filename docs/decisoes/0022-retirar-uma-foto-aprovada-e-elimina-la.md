# 0022. Retirar uma foto aprovada é eliminá-la, com o ficheiro apagado antes do commit

- Data: 2026-11-24
- Estado: aceite (Tomás, 2026-11-24)

## Contexto

Até à F4-04, aprovar e rejeitar só atuam sobre fotos `pendente`, e nenhuma
linha de `fotos` se apaga (docstring de `app/services/fotos.py`). Uma foto
aprovada por engano, ou cuja retirada um cliente peça (RGPD), ficava em
`public_html/media/` e no `GET /galeria` para sempre, salvo por SSH.

O Tomás decidiu a 16 de novembro de 2026 (`docs/TAREFAS.md`, F4-04b) que a
foto aprovada pode ser retirada e que retirar é eliminar: apaga-se o ficheiro
de `MEDIA_DIR` e a linha. A linha pode ir embora porque o limite de envios
conta `tentativas_de_envio`, não `fotos` (ADR 0018, que já o previa).

Falta decidir a ordem. São dois efeitos, um no disco e outro no SQLite, sem
transação que os junte, e a F4-04b exige: um ficheiro que já não está no disco
elimina a linha; um ficheiro que não se conseguiu apagar responde erro e mantém
a linha (regra 10).

## Decisão

**`DELETE /gestao/fotos/{id}`, só para fotos `aprovada`, faz, numa transação:
`DELETE` condicional da linha → apagar o ficheiro → `commit`.**

1. `DELETE FROM fotos WHERE id = :id AND estado = 'aprovada'`, a ler o
   `rowcount` (o padrão de `aprovar`). Sem linha apanhada, `rollback` e
   nenhum ficheiro é tocado.
2. `unlink` de `MEDIA_DIR/<ficheiro>`, com a transação ainda aberta:
   - `FileNotFoundError`: o ficheiro já não estava lá. Segue, e a linha vai.
   - qualquer outro `OSError`, ou um `ficheiro` que não bate com
     `PADRAO_NOME_DE_FICHEIRO`: `rollback`, a linha fica, responde `500`
     `foto_nao_eliminada`.
3. `commit`. Se falhar, `rollback` e o erro sobe. O ficheiro já não existe e
   a linha continua `aprovada`.

O estado que sobra dessa última falha (linha sem ficheiro) é o mesmo que o
passo 2 trata como "já ausente". Repetir o pedido resolve-o: o dono recebeu um
erro e volta a tocar em "Eliminar". O que nunca pode acontecer é o inverso:
linha apagada e ficheiro ainda servido pelo Apache.

## Consequências

- O RGPD fica do lado seguro. Em qualquer falha, os bytes ou já foram apagados
  ou a linha fica e o dono vê o erro. Nunca há uma foto servida em `media/`
  sem linha que a mostre na gestão.
- Durante a janela entre uma falha do `commit` e a repetição, o `GET /galeria`
  lista uma foto sem ficheiro, e a galeria pública mostra-a partida. A falha
  provável é um "database is locked" depois do `busy_timeout`.
- A frase "a linha de `fotos` nunca se apaga" deixa de ser verdade para as
  aprovadas. Para as rejeitadas continua (a F4-04b não as toca).
- `_caminho_seguro` não pode decidir aqui. Devolve `None` tanto para "não
  existe" como para "nome fora do padrão" ou "ligação simbólica", que é a
  confusão que a regra 10 proíbe.
- Quem já viu a foto pode tê-la na cache do browser. O `htaccess.exemplo` não
  dá `Cache-Control` a `media/`. Fica fora desta decisão.

## Alternativas consideradas

- **Linha primeiro (`commit`), ficheiro depois.** É a ordem do `rejeitar`.
  Se o `unlink` falhar, a linha já se foi e o ficheiro continua público em
  `media/`, sem nada na gestão que permita tentar outra vez. Contraria o
  "Feito quando" da tarefa.
- **Pôr o ficheiro de lado antes do `commit`** (mover para uma pasta fora de
  `public_html` e apagá-lo só depois do `commit`), para o poder repor se o
  `commit` falhar. Fecha a janela da foto partida, mas acrescenta uma pasta e
  um terceiro estado. Se o `unlink` final falhar, os bytes de um terceiro
  ficam no disco depois de a resposta dizer que foram eliminados, que é pior
  para o RGPD do que uma imagem partida até à repetição.
- **Ocultar em vez de eliminar** (um estado novo ou uma coluna `oculta`).
  Afastada pelo Tomás a 16 de novembro: retirar é eliminar. Era também uma
  mudança de modelo de dados.
