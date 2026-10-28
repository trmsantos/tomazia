# 0011. Forma do horário em `definicoes`

- Data: 2026-10-27
- Estado: aceite

## Contexto

A especificação diz, no modelo de dados: `definicoes | chave (pk), valor: ... horario (JSON por dia) ...`. "JSON por dia" não é uma forma: não diz se um dia tem um intervalo ou vários, como se escreve "fechado", nem em que fuso estão as horas.

A forma tem de ser decidida na F2-03 porque é aí que `GET /info` a publica, e a partir daí ela é **contrato**: a F2-09 gera o TypeScript, a F3-06 calcula com ela o estado "Aberto até às 02:00" e a F4-05 escreve-a. Mudá-la depois mexe nas três.

A alternativa de a não decidir — devolver em `/info` a string JSON em bruto — empurra a decisão para o frontend sem a eliminar: o TypeScript gerado ficava `horario: string`, e cada ecrã que a lesse inventava a sua própria interpretação, sem validação nenhuma pelo caminho.

## Decisão

`definicoes.horario` guarda exatamente o JSON que `GET /info` publica no campo `horario`: uma lista de **sete** dias, de segunda a domingo, cada um com os seus períodos.

```json
[
  {"dia": "segunda", "periodos": []},
  {"dia": "terca",   "periodos": [{"abre": "17:00", "fecha": "02:00"}]}
]
```

- `dia`: um de `segunda`, `terca`, `quarta`, `quinta`, `sexta`, `sabado`, `domingo`. Sem acentos — é um identificador, não um rótulo; o texto visível ("Terça-feira") é do frontend.
- `periodos`: lista de intervalos. **Lista vazia = fechado nesse dia.**
- `abre` e `fecha`: `"HH:MM"`, 24 horas, **hora de relógio em `Europe/Lisbon`** — nunca instantes, nunca UTC. Um horário é hora de parede: "fecha às 02:00" continua a ser 02:00 na semana a seguir à mudança da hora.
- `fecha < abre` significa **que fecha no dia seguinte** (`17:00`–`02:00` é a noite inteira). `fecha == abre` é inválido e a F2-05 recusa-o na escrita.
- A lista tem sempre os sete dias e sempre por esta ordem. Se o que está guardado vier incompleto ou desordenado, `GET /info` normaliza-o: os dias em falta saem com `periodos: []`.

**`horario` é anulável na resposta, e o `null` não quer dizer "fechado".** `null` = nunca foi configurado; a F3-06 esconde o bloco do horário. Uma lista de sete dias todos com `periodos: []` = configurado e fechado toda a semana — uma afirmação sobre o bar, que só o dono pode fazer. Devolver sete dias fechados a uma instalação acabada de criar seria inventar um facto sobre o bar.

Quando o valor guardado existe mas não passa na validação, `GET /info` devolve `horario: null`, serve os restantes campos e **regista um erro no log com o nome da chave**. O endpoint não devolve 500: um horário mal escrito não pode levar atrás o WiFi, a morada e o telefone, que estão no mesmo ecrã.

## Consequências

- Há um só validador: o mesmo modelo Pydantic lê em `/info` (F2-03) e valida na escrita em `PUT /gestao/definicoes` (F2-05). Depois da F2-05, um valor inválido só entra por edição fora da aplicação.
- "Não configurado" (`null`) e "inválido" (`null` + erro no log) dão a mesma resposta pública e distinguem-se no log e na gestão. É uma exceção consciente à regra 10 do `CLAUDE.md`, e está aqui para ser vista: a alternativa era expor ao público o estado interno de uma definição.
- A F3-06 calcula "Aberto até às 02:00" em `Europe/Lisbon` com testes de relógio fixo, e tem de tratar o caso `fecha < abre`. O caso existe e é o normal neste bar.
- Dois períodos no mesmo dia (almoço e noite) cabem sem mudar nada. Era o que a forma `{abre, fecha, fechado}` não permitia sem um contrato novo.
- Não há coluna nova nem migração: `definicoes.valor` é `Text` e continua a guardar uma string.
- **A password do WiFi sai em texto no mesmo `GET /info`, para qualquer pessoa na internet.** Vem da especificação (é o ecrã do QR code na mesa), e o Tomás confirmou-o explicitamente ao decidir esta tarefa, depois de lhe ser dito que fica legível por quem nunca entrou no bar e indexável por motores de busca. Fica registado para que ninguém, mais tarde, o tome por descuido — e para que mudar de ideias seja uma decisão com data, não uma correção envergonhada.

## Alternativas consideradas

- **`/info` devolve a string JSON em bruto**: nenhuma decisão tomada hoje, a decisão tomada três vezes depois, sem validação em lado nenhum.
- **Um objeto por dia (`{"segunda": {...}}`) em vez de uma lista**: perde a ordem (a ordem das chaves de um objeto JSON não é contrato) e obriga o frontend a reordenar a semana à mão.
- **`{abre, fecha, fechado}` por dia, sem lista de períodos**: mais simples hoje, impossível de estender a dois períodos sem partir o contrato gerado.
- **Horas em UTC**: estaria errado uma hora durante metade do ano, ou obrigaria a converter um horário semanal instante a instante. Um horário não é um instante.
- **Deixar `horario` fora da F2-03 e aterrá-lo na F2-05**: possível (acrescentar um campo a uma resposta não parte o contrato gerado), mas a linha da especificação para `/info` diz "Horário, morada, contactos, WiFi", e a F3-06 ficaria à espera.
