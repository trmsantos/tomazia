# 0001. FastAPI no Passenger do cPanel da dominios.pt

- Data: 2026-10-20
- Estado: aceite

## Contexto

O site antigo é PHP no alojamento partilhado da dominios.pt, com cPanel e CloudLinux. O plano inclui Setup Python App (Passenger, só WSGI), 30 processos de entrada, sem Docker e sem root. O Tomás quer backend em Python e frontend em React com TypeScript. O dono paga o alojamento atual.

## Decisão

Backend em FastAPI, servido pelo Passenger através do a2wsgi e montado em `/api`, com SQLite fora do `public_html`. Frontend React compilado no CI e servido pelo Apache como ficheiros estáticos. Requer Python 3.11 ou superior no Setup Python App.

## Consequências

- O contrato da API fica explícito no OpenAPI e gera os tipos do frontend.
- Sem benefícios do modo assíncrono, porque o Passenger corre WSGI; para este tráfego não faz falta.
- Sem trabalhos em segundo plano persistentes; o que for periódico corre em Cron Jobs do cPanel.
- Se o painel só tiver Python 3.9, as dependências ficam presas em versões sem correções, e a decisão tem de ser revista (VPS).

## Alternativas consideradas

- Flask: corre no Passenger sem adaptador, mas não gera o contrato da API com a mesma facilidade.
- Django: precisaria de Python 3.10+ para as versões suportadas e traz mais do que o projeto usa, porque a gestão é feita em React.
- VPS com Docker: mais controlo, mas custo e manutenção extra que o alojamento atual não exige.
