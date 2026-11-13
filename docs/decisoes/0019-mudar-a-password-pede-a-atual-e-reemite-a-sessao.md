# 0019. Mudar a password pede a atual, conta para o bloqueio e reemite a sessão

- Data: 2026-11-13
- Estado: proposta

Complemento ao [ADR 0016](0016-o-logout-revoga-por-versao-da-sessao.md): usa o
mesmo mecanismo (`admins.sessao_versao`) para uma segunda forma de revogar
sessões.

## Contexto

A F2-05 precisa de uma rota para o dono mudar a password na área de gestão
(`POST /gestao/conta/password`, F4-05). Uma rota destas é uma superfície de
ataque nova sobre a conta única do bar, e três perguntas não têm resposta
óbvia:

- **Um cookie roubado** (um telemóvel esquecido, um computador partilhado;
  12 horas de validade) bastava para mudar a password e ficar com a conta, se a
  rota não pedisse nada mais.
- **O bloqueio do S-07** (cinco falhas, 15 minutos) protege o login. Uma rota
  que verificasse a password atual sem passar por ele seria um sítio para
  adivinhar a password sem limite, com o tal cookie, a contornar o S-07.
- **As outras sessões:** com cookie assinado, uma sessão sobrevive a tudo o que
  não a revogue. Mudar a password para se proteger de um cookie roubado e
  deixá-lo a servir 12 horas seria a aparência de segurança sem a entregar
  (o padrão do ADR 0016).

## Decisão

`POST /gestao/conta/password`, debaixo de `/gestao` (herda `exigir_admin` e
entra no S-04 por construção). Corpo `{password_atual, password_nova}`, de 1 a
1024 caracteres cada, **sem `utilizador`**: muda a password de quem tem a
sessão, nunca a de outra conta. Não há regra de complexidade, como no
`criar_admin.py`: só a password nova vazia é recusada.

1. **Pede a password atual.** Errada → `400 password_atual_errada`, com
   `campo: "password_atual"`.
2. **A atual conta para o mesmo bloqueio do login.** O contador é um só, por
   conta (`tentativas_falhadas`, `bloqueado_ate`), numa função comum a esta rota
   e ao login (`verificar_com_bloqueio`): cinco falhas, somadas entre os dois
   sítios, bloqueiam; com a conta bloqueada a resposta é `429 conta_bloqueada`
   (com `segundos_em_falta` e `Retry-After`) **sem verificar nada**. A sessão já
   aberta sobrevive ao bloqueio (decisão da F2-04). Um `422` (corpo inválido)
   não conta como falha.
3. **As outras sessões terminam pelo `sessao_versao`.** Um só
   `UPDATE admins SET hash_password=?, sessao_versao=sessao_versao+1,
   tentativas_falhadas=0, bloqueado_ate=NULL WHERE id=? AND sessao_versao=?`,
   com a versão que a sessão tinha quando o `exigir_admin` a confirmou. Zero
   linhas afetadas quer dizer que a sessão foi revogada entretanto (um logout
   noutro separador): `401 sessao_em_falta`, sem mudar nada e sem reemitir
   sessão. Sem a condição, uma sessão já revogada mudava a password e ganhava
   uma sessão nova.
4. **A sessão de quem muda continua.** A resposta (`200`, `{id, utilizador}`)
   traz um cookie novo, assinado com a versão nova e com os mesmos atributos do
   login (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, 12
   horas), definidos num só sítio (`definir_cookie_de_sessao`).

Não reutiliza o `mudar_password` de `scripts/criar_admin.py` (F2-02), que lê,
altera e escreve sem verificar a versão: serve a quem tem acesso ao servidor
por SSH, onde não há cookie a proteger.

## Consequências

- O login e esta rota partilham um contador: um atacante que gaste as cinco
  tentativas por aqui bloqueia também o login do dono durante 15 minutos. É o
  custo de não haver dois contadores, e é o mesmo que já acontece com o login.
- A resposta traz `Set-Cookie`: o frontend (F4-05) não precisa de iniciar
  sessão outra vez, mas tem de aceitar que o cookie mudou.
- Mudar a password mata **todas** as outras sessões da conta, o que com uma
  conta só não custa nada.

## Alternativas descartadas

- **Não pedir a atual:** um cookie roubado chegava para ficar com a conta.
- **Pedir a atual sem a contar para o bloqueio:** contorna o S-07.
- **Um contador separado para esta rota:** o dobro das tentativas para quem
  adivinha, e mais um sítio onde a regra pode divergir.
- **Terminar também a sessão de quem muda:** obrigava a entrar outra vez sem
  ganhar segurança nenhuma.
