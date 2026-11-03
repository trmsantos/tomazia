/**
 * Os ficheiros que a F3-02 traz, por caminho.
 *
 * Mesma função que `COMPONENTES_DA_F3_01` em `componentes.ts`, e pela mesma
 * razão: servem de **sentinela** às varreduras que olham para pastas
 * (`exigirSentinelas` em `percorrer-arvore.ts`). Sem esta lista, a varredura
 * de uma `src/pages/` que ainda não existe devolve zero ficheiros, encontra
 * zero violações e passa — "não consegui procurar" a dar o mesmo resultado
 * que "não encontrei", que é a regra 10 do `CLAUDE.md`.
 *
 * Lista separada da F3-01 de propósito: assim os sete componentes da tarefa
 * anterior não ficam vermelhos por causa de um ficheiro desta.
 *
 * Um ficheiro novo numa destas pastas entra aqui também; é uma linha, e é a
 * linha que faz as varreduras passarem a vê-lo.
 */

/** O ecrã público da ementa e as peças que só ele usa. */
export const FICHEIROS_DA_F3_02 = [
  "src/pages/publico/Ementa.tsx",
  "src/components/ui/LinhaDeProduto.tsx",
];

/**
 * O cabeçalho fixo e a Folha do WiFi (F3-03, secção 10, Q-05).
 *
 * Lista separada da F3-02 pela mesma razão que essa é separada da F3-01: um
 * ficheiro desta tarefa não põe vermelhos os testes da anterior. E tem de
 * existir, senão a varredura de texto passa por cima dos dois ficheiros novos
 * sem dar por isso — a pasta já existe, por isso nem o guarda de "zero
 * ficheiros" acusaria.
 */
export const FICHEIROS_DA_F3_03 = [
  "src/pages/publico/Cabecalho.tsx",
  "src/pages/publico/FolhaWifi.tsx",
];

/**
 * A secção dos próximos eventos e a tabela dos dias e dos meses (F3-04, 9).
 *
 * **O segundo caminho não está em `src/pages/`**, e é por isso que esta lista
 * obrigou a varredura do Q-05 a crescer: as dezanove palavras portuguesas que
 * um ICU reduzido substituiria por inglês vivem em `src/lib/formato/`, numa
 * pasta que nenhuma varredura de texto olhava (F3-04, 5.4 e 9). Uma pasta
 * que não se varre não pode passar por "não encontrei nada".
 */
export const FICHEIROS_DA_F3_04 = [
  "src/pages/publico/Eventos.tsx",
  "src/lib/formato/data-do-evento.ts",
];
