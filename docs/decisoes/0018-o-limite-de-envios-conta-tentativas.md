# 0018. O limite de envios conta tentativas, não fotos aceites

- Data: 2026-11-05
- Estado: aceite
- Substitui: a decisão do Tomás de 5 de novembro registada na F2-06, tomada
  nesse mesmo dia e corrigida horas depois pela medição abaixo.

## Contexto

A especificação fixa **5 envios de foto por hora por IP**. A F2-01 já tinha
criado, na tabela `fotos`, as colunas `ip_hash` e `criada_em`, com um
comentário a dizer que eram para isto. A leitura natural era: contar as
linhas de `fotos` da última hora. Sem tabela nova, sem migração.

**Recomendei essa leitura ao Tomás, e o argumento que usei estava errado.**
Escrevi que as tentativas que uma tabela própria apanharia a mais seriam
"as baratas — recusa no cabeçalho, milissegundos", e que o caminho caro
acabava sempre numa linha, logo sempre limitado.

Depois medi.

## A medição

Um ficheiro PNG de **58 bytes** cujo cabeçalho `IHDR` declara 5400×5400
píxeis — 29,16 MP, **mesmo abaixo** do limite de 30 MP:

1. passa a comparação explícita sobre `im.size`, porque 29 < 30;
2. chega ao `load()`, que aloca o bitmap inteiro — cerca de 90 MB;
3. falha, porque os píxeis não estão lá de verdade;
4. responde `400 imagem_invalida`;
5. **não cria linha nenhuma.**

Três pedidos seguidos levaram o processo de 87 MB para 200 MB de RSS, com
**zero** linhas em `fotos`. Como o balde contava linhas, nunca se gastava:
o pedido repete-se sem fim, anónimo, a partir de 58 bytes.

A amplificação é de cerca de um milhão de vezes, e o caminho de recusa —
que eu tinha descrito como barato — é o mais caro de todos: é o único que
descomprime sem nunca chegar a guardar nada.

## Decisão

**O limite passa a contar tentativas, numa tabela própria**
`tentativas_de_envio(id, ip_hash, criada_em)`, acrescentada por migração
aditiva (regra 7).

O registo da tentativa é a **primeira** instrução de `registar_envio`, e é
commitado logo: antes da validação do tamanho dos campos de texto, antes do
teto de 8 MB, e antes de `imagens.recodificar` tocar num único byte da
imagem. Sobrevive a qualquer exceção posterior, que é precisamente o ponto.

## Consequências

**O custo que eu tinha subestimado passa a estar limitado.** Cinco
tentativas por hora por IP, válidas ou não. O sexto pedido responde 429 sem
descomprimir nada.

**A condição que a decisão anterior trazia desaparece.** Já não é preciso
que "uma linha de `fotos` nunca se apague" para o limite funcionar: o
contador deixou de ser a galeria. Rejeitar continua a apagar os bytes
(ADR da F2-06) e agora também podia apagar a linha sem partir nada —
embora não haja razão para o fazer.

**A tabela cresce com as tentativas, não com a galeria.** Fica por decidir,
numa tarefa futura, quem a poda; uma linha por tentativa é pequena, mas é
a única tabela do projeto que um estranho pode fazer crescer.

**Oito tabelas, não sete.** Havia onze sítios no repositório a dizer "sete
tabelas", incluindo asserções. Foram todos atualizados.

## O que isto diz sobre o processo

O defeito não estava no código: estava numa premissa minha sobre o custo de
um caminho de erro, que eu passei adiante sem a medir. A recomendação era
coerente, bem argumentada, e falsa.

É o terceiro caso nesta semana com a mesma forma — a seguir à lista de
revogação em memória (ADR 0016) e ao `MAX_IMAGE_PIXELS` que só avisa. Em
todos, o que faltava não era rigor no raciocínio. Era uma medição.
