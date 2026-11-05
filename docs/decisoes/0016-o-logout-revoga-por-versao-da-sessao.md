# 0016. O logout revoga pela versão da sessão, não por uma lista em memória

- Data: 2026-11-04
- Estado: aceite

## Contexto

A `docs/ESPECIFICACAO.md`, linha 69, escolheu a forma da sessão:

> cookie de sessão **assinado**, `HttpOnly`, `Secure`, `SameSite=Strict`, 12 horas

Um cookie assinado não guarda estado nenhum do lado do servidor: a validade é
uma data lá dentro, e a prova de autenticidade é a assinatura. A consequência
não é óbvia até alguém a escrever: **o logout não tem como invalidar nada**.
Apaga o cookie do browser que carregou no botão, e mais nada. Um cookie copiado
antes disso continua a servir até expirar.

Na F2-04 isto apareceu por um caminho torto, que vale a pena registar porque é
instrutivo. O teste do logout, escrito antes do código, acabou em:

```python
# Prova final: a sessão antiga já não serve, mesmo que o cliente
# ainda tivesse o cookie original na mão.
cliente_seguro.cookies.set(*nome_e_valor_do_cookie(resposta_login))
resposta_eu = cliente_seguro.get("/auth/eu")
assert resposta_eu.status_code == 401
```

Isto exige revogação do lado do servidor — mais do que a tarefa pedia, e mais
do que um cookie sem estado consegue dar. A implementação satisfê-lo com um
`set[str]` em memória de tokens revogados. **Passava os 946 testes.**

E em produção não funcionava:

- não sobrevive a um reinício do processo;
- não atravessa os processos do Passenger no cPanel — um logout num processo
  não invalida a sessão nos outros;
- cresce sem limite, porque nada o poda.

Ou seja: um mecanismo de segurança que **funciona nos testes e falha em
produção**, e que por isso é pior do que não existir — dá confiança falsa a
quem carrega em "Sair". É o mesmo padrão que este projeto já apanhou noutras
formas (um ramo que só corre em desenvolvimento, um guarda que confunde "não
encontrei" com "não consegui procurar"): o defeito não estava no código que o
teste protegia, estava na distância entre o que o teste provava e o que o
mundo real faz.

## Decisão

A revogação passa a ser uma coluna na base de dados: **`admins.sessao_versao`**,
inteiro, acrescentada por migração aditiva (regra 7).

- O valor assinado do cookie leva a versão, além do `admin_id` e da validade.
- O `exigir_admin` compara a versão do cookie com a versão da linha. Diferente
  → 401, sem distinguir dos outros motivos de recusa.
- O `POST /auth/logout` incrementa a versão. Continua idempotente e continua a
  não exigir sessão: sem cookie válido responde 204 sem tocar na base de dados.
- A verificação vive no `exigir_admin`, onde a linha do `Admin` já é carregada.
  O `ler_sessao` continua puro, sem acesso à base de dados.

## Consequências

**O logout termina todas as sessões daquele admin**, não só a do browser que
carregou no botão. Foi aceite sabendo disso: o bar tem uma conta de admin, e
"sair" terminar tudo é o que quem carrega no botão espera de qualquer maneira.

**A revogação passa a ser real:** sobrevive a reinícios, atravessa processos, e
não guarda nada que cresça sem limite — é um inteiro por conta, não uma lista
de tokens.

**Custa uma consulta que já se fazia.** O `exigir_admin` já carregava o `Admin`
para poder recusar uma sessão cuja conta tivesse sido apagada. A comparação da
versão não acrescenta nenhum acesso à base de dados.

**Abre o caminho à F2-05.** A tabela de endpoints da especificação (linhas
60-67) não tem rota para mudar a password, mas a linha 146 promete o botão em
"Mais › Conta". Quando essa rota existir, mudar a password incrementa a
`sessao_versao` pelo mesmo mecanismo, e as sessões antigas morrem — que é o que
qualquer pessoa espera de mudar uma password, e que com um cookie assinado não
acontece sozinho.

**O que continua a não dar:** um cookie capturado serve até ao próximo logout,
à próxima mudança de password, ou ao fim das 12 horas, o que vier primeiro.
Terminar uma sessão específica sem terminar as outras exigiria guardar uma
linha por sessão, e isso não está nesta app nem faz falta com um admin só.
