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

/**
 * A galeria, o Visualizador, a Folha de envio e a redução de imagem no
 * browser (F3-05).
 *
 * Dois caminhos novos, não um: `src/pages/publico/` já existia (a sentinela
 * sozinha não acrescentava cobertura nenhuma às varreduras de pasta
 * inteira), mas `src/lib/imagens/` é uma pasta nova — sem a entrada aqui,
 * uma varredura que algum dia passasse a cobrir essa pasta começava a
 * cobri-la a meio, sem ninguém dar por isso (regra 10).
 */
export const FICHEIROS_DA_F3_05 = [
  "src/pages/publico/Galeria.tsx",
  "src/pages/publico/VisualizadorDeFotos.tsx",
  "src/pages/publico/FolhaEnviarFoto.tsx",
  "src/lib/imagens/reduzir.ts",
  "src/lib/imagens/formato.ts",
];

/**
 * O login e a navegação da gestão (F4-01), mais os dois módulos partilhados
 * que ela cria (`lib/api/auth.ts` e `lib/formato/tempo-em-falta.ts`).
 *
 * Sentinelas pela mesma razão das listas anteriores: `src/pages/gestao/` é uma
 * pasta nova, e uma varredura de pasta que ainda não existe devolve zero
 * ficheiros e passa (regra 10 do `CLAUDE.md`).
 */
export const FICHEIROS_DA_F4_01 = [
  "src/pages/gestao/AppGestao.tsx",
  "src/pages/gestao/navegacao.tsx",
  "src/pages/gestao/Entrar.tsx",
  "src/pages/gestao/MolduraDaGestao.tsx",
  "src/pages/gestao/SessaoDaGestao.tsx",
  "src/pages/gestao/Destino.tsx",
  "src/lib/formato/tempo-em-falta.ts",
];

/**
 * A ementa na gestão (F4-02). Sentinelas: uma varredura de pasta que ainda não
 * existe devolve zero ficheiros e passa (regra 10 do `CLAUDE.md`). Entra nas
 * varreduras de textos PT-PT, de build de produção e de `sem-estilo-inline`.
 */
export const FICHEIROS_DA_F4_02 = [
  "src/pages/gestao/destino-depois-de-entrar.ts",
  "src/pages/gestao/ementa/EmentaGestao.tsx",
  "src/pages/gestao/ementa/CartaoDaCategoria.tsx",
  "src/pages/gestao/ementa/LinhaDoProdutoGestao.tsx",
  "src/pages/gestao/ementa/PrecoNaLinha.tsx",
  "src/pages/gestao/ementa/ListaOrdenavel.tsx",
  "src/pages/gestao/ementa/FolhaDoProduto.tsx",
  "src/pages/gestao/ementa/estado-da-ementa.ts",
  "src/pages/gestao/ementa/aviso-do-preco.ts",
  "src/pages/gestao/ementa/pesquisa-gestao.ts",
  "src/lib/api/gestao-ementa.ts",
  "src/lib/formato/ler-preco.ts",
];

/**
 * As definições na gestão (F4-05a). Sentinelas: uma varredura que olha para
 * pastas e não encontra os ficheiros novos devolve zero violações e passa
 * (regra 10 do `CLAUDE.md`). Entra nas varreduras de textos PT-PT, de build de
 * produção e de `sem-estilo-inline`.
 */
export const FICHEIROS_DA_F4_05A = [
  "src/pages/gestao/definicoes/DefinicoesGestao.tsx",
  "src/pages/gestao/definicoes/EditorDoHorario.tsx",
  "src/pages/gestao/definicoes/horario-do-formulario.ts",
  "src/pages/gestao/definicoes/validar-campos.ts",
  "src/pages/gestao/definicoes/formulario.ts",
  "src/pages/gestao/definicoes/textos.ts",
  "src/lib/api/gestao-definicoes.ts",
];

/**
 * Os eventos na gestão (F4-03). Sentinelas: uma varredura que olha para pastas e não encontra
 * os ficheiros novos devolve zero violações e passa (regra 10 do `CLAUDE.md`). Entra nas
 * varreduras de textos PT-PT, de build de produção e de `sem-estilo-inline`. A folha de
 * duplicar e o campo da data podem viver em ficheiros próprios do frontend: quem os criar
 * acrescenta-os aqui (é uma linha, e é a linha que faz as varreduras passarem a vê-los).
 */
export const FICHEIROS_DA_F4_03 = [
  "src/pages/gestao/eventos/EventosGestao.tsx",
  "src/pages/gestao/eventos/LinhaDoEvento.tsx",
  "src/pages/gestao/eventos/FolhaDoEvento.tsx",
  "src/pages/gestao/eventos/FolhaEliminarEvento.tsx",
  "src/pages/gestao/eventos/hora-de-lisboa.ts",
  "src/pages/gestao/eventos/formulario.ts",
  "src/pages/gestao/eventos/data-na-gestao.ts",
  "src/pages/gestao/eventos/datas-da-copia.ts",
  "src/pages/gestao/eventos/textos.ts",
  "src/lib/api/gestao-eventos.ts",
  // Os que o frontend acrescentou ao contrato de nomes do qa: a folha de duplicar, o campo da
  // data (a irmã do `CampoDeHora`) e o cartão de «Assim aparece no site».
  "src/pages/gestao/eventos/FolhaDuplicar.tsx",
  "src/pages/gestao/eventos/CampoDeData.tsx",
  "src/pages/gestao/eventos/PreVisualizacao.tsx",
];

/**
 * A moderação de fotos na gestão (F4-04). Sentinelas: uma varredura que olha para pastas e não
 * encontra os ficheiros novos devolve zero violações e passa (regra 10 do `CLAUDE.md`) — e
 * `src/pages/gestao/galeria/` é uma pasta que ainda não existe, o caso exato. Entra nas varreduras
 * de textos PT-PT, de build de produção («o público não importa a gestão»), de `sem-estilo-inline`
 * e na do `fetch` só dentro do cliente. Quem acrescentar um ficheiro a `galeria/` acrescenta-o aqui
 * (é uma linha, e é a linha que faz as varreduras passarem a vê-lo).
 */
export const FICHEIROS_DA_F4_04 = [
  "src/pages/gestao/galeria/GaleriaGestao.tsx",
  "src/pages/gestao/galeria/FotoEmModeracao.tsx",
  "src/pages/gestao/galeria/FolhaRejeitarFoto.tsx",
  "src/pages/gestao/galeria/FolhaEnviarFotoDoDono.tsx",
  "src/pages/gestao/galeria/estado-da-fila.ts",
  "src/pages/gestao/galeria/quando-foi-enviada.ts",
  "src/pages/gestao/galeria/textos.ts",
  "src/lib/api/gestao-fotos.ts",
];
