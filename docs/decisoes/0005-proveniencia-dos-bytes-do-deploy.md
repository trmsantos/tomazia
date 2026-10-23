# 0005. A proveniência dos bytes que chegam ao servidor

- Data: 2026-10-23
- Estado: aceite

## Contexto

O deploy da F1-04 tem cinco jobs. Um deles, o `montar`, corre `npm ci` — código de terceiros, com escrita em toda a árvore de trabalho do job, não só em `node_modules/`. Outro, o `publicar`, é o único com `contents: write`. Um terceiro, o `pedir`, tem o token da conta cPanel no ambiente.

O desenho inicial montava o pacote inteiro no `montar`, logo a seguir ao `npm ci`, e publicava-o como artefacto. Os jobs seguintes iam buscar a esse artefacto tudo de que precisavam, incluindo os scripts que executam.

Duas revisões de segurança independentes chegaram à mesma conclusão: o artefacto era um canal de contrabando. Um `postinstall` malicioso em qualquer dependência do frontend podia reescrever `backend/app/main.py`, `backend/passenger_wsgi.py`, `backend/requirements.txt` ou `deploy/pedir-deploy.sh` na árvore de trabalho do `montar`, e esses bytes viajavam até ao servidor — onde o Passenger os importa e o `pip` os instala, com o `.env` de produção ao lado.

Os guardas S-12 e S-10 não ajudavam nada, e é importante perceber porquê: eles olham para **nomes de caminho**. Um `main.py` com um backdoor tem o nome certo e passa. O `pip install --require-hashes` também não ajudava — validaria o `requirements.txt` contra os hashes que o próprio atacante tinha escrito.

Uma primeira correção repôs `deploy/` e `.cpanel.yml` a partir de um checkout limpo. Fechava o caminho dos scripts, mas deixava `api/` aberto, que é a porta maior.

## Decisão

Nada do que corre no servidor vem de um job onde correu código de terceiros.

- O job `montar` faz `npm ci && npm run build` e mais nada. O artefacto que publica carrega **só** `frontend/dist`.
- O job `publicar` faz o seu próprio checkout, descarrega esse artefacto, e corre lá `deploy/montar.sh`. O `api/`, o `deploy/` e o `.cpanel.yml` saem todos do clone.
- Os guardas S-12 e S-10 correm no `publicar`, sobre o pacote montado — têm de auditar exatamente os bytes que a seguir são publicados, nunca uma cópia anterior deles.
- Os jobs `pedir` e `verificar` fazem um `actions/checkout` sparse de `deploy/`, do mesmo SHA que o `porteiro` aprovou, com `persist-credentials: false`. Custa `contents: read` em vez de `permissions: {}`.

O `frontend/dist` é a única exceção, e é inevitável: é o que o build produz. A exposição é diferente em espécie — são ficheiros servidos a browsers, nunca importados pelo Passenger nem instalados pelo pip.

## Consequências

- `permissions: {}` deixou de ser possível em dois jobs. É mais permissão no papel e muito menos exposição real, e a troca é deliberada: o raciocínio "permissões mínimas, sem olhar à proveniência dos bytes" foi exatamente o que criou o buraco.
- A montagem passou a correr num job com `contents: write`. O `montar.sh` não corre gestor de pacotes nenhum, e o `publicar` continua proibido de o fazer.
- A branch `deploy` publicada tem de ser, ficheiro a ficheiro, o pacote auditado. O `publicar-branch.sh` indexa com `add -A --force` e `core.excludesFile=/dev/null`, e compara a contagem da árvore escrita com a dos ficheiros do pacote — um `.gitignore` plantado dentro do pacote conseguia, de outra forma, tirar ficheiros do commit sem ninguém dar por isso.
- Um teste prende o artefacto a não carregar nada para lá de `frontend/dist`. Se alguém o alargar, falha — de propósito.

## Alternativas consideradas

- **Estender a reposição a cada caminho de `api/`**: funciona hoje e parte no dia em que o `montar.sh` ganhar um ficheiro novo, porque passa a haver duas listas da disposição do pacote que têm de concordar. Já foi uma discordância dessas que partiu o primeiro deploy desta tarefa.
- **Assinar o artefacto no `montar` e verificar no `publicar`**: a assinatura prova que os bytes não mudaram **depois** do `montar`. O problema é que já estavam comprometidos quando o `montar` os assinou.
- **Correr o `npm ci` com `--ignore-scripts`**: fecha o `postinstall`, mas não o resto do código de terceiros que corre durante o build, e alguns pacotes não constroem sem scripts. Vale como camada adicional, nunca como a única.
